# Architecture

## The pieces

The whole site is one Worker per environment, serving the web app and everything behind it from the site's own hostname.

```text
     the site's hostname (pix.deanmoses.com, staging-pix.deanmoses.com)
                                  |
                 +----------------+----------------+
                 |                                 |
           static assets                      Worker code
          (the web app)               (/api, /i, /raw, /v)
                                                   |
       +------------+------------+-----------+-----+------+
       |            |            |           |            |
       D1       R2 x4        Images     Container
                                        (ffmpeg)

  media upload:  browser --PUT--> R2 uploads --event--> Queue --> Worker --> Workflow
```

| Piece                            | What it does                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| **`api/` (worker)**              | Serves the app's files, the API, login and the media; consumes upload events; runs the cron |
| **`web/` (web app)**             | The SvelteKit single-page app, built to static files the Worker serves                      |
| **`shared/`**                    | Code shared between the worker and web app: record shapes, path grammar, URL builders       |
| **`infra/` (OpenTofu)**          | Creates everything outside the Worker: the zone, the database, the buckets, the queues      |
| **Cloudflare D1**                | The database: every album and media item, the search index, uploads, login                  |
| **Cloudflare R2, three buckets** | `originals`, `uploads` as they arrive, `derived` images and video                           |
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
/2001/06-15/felix        a media item, always in a day album
```

`shared/src/paths.ts` is the grammar.

- **An album** has a description, a one-line summary, a published flag, and the media item it shows as its thumbnail, from anywhere in its subtree. A day album can be published only while its year is. A day album's media is in name order, since files are usually named in the order they should show before they are uploaded, until an admin drags it into an order of their own; media added after that goes at the end, in name order, until the next reorder.
- **A media item** is an image or a video, decided by the file's first bytes when it is uploaded. It has the version id of its current file, its size, a video's duration, a title, a description, a set of tags, and the rectangle its thumbnail is cut from. It shows whenever its album does.

## Database

Cloudflare D1 (SQLite) holds everything but the media files. Tables:

- `item`: every album and media item, one row each
- `item_fts` and `item_fts_exact`: the search indexes, stemmed and as typed, built over `item_indexed`, a view of `item` that splits letters from digits in every name and caption and adds the words photo, image and picture to an image's tags and movie, video and clip to a video's
- `upload`: every upload the Worker has handed out a URL for, and whether it finished
- `upload_error`: errors during async media upload/processing, for the admin UI to show
- `user`: admins
- `passkey`: passkeys for admins
- `invite`: invites for admins to create a passkey
- `spent_challenge`: used login challenges

The schema defined in Drizzle in `api/src/db/schema.ts`.

An `item` row is identified by `(parent_path, item_name)`, so `felix` in `/2001/06-15/`, and referenced by its integer `id`. A media name is lowercase letters and digits with single underscores between them, and carries no extension: what kind of file the item is, `media_type` and the original's content type say.

- **Search** is SQLite's FTS5, in the same database. Words and phrases are matched in `item_fts`, the porter stemmer over the unicode61 tokenizer, which folds case and accents; a prefix is matched in `item_fts_exact`, unicode61 alone, since the stemmer would stem the prefix too and `vacati` is no prefix of `vacat`. Triggers keep both in step with `item` by reading the changed row through the view, firing only when a column the view reads changes.
- **Migrations** are written by drizzle-kit from `schema.ts` into `api/migrations/`. The search index, its view and its triggers are raw SQL in a migration, since Drizzle models none of them.
- **Read replicas.** Reads go through a D1 session, so the nearest replica can answer. Every write answers with the session's bookmark, as a header and a short-lived cookie, and a read that brings a bookmark back is served by a copy at least that new, so an admin sees their own save from whichever replica answers.

**Why the rules are in the database.** Every rule about a single row, the path grammar, required fields, formats, one type's fields being empty for the other, a crop fitting inside its image, is a named constraint in `schema.ts`, so nothing, a hand-run script included, can write a row that breaks one. What a constraint cannot express, a rule that looks at another row, is checked in `api/src/gallery/`, and so is every rule a user should see explained. So a broken rule the user can fix is a 400 with a message, and a constraint failing is a bug, answered with a 500.

**Why a path is for now and an id is for later.** A request names what it acts on by path, and the statement resolves the path as it runs, so a path that moved since the page loaded answers 404. But anything the database keeps in order to act on later, an album's thumbnail, the album an upload goes into, the item an upload replaces, references a row's id, with a foreign key that clears it when that row is deleted. So a reference cannot be renamed out from under, and a deleted one leaves a null rather than a dangling path.

**Why migrations are additive.** During a release the old and new Worker versions share one database, so a column is removed only in a later release than the one that stopped using it.

## Storage

Media is stored in Cloudflare R2, in a bucket per role, because an R2 API token is scoped to whole buckets: the key the Worker signs upload and transcode URLs with reaches `uploads` and `derived` and no other, so nothing a signed URL can do touches an original or a dump. Each environment's buckets are named for it, `production-originals` and so on.

Take the photo `/2001/06-15/felix`, whose current version id is `0muhjn6yo3f9a1c07b2e4d58a`. Everything stored for it is keyed by that id:

```text
uploads bucket
  inbox/0muhjn6yo3f9a1c07b2e4d58a                   the upload as it arrived, dropped once processed; a week at most

