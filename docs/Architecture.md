# Architecture

How pix.tacocat.com runs on Cloudflare, as the code stands. `README.md` says how to run, deploy and restore it; `docs/plans/AwsMigration.md` records the decisions behind this shape and what the AWS back end each piece replaced; `docs/Perf.md` and `docs/Risks.md` hold the measurements.

## One Worker

The site is one Worker per environment, `api/`, serving the web app and everything behind it on one origin. Its bindings are one D1 database, two R2 buckets, the Images binding, a Queue with a dead-letter queue, a Workflow, a Container running ffmpeg behind a Durable Object, and the version metadata the health route answers with. Each environment, staging and production, has its own set, declared in `api/wrangler.jsonc` and created by OpenTofu in `infra/`.

A request reaches one of two places. The web app's files, `web/build`, are static assets: the asset router serves them, and any path that matches no file and no Worker route falls back to `index.html`, so `/2001/06-15` is the app. `run_worker_first` lists the paths the Worker answers itself: `/api/*`, the media routes `/i/*`, `/i2/*`, `/v/*` and `/raw/*`, `/login`, `/invite/*`, `/debug/*` and, under `wrangler dev`, `/upload/*`. Both places send the same headers, the crawler refusals and the security set, from `api/src/http/headers.ts` for the Worker and `web/static/_headers` for the assets, and a stack test holds the two copies together. Files under `/_app/immutable/` are cached for a year, as on AWS.

The Worker's default export has three handlers. `fetch` is a Hono app assembled in `api/src/routes/app.ts`: middleware adds the site headers, the colo and `Server-Timing` to every response and the `x-auth-status` view under `/api/`, an admin gate refuses every `POST`, `PUT`, `PATCH` and `DELETE` without a session, and `onError` and `notFound` turn every failure into `{ errorMessage }`, the shape the app parses. `queue` starts one upload pipeline per R2 event. `scheduled` picks a job by its cron string: the nightly backup and purges, the browser runs, and otherwise the idle-latency probes.

## Data

D1 holds every row, in the tables `api/src/db/schema.ts` declares through Drizzle and `api/migrations/` creates: one generated migration for the schema, one raw-SQL migration for the FTS5 index and its triggers, and one that seeds the users.

`item` is the gallery. A row is an album or a media item, identified by `(parent_path, item_name)`, which is its URL, and referenced by other rows through its integer `id`. The root is not a row. Albums are `/YYYY` in `/` and `/MM-DD` in `/YYYY/`; media items are files in a day album. A media row carries the `version_id` of its current upload, its width and height in the EXIF-oriented frame, a video's duration, and the rectangle its own thumbnail is cut from; an album carries `published`, a one-line `summary` and the `thumbnail_id` of the media item it is shown by, a foreign key that clears itself when that item is deleted. Captions are `title`, `description` and a JSON array of `tags`, which the pipeline reads from the file's metadata. Named `CHECK` constraints enforce the path grammar, the type rules, the caption rules and the timestamp format, so a row that breaks one is a bug, answered with a 500, except through the import route, which names the constraint in its 400.

`item_fts` is an FTS5 index over the names and captions, kept in step by triggers that fire only on the columns it holds. `upload` records every version id the Worker mints, with the album and name the upload is for, the item it replaces if any, who asked, and when the pipeline completed it. `upload_error` is what the admin UI polls after a drop. `user`, `passkey`, `invite` and `spent_challenge` are login. `probe_result` is the idle-probe history. Every table has `created_at` and `updated_at` from SQLite's clock.

Reads go through the D1 Sessions API. A write answers with the session's bookmark in a header and a cookie, and the next read from that browser passes it back, so an admin reads their own save from whichever replica answers; `?consistency=primary` forces the primary. Every album read logs which D1 copy answered and how long it took, and answers it in an `x-d1` header.

## Storage

Every object is keyed by the version id of the upload it came from and by nothing else: a gallery path lives only in the row, so renaming a photo or an album touches no object. The media bucket holds `inbox/<versionId>`, where the browser's presigned PUT lands, `originals/<versionId>`, written once by the pipeline with the upload's path in its custom metadata, and `backups/d1/`, the nightly database dumps. The derived bucket holds `derived/<versionId>/…`: each image size the routes have served, and for a video its `video.mp4` and `poster.jpg`. Originals are never overwritten: a replacement gets a new version id and the row points at it. Nothing is deleted on an admin's delete or replace; the old objects wait for the purge, which is not built yet.

A version id is a millisecond timestamp in base 36 followed by 64 random bits, so a listing of originals is in upload order and knowing an id is knowing the photo: the media routes check no row and no login, as the AWS image CDN did not, and can reach only that version's original, MP4 or derivatives.

## The API

JSON under `/api/`, same origin, in the AWS API's record shapes from `shared/`, so the app parses them unchanged. Reads never refuse: a guest gets the published view. Writes need an admin. The routes are the AWS Lambdas' operations: get and `HEAD` an album, `HEAD` a media item, search; create, update, delete and rename an album and set its thumbnail; update, delete, rename and recut a media item; presign uploads and read upload errors; and `PUT /api/item`, the import route that writes a whole row. Each write is one statement whose cross-row rules are subqueries in its `WHERE`, in `api/src/gallery/`; when it changes nothing, one read of the facts says why, and the route answers with the message the AWS Lambda used.

