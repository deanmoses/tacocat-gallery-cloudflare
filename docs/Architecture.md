# Architecture

## The pieces

The whole site is one Worker per environment, serving the web app and everything behind it from the site's own hostname.

```text
     the site's hostname (pix.deanmoses.com, staging-pix.deanmoses.com)
                                  |
                 +----------------+----------------+
                 |                                 |
           static assets                      Worker code
          (the web app)               (/api, /login, /i, /raw, /v)
                                                   |
       +------------+------------+-----------+-----+------+
       |            |            |           |            |
       D1       R2 media     R2 derived    Images     Container
                                                       (ffmpeg)

  media upload:  browser --PUT--> R2 media --event--> Queue --> Worker --> Workflow
```

| Piece                            | What it does                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| **`api/` (worker)**              | Serves the app's files, the API, login and the media; consumes upload events; runs the cron |
| **`web/` (web app)**             | The SvelteKit single-page app, built to static files the Worker serves                      |
| **`shared/`**                    | Code shared between the worker and web app: record shapes, path grammar, URL builders       |
| **`infra/` (OpenTofu)**          | Creates everything outside the Worker: the zone, the database, the buckets, the queues      |
| **Cloudflare D1**                | The database: every album and media item, the search index, uploads, login                  |
| **Cloudflare R2 media bucket**   | Uploads as they arrive, originals, nightly database dumps                                   |
| **Cloudflare R2 derived bucket** | Everything made from an original: image sizes, a video's MP4 and its poster                 |
| **Cloudflare Images binding**    | Resizes and crops images, HEIC included                                                     |
| **Cloudflare Queue**             | Carries R2's event for each finished upload to the Worker                                   |
| **Cloudflare Workflow**          | Runs one upload pipeline per uploaded file                                                  |
| **Cloudflare Container**         | ffmpeg, for transcoding video                                                               |

**One origin.** There's no `api.`, `img.` or `auth.` subdomains, meaning there's no CORS between the app and the API, the session cookie needs no cross-site settings, and every URL the app builds is a root-relative path with no host. The one request that leaves the origin is the upload itself, a PUT straight to R2's S3 endpoint, so the media bucket alone carries a CORS rule, in `infra/`.

The Worker's default export in `api/src/index.ts` has three handlers:

- `fetch`: the Hono app in `api/src/routes/app.ts`
- `queue`: starts a Workflow instance for each upload event
- `scheduled`: the nightly job, and the jobs that measure performance

The bindings are declared in `api/wrangler.jsonc`.

## Paths and items

The gallery is a tree, and a path is a URL:

```text
/                        the root album: the list of years, not a row
/2001/                   a year album
/2001/06-15/             a day album
/2001/06-15/felix.jpg    a media item, always in a day album
```

`shared/src/paths.ts` is the grammar.

- **An album** has a description, a one-line summary, a published flag, and the media item it shows as its thumbnail, from anywhere in its subtree. A day album can be published only while its year is.
- **A media item** is an image or a video, decided by its extension. It has the version id of its current file, its size, a video's duration, a title, a description, tags, and the rectangle its thumbnail is cut from. It shows whenever its album does.

## Database

Cloudflare D1 (SQLite) holds everything but the media files. Tables:

- `item`: every album and media item, one row each
- `item_fts`: the search index over item's names, captions, tags and summaries
- `upload`: every upload the Worker has handed out a URL for, and whether it finished
- `upload_error`: errors during async media upload/processing, for the admin UI to show
- `user`: admins
- `passkey`: passkeys for admins
- `invite`: invites for admins to create a passkey
- `spent_challenge`: used login challenges

The schema defined in Drizzle in `api/src/db/schema.ts`.

An `item` row is identified by `(parent_path, item_name)`, so `felix.jpg` in `/2001/06-15/`, and referenced by its integer `id`.

