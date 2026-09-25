# Testing

How the Worker in `api/` and the web app in `web/` are tested, each alone and together end to end. `shared/` runs its own Vitest in Node. `npm test` from the root runs `scripts/test.sh`, which runs every workspace's tests and then the e2e tests.

## Where a Worker test goes

A test's directory says what it touches. All but `stack/` run inside workerd, the Workers runtime, through `@cloudflare/vitest-plugin`.

| Directory               | Touches                                                                                  | Example                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `api/test/unit/`        | Only the code under test: no bindings                                                    | how the transcoder's reply turns into a width and height |
| `api/test/db/`          | D1, through the query functions in `api/src`                                             | how many rows a write reads                              |
| `api/test/integration/` | The Worker's `fetch`, `queue` and `scheduled` handlers, with D1, R2 and the Queue behind | an upload moving from the inbox to its immutable key     |
| `api/test/stack/`       | Everything `wrangler dev` runs, from Node, the asset router included                     | which paths reach the Worker and which get the web app   |

Run one tier from `api/` with its directory, as in `npx vitest run test/db`, or the stack alone with `npx vitest run --project stack`.

## Real bindings, fakes only at the edges

D1, R2, the Queue and the Images binding are Miniflare's local versions, built from `api/wrangler.jsonc` with `remoteBindings: false`, and the database is migrated from `api/migrations/`. So queries run as real SQLite, FTS5 triggers included, and objects really land in a bucket. No test reaches the Cloudflare account. The Worker's secrets come from `api/test/secrets.ts` in every tier, the stack included, so no test needs `api/.dev.vars` or sees what is in it. Wrangler still reads that file when it is there and prints "Using secrets defined in .dev.vars", but it binds only the names in `secrets.required` in `api/wrangler.jsonc`, and the test secrets replace every one of them.

Fake only what cannot run locally or would reach outside:

- **The ffmpeg container.** Code that transcodes takes a narrowed env type (`TranscodeEnv`, `UploadEnv`) whose `TRANSCODER` is anything that answers `fetch`, and a test passes a stand-in.
- **Third-party HTTP.** `api/test/setup.ts` makes every `fetch` throw unless the test stubs it with `vi.spyOn(globalThis, 'fetch')`, so a forgotten stub fails loudly instead of calling a real service.
- **A binding failing.** Spy on the binding's method, as in `vi.spyOn(env.MEDIA, 'get')`, and pass every other call through to the real one.

Don't mock modules or stub a sequence of storage calls: that tests how the code works rather than what it does, and the local bindings make it unnecessary. `restoreMocks` and `unstubGlobals` undo spies and stubbed globals after each test.

## Every test starts empty

Before each test, `api/test/setup.ts` calls `reset()`, which empties every binding and drops D1's tables, then applies the migrations again. It costs a few milliseconds.

- Put data a test needs in `beforeEach`, never `beforeAll`: the reset runs after `beforeAll` and erases what it wrote.
- Assert exact counts and contents. No test needs a unique path or a count relative to what was there.
- Tests run in a random order. A failure prints its seed; rerun it in the same order with `--sequence.seed=<seed>`.

## Calling the Worker

- `call`, `callAsAdmin`, `callForJson` and `putItem` in `api/test/helpers.ts` send a request as a browser on the local dev origin would. They wait for work the Worker left running with `waitUntil()`, such as a cache write, so the next test's reset cannot cut it off.
- The admin cookie is signed independently of `api/src/auth/session.ts`, so a change to the cookie format fails a test.
- Passkeys come from `SoftwareAuthenticator` in `api/test/authenticator.ts`, which builds what a browser sends from a real P-256 key, so the Worker's WebAuthn checks run unchanged. `api/test/integration/passkeys.test.ts` drives registration and login with it, and `api/scripts/passkey-selftest.ts` uses it against `wrangler dev`.
- A stack test may import a constant from `api/src` when it holds a copy of something to the Worker's value, as `api/test/stack/headers.test.ts` holds `web/static/_headers` to `SITE_HEADERS`; it runs in Node, so what it imports has to be free of Worker types.
- Drive the queue with `createMessageBatch` and read what was acked with `getQueueResult`; drive a cron with `createScheduledController`. `api/test/integration/media.test.ts` and `scheduled.test.ts` show both.
- Files from `api/fixtures/` load with a `?inline` import.