originals bucket
  originals/0muhjn6yo3f9a1c07b2e4d58a               the file as uploaded, written once

derived bucket
  derived/0muhjn6yo3f9a1c07b2e4d58a/200x200-webp    the album page's thumbnail
  derived/0muhjn6yo3f9a1c07b2e4d58a/400x400-webp    the same for a 2x screen
  derived/0muhjn6yo3f9a1c07b2e4d58a/1024            the media page's image, in the format its original calls for
  derived/0muhjn6yo3f9a1c07b2e4d58a/…               any other size or crop, made the first time it is asked for
  derived/<versionId>/video.mp4, poster.jpg         for a video: its transcode, and the still its images are cut from
```

A version id is the moment it was minted, in base 36, followed by 64 random bits, so listings come out in upload order and an id cannot be guessed. `api/src/storage/keys.ts` builds every key. Each original also carries the path it was uploaded to as metadata, and `api/scripts/media.ts` prints an item's row and every object stored for it.

**Why no path is in a key.** An original is written once and never overwritten, and the `item` row says which version is current. So create, edit, publish, rename, set a thumbnail and delete are database writes that touch no object: renaming an album full of photos is one batch of row updates. A replacement is a new version, and a delete leaves the objects, so either can be undone by pointing a row back at the old version. Objects no row references any more stay where they are.

## Reading

The app reads `GET /api/album/2001/06-15/`:

1. The Worker opens a D1 session, so the nearest read replica can answer.
2. It reads the album's row and its children's rows, and nothing else.
3. A guest gets only published albums; an admin gets everything.
4. The rows go out in the record shapes `shared/` defines, which the app parses with the same schemas.

The app works out the previous and next albums from the parent's children, so a read never depends on anything outside the album's own subtree.

The album page's own headers, from `web/static/_headers`, name this request and the parent's as preloads, so the browser sends them as the page arrives rather than after the app's JS has loaded and run; with the zone's Early Hints on, it sends them before the page's body.

**Search** takes the syntax the gallery's search has always had, RediSearch's: words anywhere, `"an exact phrase"`, `pre*` for a prefix, `-not this`, `this|that`, `@title:word` or `@title|tags:(some words)` to look in a field, and parentheses to group; the fields are name, title, description, tags and summary. `api/src/gallery/query.ts` compiles it to a tree of FTS5 matches that the search joins in SQL, so that nothing typed is a syntax error, dropping the stop words RediSearch dropped and splitting letters from digits as the index does, so `pat` and `pat1` both find `pat1`. A search that asks for nothing, or only for words to leave out, or names a field the index lacks, or has more than 32 words or parentheses nested more than 8 deep, is refused with a message, which the search page shows. Results come by day, newest first unless asked otherwise, each day's album before its media in album order; guests see published albums and what is in them.

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
- Reordering a day album is one statement that gives each of its media rows its place in the order the admin saved, looked up by name, and none to media the order leaves out. The album read sorts by name in SQL, which the path index gives for free, and puts the placed media first in the Worker, since a sort in SQL passes every row through a temporary B-tree that D1 counts as reading it again. `DELETE /api/album-order/<path>` clears the places, which is back to name order.
- `PUT /api/item` writes a whole row as given: the import path. When a constraint refuses the row it answers with the constraint's name.

**Why a write's conditions are in its statement.** D1 has no interactive transactions: its one atomic unit is a batch of statements fixed before any runs, so a write cannot read, decide and then write. A rule that depends on another row is a condition of the writing statement instead, an `EXISTS` in its `WHERE` or an `INSERT … SELECT` that selects nothing when the rule fails. There is never a race between a check and the write it guards.

## Uploading

An admin drops `Felix.HEIC` on `/2001/06-15/`, which the app names `felix`:

```text
app                        Worker                          R2 / Queue / Workflow
 | POST /api/presigned/2001/06-15/                               |
 |   [{ path: "/2001/06-15/felix" }]                             |
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

**Replacing.** Dropping a file on an existing item updates that row in place: new version, type and size, under the name the row has. Any file may replace any item, so an edited JPEG replaces the HEIC it came from, and a video may replace a photo. Captions and every album showing it are kept, and the file's tags join the row's. The thumbnail crop is kept only if the new image has exactly the old size.