- **Search** is SQLite's FTS5, in the same database. Triggers keep `item_fts` in step with `item`, firing only when a column the index holds changes.
- **Migrations** are written by drizzle-kit from `schema.ts` into `api/migrations/`. The search index and its triggers are raw SQL in a migration, since Drizzle models neither.
- **Read replicas.** Reads go through a D1 session, so the nearest replica can answer. Every write answers with the session's bookmark, as a header and a short-lived cookie, and a read that brings a bookmark back is served by a copy at least that new, so an admin sees their own save from whichever replica answers.

**Why the rules are in the database.** Every rule about a single row, the path grammar, required fields, formats, one type's fields being empty for the other, a crop fitting inside its image, is a named constraint in `schema.ts`, so nothing, a hand-run script included, can write a row that breaks one. What a constraint cannot express, a rule that looks at another row, is checked in `api/src/gallery/`, and so is every rule a user should see explained. So a broken rule the user can fix is a 400 with a message, and a constraint failing is a bug, answered with a 500.

**Why a path is for now and an id is for later.** A request names what it acts on by path, and the statement resolves the path as it runs, so a path that moved since the page loaded answers 404. But anything the database keeps in order to act on later, an album's thumbnail, the album an upload goes into, the item an upload replaces, references a row's id, with a foreign key that clears it when that row is deleted. So a reference cannot be renamed out from under, and a deleted one leaves a null rather than a dangling path.

**Why migrations are additive.** During a release the old and new Worker versions share one database, so a column is removed only in a later release than the one that stopped using it.

## Storage

Media is stored in Cloudflare R2.

Take the photo `/2001/06-15/felix.heic`, whose current version id is `0muhjn6yo3f9a1c07b2e4d58a`. Everything stored for it is keyed by that id:

```text
media bucket
  inbox/0muhjn6yo3f9a1c07b2e4d58a                   the upload as it arrived, dropped once processed
  originals/0muhjn6yo3f9a1c07b2e4d58a               the file as uploaded, written once
  backups/d1/2026-09-25T09:17:00.000Z.json          a nightly database dump (not per photo)

derived bucket
  derived/0muhjn6yo3f9a1c07b2e4d58a/200x200-webp    the album page's thumbnail
  derived/0muhjn6yo3f9a1c07b2e4d58a/400x400-webp    the same for a 2x screen
  derived/0muhjn6yo3f9a1c07b2e4d58a/1024-jpeg       the media page's image
  derived/0muhjn6yo3f9a1c07b2e4d58a/…               any other size or crop, made the first time it is asked for
  derived/<versionId>/video.mp4, poster.jpg         for a video: its transcode, and the still its images are cut from
```

A version id is the moment it was minted, in base 36, followed by 64 random bits, so listings come out in upload order and an id cannot be guessed. `api/src/storage/keys.ts` builds every key. Each original also carries the path it was uploaded to as metadata, and `api/scripts/media.ts` prints an item's row and every object stored for it.

**Why no path is in a key.** An original is written once and never overwritten, and the `item` row says which version is current. So create, edit, publish, rename, set a thumbnail and delete are database writes that touch no object: renaming an album full of photos is one batch of row updates. A replacement is a new version, and a delete leaves the objects, so either can be undone by pointing a row back at the old version. Objects no row references any more are garbage, and reclaiming them is never the job of the write that orphaned them.

## Reading

The app reads `GET /api/album/2001/06-15/`:

1. The Worker opens a D1 session, so the nearest read replica can answer.
2. It reads the album's row and its children's rows, and nothing else.
3. A guest gets only published albums; an admin gets everything.
4. The rows go out in the record shapes `shared/` defines, which the app parses with the same schemas.

The app works out the previous and next albums from the parent's children, so a read never depends on anything outside the album's own subtree.

The album page's own headers, from `web/static/_headers`, name this request and the parent's as preloads, so the browser sends them as the page arrives rather than after the app's JS has loaded and run; with the zone's Early Hints on, it sends them before the page's body.

**Search** matches every word of the query against the search index. Results come in gallery-path order, which is chronological; guests see published albums and what is in them.

## Writing

Every `POST`, `PUT`, `PATCH` and `DELETE` needs a logged-in admin; one middleware in `api/src/routes/app.ts` refuses the rest.