Search is FTS5: each word quoted so no input is a syntax error, filtered by year, sorted on the gallery path, which is chronological, and paged; guests get published items only.

## Uploads

The app asks `POST /api/presigned/<album>` what each upload will be. Presign checks the names and the collisions, mints a version id per file, records each in `upload`, and answers with a presigned PUT into the inbox and the version id. The browser PUTs straight to R2. R2's event notification puts a message on the queue, and the consumer starts a Workflow instance named by the version id, so a redelivered event starts nothing.

The instance runs `api/src/gallery/upload.ts` in steps that end only where a retry must respect a change of state. A video is transcoded first by the container, which reads and writes through presigned URLs and reports the size and duration. One step then makes everything the item needs from the file: reads its dimensions, caption and keywords, writes the original under its final key, and makes the thumbnail and the detail image, so a file the Images binding cannot decode surfaces as an upload error before it reaches an album. One step writes the item and the upload's completion in one batch: a new row under the album's current path, or for a replacement the target row pointed at the new version, renamed to its own base name with the new file's extension, its crop kept only if the dimensions are unchanged, its captions kept and the file's taken only where the row has none. The last step drops the inbox object. An object nobody presigned is left alone; an upload whose album or target was deleted meanwhile becomes an `upload_error`.

Under `wrangler dev` nothing reaches the account: with `UPLOADS=local` presign answers with a path on the Worker, `PUT /upload/<versionId>` takes the file into the local bucket and sends the local queue the message R2 would, and the pipeline runs unchanged.

## Images and video

`GET /i/<path>/<versionId>?size=&crop=` serves a derivative. The route looks in the colo's cache, then in the derived bucket, and on a miss makes it with the Images binding from the version's poster or, failing that, its original, stores it and caches it for a year. The URL's path is for whoever reads it: the version is what finds the object, so a URL survives a rename. The detail size rule, 1024 on the long side and never enlarged, is in `shared/urls.ts`, so the pipeline pre-generates exactly what the app will ask for. `/i2/*` is the same through the derived bucket's public host and the CDN, kept for measurement. `/raw/` is the original, a HEIC converted to JPEG on the way out unless `?format=original`; `/v/` is the MP4 with byte ranges. Each derivative response reports its cache lookup and R2 read in `Server-Timing`.

The transcoder is a Container, `api/transcoder/`, parked on the smallest instance type, one at a time, stopping ten seconds after its last request. Its Durable Object class and its image ship only with a plain `wrangler deploy`.

## Login

Admin login is passkeys, in `api/src/auth/`. An invite, minted by `api/scripts/invite.sh` as a row whose token hash the link carries, lets its holder register a passkey as a seeded user; login answers with a session cookie signed with the Worker's `SESSION_SECRET`, good for 30 days and revoked only by rotating the secret. A passkey is bound to the site's origin, `SITE_ORIGIN` in each environment's vars.

## Operations

Production's crons, in `api/src/ops/`, are the site's own instruments. The idle probes ask Globalping for one request at a time from four cities after gaps of one to nine hours and write what they saw to `probe_result`. The browser runs start the album journey in DebugBear four times a day, cold and then warm. The nightly job backs up `item` to the media bucket and purges old upload errors and spent challenges. Staging runs only the nightly job. `GET /api/health` answers with the running version and the newest migration, which is what a release checks.

## Layers

`api/src` is layered, and ESLint's import rules and cycle check enforce it. `index.ts` is the composition root. `routes/` is HTTP on Hono: it parses, gates and shapes, and calls `gallery/`, which holds the operations and takes plain arguments, never Hono's context. `auth/` and `ops/` sit beside `gallery/`. Under them, `db/` is the schema and the ORM over sessions, `storage/` the keys and S3 presigning, `media/` the metadata reader, the Images binding and the transcoder, `http/` responses, cookies and the bookmark, and `util/` the helpers with no layer. `shared/` is what both sides agree on: the record schemas, the request and response schemas, the path grammar and the URL builders.

## The web app

`web/` is `tacocat-gallery-sveltekit` ported, not rewritten: the same SvelteKit single-page app, changed only where the platform forces it, the URLs in `config.ts`, the session check and login page, the presign contract, and the naming rule, which moved into `shared/paths.ts` so both sides refuse by the same function. It builds to static files the Worker serves, and reads the same shapes it read from AWS.

## Environments and infrastructure

Staging is the config's top level and production is `env.production`, two Workers from one config with their own data, secrets and passkeys. Every push to a pull request branch releases the branch to staging and a merge to `main` releases both, through `scripts/release.sh`: build, upload a version, apply migrations, check it at 0% on the live hostname through the version-override header, then switch. `infra/` declares the zone and its settings, and per environment the database with read replication, the buckets with the media bucket's CORS rule and its event notification, the queues and the derived bucket's public host.

## Tests

`api/test/` runs in workerd against real local bindings, in tiers by what a test touches: unit, database, integration through the Worker's handlers, and the stack through `wrangler dev`. A rows-read suite holds each query to its budget. `web/` has its own Vitest, and `e2e/` drives the built app with Playwright through the reader's path and the admin journeys, uploads included, against the local upload path. `docs/Testing.md` has the rules.
