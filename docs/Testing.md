# Testing

How the Worker in `api/` and the web app in `web/` are tested, each alone and together end to end. `shared/` runs its own Vitest in Node. `npm test` from the root runs `scripts/test.sh`, which runs every workspace's tests and then the e2e tests.

## Where a Worker test goes

A test's directory says what it touches. All but `stack/` and `transcoder/` run inside workerd, the Workers runtime, through `@cloudflare/vitest-plugin`.

| Directory               | Touches                                                                                  | Example                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `api/test/unit/`        | Only the code under test: no bindings                                                    | how the transcoder's reply turns into a width and height |
| `api/test/db/`          | D1, through the query functions in `api/src`                                             | how many rows a write reads                              |
| `api/test/integration/` | The Worker's `fetch`, `queue` and `scheduled` handlers, with D1, R2 and the Queue behind | an upload moving from the inbox to its immutable key     |
| `api/test/stack/`       | Everything `wrangler dev` runs, from Node, the asset router included                     | which paths reach the Worker and which get the web app   |
| `api/test/transcoder/`  | The container's server as its image runs it, from Node, with fake ffmpeg and ffprobe     | an encode stopped when the Worker hangs up               |

Run one tier from `api/` with its directory, as in `npx vitest run test/db`, or the stack or the transcoder alone with `npx vitest run --project stack` or `--project transcoder`. The transcoder's tests start `api/transcoder/server.ts` with `api/test/transcoder/bin/` first on its PATH, where shell scripts stand in for ffmpeg and ffprobe and record each process they start, so a test can tell whether an encode is still running; real ffmpeg is tuned in local Docker instead.

## Real bindings, fakes only at the edges

D1, R2, the Queue and the Images binding are Miniflare's local versions, built from `api/wrangler.jsonc` with `remoteBindings: false`, and the database is migrated from `api/migrations/`. So queries run as real SQLite, FTS5 triggers included, and objects really land in a bucket. No test reaches the Cloudflare account. The Worker's secrets come from `api/test/secrets.ts` in every tier, the stack included, so no test needs `api/.dev.vars` or sees what is in it. Wrangler still reads that file when it is there and prints "Using secrets defined in .dev.vars", but it binds only the names in `secrets.required` in `api/wrangler.jsonc`, and the test secrets replace every one of them.

Fake only what cannot run locally or would reach outside:

- **The ffmpeg container.** Code that transcodes takes a narrowed env type (`TranscodeEnv`, `UploadEnv`) whose `TRANSCODER` is anything that answers `fetch`, and a test passes a stand-in.
- **Third-party HTTP.** `api/test/setup.ts` makes every `fetch` throw unless the test stubs it with `vi.spyOn(globalThis, 'fetch')`, so a forgotten stub fails loudly instead of calling a real service.
- **A binding failing.** Spy on the binding's method, as in `vi.spyOn(env.ORIGINALS, 'get')`, and pass every other call through to the real one.

Don't mock modules or stub a sequence of storage calls: that tests how the code works rather than what it does, and the local bindings make it unnecessary. `restoreMocks` and `unstubGlobals` undo spies and stubbed globals after each test.

## Every test starts empty

Before each test, `api/test/setup.ts` calls `reset()`, which empties every binding and drops D1's tables, then applies the migrations again. It costs a few milliseconds.

- Put data a test needs in `beforeEach`, never `beforeAll`: the reset runs after `beforeAll` and erases what it wrote.
- Assert exact counts and contents. No test needs a unique path or a count relative to what was there.
- Tests run in a random order. A failure prints its seed; rerun it in the same order with `--sequence.seed=<seed>`.

## Calling the Worker