Publishing `/2001/06-15/` is one statement:

```text
UPDATE item SET published = 1
WHERE  the row is /2001/06-15/
  AND  EXISTS (the year /2001/ is published)
```

If it changed a row, the Worker answers 204 with the bookmark. If it changed nothing, one read of the facts the conditions looked at says why, and the answer is `400 Cannot publish until parent is published`, or a 404 if the album is not there. Every error the Worker sends is `{ "errorMessage": "…" }`.

- Renaming a day album moves the album and its children in one batch, each statement conditional on the rename being possible.
- Deleting a media item deletes its row. The foreign key clears it from any album that showed it; its objects stay in the buckets.
- `PUT /api/item` writes a whole row as given: the import path. When a constraint refuses the row it answers with the constraint's name.

**Why a write's conditions are in its statement.** D1 has no interactive transactions: its one atomic unit is a batch of statements fixed before any runs, so a write cannot read, decide and then write. A rule that depends on another row is a condition of the writing statement instead, an `EXISTS` in its `WHERE` or an `INSERT … SELECT` that selects nothing when the rule fails. There is never a race between a check and the write it guards.

## Uploading

An admin drops `felix.heic` on `/2001/06-15/`:

```text
app                        Worker                          R2 / Queue / Workflow
 | POST /api/presigned/2001/06-15/                               |
 |   [{ path: "/2001/06-15/felix.heic" }]                        |
 |----------------------------->  check the album and the name,  |
 |                                mint a version id, insert an   |
 |  { url, versionId }            upload row                     |
 |<-----------------------------                                 |
 | PUT the file to url ----------------------------------------> | inbox/<versionId>
 |                                                               | R2 event --> Queue
 |                                queue(): start instance        |
 |                                named <versionId> -----------> | Workflow:
 |                                                               |  1. [a video: transcode]
 |                                                               |  2. read, store original,
 |                                                               |     make the two images
 |                                                               |  3. write the item
 |                                                               |  4. drop the inbox object
 | poll the album until it holds <versionId>                     |
```

1. **Presign** (`api/src/gallery/presign.ts`) checks the album exists, the name is one the gallery takes, and nothing is already there, then mints the version id, records it in `upload` with the album's id, and answers with a presigned PUT into the inbox.
2. **The browser PUTs** the file straight to R2. R2 announces it on the queue, and the consumer starts a Workflow instance named by the version id.
3. **The pipeline** (`api/src/gallery/upload.ts`) looks up the upload row, reads the file's size, caption and keywords, stores the original, and makes the thumbnail and the media page's image, so the first reader never waits.
4. **One batch** inserts the item into the album and marks the upload complete; the first photo in a day becomes its thumbnail. Then the inbox object is dropped.
5. **The app** sees the new version in the album and shows it.

**Replacing.** Dropping a file on an existing item updates that row in place: new version, type and size, and a name of the row's own base name with the new file's extension, so the edited `felix.jpg` replaces `felix.heic`. Captions, tags and every album showing it are kept. The thumbnail crop is kept only if the new image has exactly the old size.

**When it fails.** A file that cannot be read or decoded, or an album or item deleted while the upload was in flight, becomes an `upload_error` row, which the app polls for after a drop. Anything else throws, and the step is retried.

**Locally**, a Worker cannot consume a real queue, so with `UPLOADS=local` presign hands out the Worker's own `/upload/<versionId>`, which stores the file and raises the event R2 would. The pipeline runs unchanged.

**Why presign judges first.** Presign applies the rules the pipeline applies again when the file lands, so what would fail is refused while the admin is still watching, and the pipeline refuses an object nobody presigned.

**Why a Workflow instance per upload.** A queue adds consumers slowly and only as a backlog builds, so fifty photos processed by the consumer run nearly one at a time; as fifty Workflow instances they run at once, each with a Worker's memory to itself and each step retried on its own. R2 may announce an upload twice, and an instance name can be used once, so a second announcement starts nothing.