**When it fails.** A file that cannot be read or decoded, or an album or item deleted while the upload was in flight, becomes an `upload_error` row, which the app polls for after a drop. Anything else throws, and the step is retried; once its retries are spent, the error's message becomes the `upload_error` row, and the inbox object stays for a replay.

**Locally**, a Worker cannot consume a real queue, so with `UPLOAD_MODE=local` presign hands out the Worker's own `/upload/<versionId>`, which stores the file and raises the event R2 would. The pipeline runs unchanged.

**Why presign judges first.** Presign applies the rules the pipeline applies again when the file lands, so what would fail is refused while the admin is still watching, and the pipeline refuses an object nobody presigned.

**Why a Workflow instance per upload.** A queue adds consumers slowly and only as a backlog builds, so fifty photos processed by the consumer run nearly one at a time; as fifty Workflow instances they run at once, each with a Worker's memory to itself and each step retried on its own. R2 may announce an upload twice, and an instance name can be used once, so a second announcement starts nothing.

**Why these steps.** A step boundary persists its result and costs time, so a step ends only where a retry must respect a change of state. A step never hands the file to the next, since its result is stored. The images are made before the item is written, so a file the Images binding cannot decode becomes an upload error instead of a broken image in an album. The item is written by the album's id, so an album renamed during the upload still receives it.

## Serving images and video

The album page asks for `/i/2001/06-15/felix/0muhjn6yo3f9a1c07b2e4d58a?size=200x200`, or `size=400x400` from a screen with two device pixels per CSS pixel, since each thumbnail offers both in its `srcset`:

1. **The colo's cache.** A hit is answered there.
2. **The derived bucket**, under `derived/0muhjn6yo3f9a1c07b2e4d58a/200x200-webp`, the name spelled from the URL and the format it settles, and served as the type it was stored with.
3. **Made on the spot** with the Images binding, from the version's poster if it is a video, or else its original, then stored in the derived bucket and cached.

Every image is cached for a year, since its URL names one version and a new upload has a new URL. The path in the URL is for people reading it, in the network panel or the logs; only the version finds the object, so an old URL keeps working after a rename.

- **Thumbnails are WebP; the media page's image is WebP for a GIF or a PNG and JPEG for anything else**, as on AWS. The Images binding leaves the original's IPTC and XMP blocks and most of its EXIF, GPS position included, in a JPEG whatever its `metadata` option says, three quarters of a thumbnail's bytes; its WebP carries nothing. A GIF's WebP keeps its frames and a PNG's its transparency. The media page's image of a photo stays JPEG because readers drag it into other apps, most of which cannot open a WebP. Its format comes from the original's content type, sniffed from its bytes at upload, so its derivative's name carries no format. Every browser the app supports shows WebP, so no `Accept` header is read and responses carry no `Vary`. The colo cache keys an image by its derived bucket name rather than its URL, so a renamed item's old and new URLs, and a URL with a stray query parameter, share one entry.
- `/raw/<path>/<versionId>` is the original. A HEIC comes back as a JPEG, since only Safari shows HEIC, unless `?format=original` asks for the file itself.
- `/v/<path>/<versionId>` is a video's MP4, with byte ranges for seeking.

**The transcoder** is ffmpeg in a Container (`api/transcoder/`) behind a Durable Object, one instance per video on the largest instance type, so a drop of several videos transcodes them side by side, each asleep once its video is done. The Worker hands it presigned URLs to read the upload from the uploads bucket and write the MP4 and poster into the derived bucket, and it answers with the video's size and duration. The signing key reaches no original, so a stored video can be transcoded again, after a change to the ffmpeg settings say, only once the Worker has copied its original back into the uploads bucket through the bindings; nothing does that yet. When the Worker stops waiting, as when its step times out, the container kills the encode, so a retry never shares the CPU with the attempt before it.

**Why one spelling.** `shared/src/urls.ts` builds every image URL, for the app and for the pipeline's pre-made images alike, and the stored name is spelled from the same text. A stored image is found only by a URL spelled exactly the same way, so there must be one place that spells them.

**Why the media routes need no login.** Knowing a version id is knowing the photo, and 64 random bits cannot be guessed. Each route reads only the objects under the version it names, in the originals and derived buckets, so nothing else, the dumps and the inbox included, is reachable through them. Checking whether the album is published would cost a database read on routes that otherwise need none.

**Why originals stay as uploaded**, HEIC included: the Images binding decodes HEIC, so nothing is converted on the way in and nothing in the pipeline is specific to HEIC.

## Authentication