- `call`, `callAsAdmin`, `callForJson` and `putItem` in `api/test/helpers.ts` send a request as a browser on the local dev origin would. They wait for work the Worker left running with `waitUntil()`, such as a cache write, so the next test's reset cannot cut it off. Beside them, `write` sends an admin write with a JSON body, `album` and `albumAsAdmin` read an album as a guest or as an admin through `parseExactly`, `errorMessage` reads what a refusal says, `putDay` saves a year and a day album, and `handler` is the Worker typed as the platform's handler, for calling `queue` and `scheduled`.
- The admin cookie is signed independently of `api/src/auth/session.ts`, so a change to the cookie format fails a test.
- Passkeys come from `SoftwareAuthenticator` in `api/test/authenticator.ts`, which builds what a browser sends from a real P-256 key, so the Worker's WebAuthn checks run unchanged. `api/test/integration/passkeys.test.ts` drives registration and login with it, and `api/scripts/passkey-selftest.ts` uses it against `wrangler dev`.
- A stack test may import a constant from `api/src` when it holds a copy of something to the Worker's value, as `api/test/stack/headers.test.ts` holds `web/static/_headers` to `SITE_HEADERS`; it runs in Node, so what it imports has to be free of Worker types.
- Drive the queue with `createMessageBatch` and read what was acked with `getQueueResult`; drive a cron with `createScheduledController`. The consumer starts a Workflow instance per upload event, named by the version id, so a pipeline test makes an introspector for that id with `introspectWorkflowInstance` before delivering the event, waits on it with `waitForStatus`, and disposes it, which `await using` does; `modify` can fail a step once or skip the delays between retries. `deliver` in `api/test/pipeline.ts` does all of that for one upload and returns what the consumer acked. The instance runs in the test's isolate, so a spy on a binding reaches it, which is how the transcoder is stood in. A step a test makes fail is logged by the local engine as an uncaught exception, which is not a failing test. `api/test/integration/media.test.ts` and `scheduled.test.ts` show all of this.
- Files from `api/fixtures/` load with a `?inline` import, and `fixtureBytes` in `api/test/gallery.ts` turns one into bytes. That module also holds `IMAGE`, a small photo to spread into an item, and `compiledQuery`, which compiles search terms for a test that calls the search directly. It touches no binding, so a unit test can import it.
- A helper that several test files need goes in one of these modules; one that a single file needs stays in that file, where a reader sees what the test sets up.
- A version id a test writes comes from `testVersionId` in `api/test/version-id.ts`, which pads a short label such as `v1` into a ULID the constraint and the URL parser admit, so a failure still reads as the label. A file belongs to one item only, so media a test saves with `putItem` and names no version id for is given one read from its path, by `withVersionId` beside `testVersionId`; a test names a version only when it asserts or shares it. A media row a test writes straight to D1 from a shared fixture goes through `withVersionId` too.

## Rows read

D1 bills by rows read, not rows returned, and an FTS trigger that scanned the whole index on every write once read 37.7M rows in a day. Local D1 counts the rows a trigger reads in the `meta.rows_read` of the statement that fired it.

`api/test/db/rows-read.test.ts` fills a small gallery and holds each write to a few rows, and each read or search to little more than it returns. A new query, trigger or index change gets a case there, and a query that scans instead of seeking fails it with hundreds of rows.

- The gallery only has to be big enough that a scan reads more than a case's bound allows. The test database has no statistics for SQLite's planner, so it picks the same plan at a few hundred rows as at many thousands, and more rows only slow every test.
- A scan that stops at its first match reads the rows before it, whatever the table's size, so a case looks for a row far enough in that the rows before it pass the bound: in a later day, never the first.

## The web app

`web/`'s tests sit beside the code as `*.test.ts`. Which runtime a test gets is decided by its name: `*.svelte.test.ts` compiles runes in the test itself and runs in headless Chromium through Vitest's browser mode, so a component's effects run and the DOM is the real one; every other test runs in Node, on `fake-indexeddb`, so `idb-keyval` itself runs and a test covers what the cache can hold. Run them from `web/` with `npx vitest run`, or one project with `--project node` or `--project browser`.

- Mount a component with `render` from `$lib/test-support/render.svelte.ts` and find what it shows with `page` from `vitest/browser`. `render` runs the first render's effects before it returns, so a plain `expect` right after it sees them, such as the title `<svelte:head>` sets, and hands back `rerender` for a prop change.
- `expect.element` retries until its assertion holds or the test times out: use it for anything that arrives later, such as what an image's `load` event shows. A test times out after 3 seconds, since nothing here waits on a network.
- Find elements the way a reader does, with `getByRole` and the accessible name. Fall back to `getByTestId` only where the markup offers nothing a user could perceive, and first consider giving the element a role or a label.
- Tests run at a desktop width, 1280×800. A test about what a phone shows sets its own viewport and says so.
- Nothing runs the app in an old browser: Vitest's browser mode and Playwright run Chromium. The floor in `.browserslistrc`, iOS 15.6, is held by lint and the build instead (Front end in `README.md`), so a test passing in Chromium says nothing about a feature the floor lacks.
- The stores call the global `fetch`, so a test stands the server in with `fakeServer()` from `$lib/test-support/http.ts`, which answers by method and path with a fixture built by `$lib/test-support/records.ts`. The fixtures are built complete from the record types in `shared/`, so a new field there breaks a fixture instead of leaving it a shape the Worker never sends. `$lib/test-support/setup.ts` makes any other `fetch` throw, naming the URL, so code that reaches a route no test stubbed fails loudly instead of reaching a real server. `resetAlbumState()` in `$lib/test-support/albumState.ts` empties the one album store every test writes to.

## End to end