**Why these steps.** A step boundary persists its result and costs time, so a step ends only where a retry must respect a change of state. A step never hands the file to the next, since its result is stored. The images are made before the item is written, so a file the Images binding cannot decode becomes an upload error instead of a broken image in an album. The item is written by the album's id, so an album renamed during the upload still receives it.

## Serving images and video

The album page asks for `/i/2001/06-15/felix.heic/0muhjn6yo3f9a1c07b2e4d58a?size=200x200`, or `size=400x400` from a screen with two device pixels per CSS pixel, since each thumbnail offers both in its `srcset`:

1. **The colo's cache.** A hit is answered there.
2. **The derived bucket**, under `derived/0muhjn6yo3f9a1c07b2e4d58a/200x200-webp`, the name spelled from the URL and the format the browser gets.
3. **Made on the spot** with the Images binding, from the version's poster if it is a video, or else its original, then stored in the derived bucket and cached.

Every image is cached for a year, since its URL names one version and a new upload has a new URL. The path in the URL is for people reading it, in the network panel or the logs; only the version finds the object, so an old URL keeps working after a rename.

- **Thumbnails are WebP, the media page's image is JPEG.** The Images binding leaves the original's IPTC and XMP blocks and most of its EXIF, GPS position included, in a JPEG whatever its `metadata` option says, three quarters of a thumbnail's bytes; its WebP carries nothing. The media page's image stays JPEG because readers drag it into other apps, most of which cannot open a WebP. A browser whose `Accept` header does not name `image/webp`, Safari before 14, gets a JPEG thumbnail made for the first one that asks. The format is part of the colo cache's key and the response says `Vary: Accept`, so one URL serves each browser its own.
- `/raw/<path>/<versionId>` is the original. A HEIC comes back as a JPEG, since only Safari shows HEIC, unless `?format=original` asks for the file itself.
- `/v/<path>/<versionId>` is a video's MP4, with byte ranges for seeking.

**The transcoder** is ffmpeg in a Container (`api/transcoder/`) behind a Durable Object, asleep between videos. The Worker hands it presigned URLs to read the original and write the MP4 and poster, and it answers with the video's size and duration.

**Why one spelling.** `shared/src/urls.ts` builds every image URL, for the app and for the pipeline's pre-made images alike, and the stored name is spelled from the same text. A stored image is found only by a URL spelled exactly the same way, so there must be one place that spells them.

**Why the media routes need no login.** Knowing a version id is knowing the photo, and 64 random bits cannot be guessed. Each route reads only the objects under the version it names, so nothing else in either bucket, the dumps and the inbox included, is reachable through them. Checking whether the album is published would cost a database read on routes that otherwise need none.

**Why originals stay as uploaded**, HEIC included: the Images binding decodes HEIC, so nothing is converted on the way in and nothing in the pipeline is specific to HEIC.

## Authentication

- Admins log in with passkeys (`api/src/auth/`). There is no password and no identity service.
- The users are seeded by a migration. An invite link lets its holder register a passkey as one of them, once.
- A passkey is bound to the site's origin, `SITE_ORIGIN` in each environment's vars, or `localhost` in development.
- A session is a signed cookie holding the admin's name and an expiry. Checking it reads no database; the price is that a session can be ended early only by rotating `SESSION_SECRET`, which logs everyone out.
- Reads never require login. Writes always do.

## Headers and crawlers

The site stays out of search engines and AI training:

- Every response says `noindex` and refuses AI training; the media routes also refuse being embedded by other sites.
- `robots.txt` lets ordinary crawlers in so they see the `noindex`; Cloudflare's zone settings add its list of AI crawlers to it and turn those crawlers away.
- Two places answer requests, so the headers are set twice: `api/src/http/headers.ts` for the Worker and `web/static/_headers` for the app's files. A test holds the two copies together.
- The derived bucket's public host bypasses the Worker, so a zone rule in `infra/main.tf` gives it the same headers.

## The code