## Rows read

D1 bills by rows read, not rows returned, and an FTS trigger that scanned the whole index on every write once read 37.7M rows in a day. Local D1 counts the rows a trigger reads in the `meta.rows_read` of the statement that fired it.

`api/test/db/rows-read.test.ts` fills a gallery-sized table and holds each write to a few rows, and each read or search to little more than it returns. A new query, trigger or index change gets a case there, and a query that scans instead of seeking fails it with thousands of rows.

## The web app

`web/`'s tests sit beside the code as `*.test.ts`. Which runtime a test gets is decided by its name: `*.svelte.test.ts` compiles runes in the test itself and runs in headless Chromium through Vitest's browser mode, so a component's effects run and the DOM is the real one; every other test runs in Node, on `fake-indexeddb`, so `idb-keyval` itself runs and a test covers what the cache can hold. Run them from `web/` with `npx vitest run`, or one project with `--project node` or `--project browser`.

- Mount a component with `render` from `$lib/test-support/render.svelte.ts` and find what it shows with `page` from `vitest/browser`. `render` runs the first render's effects before it returns, so a plain `expect` right after it sees them, such as the title `<svelte:head>` sets, and hands back `rerender` for a prop change.
- `expect.element` retries until its assertion holds or the test times out: use it for anything that arrives later, such as what an image's `load` event shows. A test times out after 3 seconds, since nothing here waits on a network.
- Find elements the way a reader does, with `getByRole` and the accessible name. Fall back to `getByTestId` only where the markup offers nothing a user could perceive, and first consider giving the element a role or a label.
- Tests run at a desktop width, 1280×800. A test about what a phone shows sets its own viewport and says so.
- The stores call the global `fetch`, so a test stands the server in with `fakeServer()` from `$lib/test-support/http.ts`, which answers by method and path with a fixture built by `$lib/test-support/records.ts`. The fixtures are built complete from the record types in `shared/`, so a new field there breaks a fixture instead of leaving it a shape the Worker never sends. `$lib/test-support/setup.ts` makes any other `fetch` throw, naming the URL, so code that reaches a route no test stubbed fails loudly instead of reaching a real server. `resetAlbumState()` in `$lib/test-support/albumState.ts` empties the one album store every test writes to.

## End to end

`e2e/*.e2e.ts` run in Playwright against the whole site on this machine: the web app's build, the asset router and the Worker, on a D1 database migrated into `.wrangler/e2e/`. Nothing reaches the Cloudflare account. `npm run test:e2e` from the root runs them; `npm test` runs them after the workspaces' tests, and the pre-commit hook does not run them. `scripts/test.sh` takes suite names, `shared`, `api`, `web` and `e2e`, to run some of them, and builds the web app once for those that start the site.

- Playwright starts `e2e/server.ts`, which builds the web app, starts the Worker on port 8790 with the test secrets, and writes the gallery in `e2e/gallery.ts` through the Worker's own `PUT /api/item`. Tests start once the last album of it answers.
- Every test shares that gallery, and tests run in parallel, within a file too. Treat it as read-only, which is what lets a test assert exact titles and links; a test that writes makes an album no other test reads.
- While writing tests, run `node e2e/server.ts` in a terminal: Playwright reuses a server already on the port, which skips the build. Restart it after changing the web app, the Worker or the gallery.
- Walk a journey in one test with a `test.step` per page, since a later page is usually reached from the one before it, and the step says where it failed. `e2e/navigation.e2e.ts` is the example.
- Locators follow the web app's rule, and lint enforces it: roles and names, no CSS selectors, no `.first()` or `.nth()`.
- The gallery holds no originals in R2 and the ffmpeg container does not run, so a thumbnail is a broken image. Assert on text and links.
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