- Admins log in with passkeys (`api/src/auth/`). There is no password and no identity service.
- The users are seeded by a migration. An invite link lets its holder register a passkey as one of them, once.
- A passkey is bound to the site's origin, `SITE_ORIGIN` in each environment's vars, or `localhost` in development.
- A session is a signed cookie holding the admin's name and an expiry, sent by the browser only with requests from the site's own pages, as the AWS token cookies were. A site to the browser is the registrable domain, so a page on another host of it, staging say, sends it too; what keeps such a page from writing is that every write from a browser must name the site's own origin in `Origin`. Checking the cookie reads no database; the price is that a session can be ended early only by rotating `SESSION_SECRET`, which logs everyone out.
- Reads never require login. Writes always do.
- Every `/api/` response says what the Worker made of the cookie in `x-auth-status`: `none`, `valid` or `invalid`. A read with a refused cookie, usually an expired one, is answered with the guest view, so `invalid` is how the app learns mid-visit that its admin is a guest now: it drops its admin state and asks them to log in again.

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
api/src/auth/      passkeys and sessions
api/src/ops/       health, and the performance measurements
api/src/http/      request bodies, responses, cookies, the bookmark, the site's headers
api/src/db/        the schema, and Drizzle over D1 sessions
api/src/storage/   object keys and S3 presigning
api/src/media/     the metadata reader, the Images binding, the transcoder
web/               the SvelteKit app
e2e/               Playwright journeys through the built app and a local Worker
```

**The layers are enforced** by import rules and a cycle check in `eslint.config.ts`. Nothing imports `routes/`. `gallery/` never sees HTTP: who is asking arrives as a boolean. The bottom layers import `shared/` and not each other.

**The shapes live in `shared/`.** The Worker maps rows to its schemas and the app parses responses with them; neither side imports the other, and `shared/` imports neither.

**So do the endpoints.** `API` in `shared/src/api.ts` lists every endpoint with its method, its path, whether only an admin may call it, and the schema of the body it takes, carried in the entry's type alone. The Worker registers its routes from `API` and parses bodies with `API_BODIES`, which the type check holds to the schemas the entries name; the app sends every admin request through `callApi(API.renameAlbum, path, body)`, whose path and body are typed by the entry, so a renamed route or a changed body fails the type check on both sides. Because the entries hold no schema, a guest's page can use `API` without downloading one. Three things the table cannot type are held by tests instead: every endpoint has a route (`api/test/unit/routes.test.ts`), every admin endpoint refuses a guest (`api/test/integration/auth.test.ts`), and the album preloads in `web/static/_headers` name the URLs the app reads (`api/test/stack/headers.test.ts`). The search query string and the passkey answers are checked by the Worker alone.

**The web app** is the AWS SvelteKit app ported to this back end, so the API answers in the shapes it was written against; it changes wherever that makes the site faster for its readers, and `docs/Perf.md` records each difference from the AWS app. It has to load in iOS 15.6, the floor in `.browserslistrc`, which lint and the build enforce (Front end in `README.md`). Which paths reach the Worker rather than the app's files is the `run_worker_first` list in `api/wrangler.jsonc`, so a new Worker route has to be added there; any other path with no file gets the app, which routes it in the browser.

## Tests

- D1, R2, the Queue and the Images binding run locally, so tests run real SQLite with its triggers and put real objects in real buckets.
- Only the ffmpeg container and outside HTTP services are stood in for.
- Every query has a budget of rows it may read, since a query that scans a table is slow as well as costly.
- `docs/Testing.md` has the tiers and the rules.

## Environments and releases

- Staging and production are two Workers, `staging` and `production`, from one `api/wrangler.jsonc`, each with its own database, buckets, queues, secrets and passkeys, every one named for the environment and its role.
- Staging is the config's top level, which is also what `wrangler dev` and the tests run, so only `--env production` reaches production.
- A push to a pull request releases it to staging; a merge to `main` releases production.

A release (`scripts/release.sh`) is blue/green:

1. Upload a new version, which serves nothing yet.
2. Apply the migrations. The version still serving survives them, since they are additive.
3. Put the new version in the deployment at 0% and check it on the live hostname through the version-override header.
4. Switch it to 100%, check again, and roll back if that fails.
5. Apply the config's triggers, the crons and the custom domain, which a version release leaves as they were.

Traffic is never split between versions, since a split would serve one version's `index.html` with the other's files. A version release cannot ship a Durable Object change, a new Workflow or a queue consumer's settings; those need a plain `wrangler deploy`. Nor does a version carry the container's image or settings, so the release sets those on the container application itself, through the Containers API, before it uploads the version.

## Jobs

- **Nightly**: delete upload errors and spent login challenges past their use. The backup is not the Worker's job: a GitHub workflow exports the database and copies the originals off-site (Backup and restore in `README.md`).
- **`GET /api/health`** answers with the running version and the newest migration, which is what a release checks.
- **Measurement.** The rest of `api/src/ops/`, and `/debug/`, serve the performance work in `docs/Perf.md`, not the gallery.

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