`e2e/*.e2e.ts` run in Playwright against the whole site on this machine: the web app's build, the asset router and the Worker, on a D1 database migrated into `.wrangler/e2e/`. Nothing reaches the Cloudflare account. `npm run test:e2e` from the root runs them; `npm test` runs them after the workspaces' tests, and the pre-commit hook does not run them. `scripts/test.sh` takes suite names, `shared`, `api`, `web` and `e2e`, to run some of them, and builds the web app once for those that start the site.

- Playwright starts `e2e/server.ts`, which builds the web app, starts the Worker on port 8790 with the test secrets, and writes the gallery in `e2e/gallery.ts` through the Worker's own `PUT /api/item`. Tests start once the last album of it answers.
- Every test shares that gallery, and tests run in parallel, within a file too. Treat it as read-only, which is what lets a test assert exact titles and links; a test that writes does so in a year of its own, below. Those years pile up in the root for as long as the server runs, so no test asserts the root's list of years.
- The database lives until `e2e/server.ts` restarts, so a retry, or a rerun against a reused server, meets what the last attempt wrote. A test that writes takes `adminTest` from `e2e/support.ts` in place of Playwright's `test`: its context is signed in as the admin with the test cookie, and its `year` fixture is a published year no other attempt has had, claimed through the Worker's `PUT /api/album`, which never makes an album twice. The test writes what it starts from into that year with the helpers in `e2e/api.ts`, which call the Worker's API as the admin, so every attempt starts from the same state and asserts exact contents.
- `e2e/` imports the stack, the test secrets and the fixtures as `@tacocat-gallery/api/...` through the `exports` in `api/package.json`. A new helper gets an entry there, since lint refuses a relative import into another workspace.
- While writing tests, run `node e2e/server.ts` in a terminal: Playwright reuses a server already on the port, which skips the build. Restart it after changing the web app, the Worker or the gallery.
- Walk a journey in one test with a `test.step` per page, since a later page is usually reached from the one before it, and the step says where it failed. `e2e/navigation.e2e.ts` is the example.
- Locators follow the web app's rule, and lint enforces it: roles and names, no CSS selectors, no `.first()` or `.nth()`.
- A photo written as a row has no file behind it, so its thumbnail is a broken image; the reader's day is the exception, its files put into local R2 by `e2e/server.ts` before the Worker starts. The ffmpeg container does not run. Assert on text and links.
- Uploads complete: the stack runs with `UPLOAD_MODE=local`, as `wrangler dev` does, so the Worker takes the PUT into its local bucket and raises the event itself, and the pipeline makes the item. A test that needs a photo with its original, such as one to crop, uploads it with `uploadFile` in `e2e/api.ts` and waits for it to appear in its album.
- An admin journey reveals the control strip with `revealAdminControls` in `e2e/support.ts`, since the strip shows only under the pointer.
- The passkey journey in `e2e/passkeys.e2e.ts` signs in the real way, with Chromium's virtual authenticator standing in for Face ID or a password manager, and an invite `mintInvite` in `e2e/support.ts` writes into the running site's database for each attempt, since an attempt uses its invite up. The e2e Worker keeps the browser's origin, as `--local-upstream` does under `npm run dev`, since a passkey is bound to it.
- A failure keeps a trace and a screenshot under `e2e/test-results/`. `npx playwright show-report e2e/playwright-report` opens the HTML report, trace included.

## Coverage

`npm run test:coverage` from the root runs the api and web tests with Istanbul coverage and lists each file with something uncovered; `coverage/index.html` in each workspace has the detail. It is for finding what no test reaches, not a gate, so there are no thresholds. It is Istanbul because V8 coverage does not work inside workerd. The api numbers count only the tests that run inside workerd, since the stack tests reach the Worker in a separate process, and e2e tests count toward neither.

## Writing a test

- A test that doesn't fail without the change it covers proves nothing. Break the code on purpose once and watch the test fail.
- Title a unit test's `describe` with the function itself, as in `describe(transcodeVideo, ...)`.
- Use `it.each` for cases that differ only in data, with object rows and a `$name` in the title.
- Read the database back through `orm(env.DB)` and `schema`, so a renamed column is a type error. Raw SQL is for FTS5, which Drizzle cannot see.
- Read an API response with `parseExactly` and its parse function from `shared/`, such as `parseAlbum`. It fails on a field the schema lacks, which parsing alone would drop.
- Every test asserts something; `requireAssertions` fails one that doesn't.
- Wait for the end state, never for a span of time: `expect.element`, `vi.waitFor` or Playwright's `expect`, never a `setTimeout`. A guess at how long something takes passes most runs and fails some, the hardest kind of failure to trace.
