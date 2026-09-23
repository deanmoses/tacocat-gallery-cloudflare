# Testing

How the Worker in `api/` is tested. `shared/` and `web/` run their own Vitest; `scripts/test.sh` runs all three, and `npm test` from the root runs that.

## Where a test goes

A test's directory says what it touches. All but `stack/` run inside workerd, the Workers runtime, through `@cloudflare/vitest-plugin`.

| Directory               | Touches                                                                                  | Example                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `api/test/unit/`        | Only the code under test: no bindings                                                    | how the transcoder's reply turns into a width and height |
| `api/test/db/`          | D1, through the query functions in `api/src`                                             | how many rows a write reads                              |
| `api/test/integration/` | The Worker's `fetch`, `queue` and `scheduled` handlers, with D1, R2 and the Queue behind | an upload moving from the inbox to its immutable key     |
| `api/test/stack/`       | Everything `wrangler dev` runs, from Node, the asset router included                     | which paths reach the Worker and which get the web app   |

Run one tier from `api/` with its directory, as in `npx vitest run test/db`, or the stack alone with `npx vitest run --project stack`.

## Real bindings, fakes only at the edges

D1, R2, the Queue and the Images binding are Miniflare's local versions, built from `api/wrangler.jsonc` with `remoteBindings: false`, and the database is migrated from `api/migrations/`. So queries run as real SQLite, FTS5 triggers included, and objects really land in a bucket. No test reaches the Cloudflare account. The Worker's secrets come from `api/test/secrets.ts` in every tier, the stack included, so no test needs `api/.dev.vars` or sees what is in it.

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
- The admin cookie is signed independently of `api/src/session.ts`, so a change to the cookie format fails a test.
- Drive the queue with `createMessageBatch` and read what was acked with `getQueueResult`; drive a cron with `createScheduledController`. `api/test/integration/media.test.ts` and `scheduled.test.ts` show both.
- Files from `api/fixtures/` load with a `?inline` import.

## Rows read

D1 bills by rows read, not rows returned, and an FTS trigger that scanned the whole index on every write once read 37.7M rows in a day. Local D1 counts the rows a trigger reads in the `meta.rows_read` of the statement that fired it.

`api/test/db/rows-read.test.ts` fills a gallery-sized table and holds each write to a few rows, and each read or search to little more than it returns. A new query, trigger or index change gets a case there, and a query that scans instead of seeking fails it with thousands of rows.

## Writing a test

- A test that doesn't fail without the change it covers proves nothing. Break the code on purpose once and watch the test fail.
- Title a unit test's `describe` with the function itself, as in `describe(transcodeVideo, ...)`.
- Use `it.each` for cases that differ only in data, with object rows and a `$name` in the title.
- Read the database back through `orm(env.DB)` and `schema`, so a renamed column is a type error. Raw SQL is for FTS5, which Drizzle cannot see.
- Check an API response by parsing it with its schema from `shared/`, as `albums.test.ts` does with `parseAlbum`.
- Every test asserts something; `requireAssertions` fails one that doesn't.