```text
shared/src/        record and request schemas, the path grammar, naming rules, URL builders
api/src/index.ts   the three handlers, wired to the layers
api/src/routes/    HTTP: parse the request, check the admin, call gallery/, shape the response
api/src/gallery/   the operations: reads, writes, search, presign, the upload pipeline
api/src/auth/      passkeys, sessions, the login and invite pages
api/src/ops/       health, backup, and the performance measurements
api/src/http/      responses, cookies, the bookmark, the site's headers
api/src/db/        the schema, and Drizzle over D1 sessions
api/src/storage/   object keys and S3 presigning
api/src/media/     the metadata reader, the Images binding, the transcoder
web/               the SvelteKit app
e2e/               Playwright journeys through the built app and a local Worker
```

**The layers are enforced** by import rules and a cycle check in `eslint.config.ts`. Nothing imports `routes/`. `gallery/` never sees HTTP: who is asking arrives as a boolean. The bottom layers import `shared/` and not each other.

**The shapes live in `shared/`.** The Worker maps rows to its schemas and the app parses responses with them; neither side imports the other, and `shared/` imports neither.

**The web app** is the AWS SvelteKit app ported to this back end, so the API answers in the shapes it was written against; it changes wherever that makes the site faster for its readers, and `docs/Perf.md` records each difference from the AWS app. Which paths reach the Worker rather than the app's files is the `run_worker_first` list in `api/wrangler.jsonc`, so a new Worker route has to be added there; any other path with no file gets the app, which routes it in the browser.

## Tests

- D1, R2, the Queue and the Images binding run locally, so tests run real SQLite with its triggers and put real objects in real buckets.
- Only the ffmpeg container and outside HTTP services are stood in for.
- Every query has a budget of rows it may read, since a query that scans a table is slow as well as costly.
- `docs/Testing.md` has the tiers and the rules.

## Environments and releases

- Staging and production are two Workers from one `api/wrangler.jsonc`, each with its own database, buckets, queues, secrets and passkeys.
- Staging is the config's top level, which is also what `wrangler dev` and the tests run, so only `--env production` reaches production.
- A push to a pull request releases it to staging; a merge to `main` releases production.

A release (`scripts/release.sh`) is blue/green:

1. Upload a new version, which serves nothing yet.
2. Apply the migrations. The version still serving survives them, since they are additive.
3. Put the new version in the deployment at 0% and check it on the live hostname through the version-override header.
4. Switch it to 100%, check again, and roll back if that fails.
5. Apply the config's triggers, the crons and the custom domain, which a version release leaves as they were.

Traffic is never split between versions, since a split would serve one version's `index.html` with the other's files. A version release cannot ship a container image, a Durable Object change, a new Workflow or a queue consumer's settings; those need a plain `wrangler deploy`.

## Jobs

- **Nightly**: dump the database to `backups/d1/` in the media bucket, and delete upload errors and spent login challenges past their use. The search index is rebuilt from `item` on a restore, so it is not dumped.
- **`GET /api/health`** answers with the running version and the newest migration, which is what a release checks.
- **Measurement.** The rest of `api/src/ops/`, and routes such as `/i2/` and `/debug/`, serve the performance work in `docs/Perf.md`, not the gallery.

## Invariants

The rules a change is most likely to break without noticing, each explained in the section named.

- Everything is served from the site's own origin; only the upload's PUT leaves it. (The pieces)
- Anything kept to act on later references a row by id, never by path. (Database)
- A rule about one row is a constraint in `schema.ts`; a constraint failing is a bug. (Database)
- A rule that depends on another row is a condition of the writing statement, never a read beforehand. (Writing)
- Migrations are additive. (Database)
- No gallery write touches a bucket, nothing overwrites an object, and no object key contains a path. (Storage)
- Presign and the pipeline refuse by the same rules. (Uploading)
- A pipeline step ends only where a retry must respect a change of state, and never hands the file on. (Uploading)
- Every image URL, and the name its image is stored under, is spelled by `shared/src/urls.ts`. (Serving images and video)
- A media route reads only the objects under the version it names, and checks no row. (Serving images and video)
- `gallery/` never sees HTTP; `shared/` imports neither side. (The code)
- A new Worker route is added to `run_worker_first`. (The code)
