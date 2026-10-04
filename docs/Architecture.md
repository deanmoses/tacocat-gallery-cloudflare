# Architecture

## Invariants

Rules a change is most likely to break:

- A rule that depends on another row is a condition of the writing statement, never a read beforehand. ([`DataModel.md`](DataModel.md))
- A new Worker route is added to `run_worker_first`. ([The code](#the-code), below)
- Anything kept to act on later references a row by id, never by path. ([`DataModel.md`](DataModel.md))
- A rule about one row is a constraint in `schema.ts`; a constraint failing is a bug. ([`DataModel.md`](DataModel.md))
- Every image URL, and the name its image is stored under, is spelled by `shared/src/urls.ts`. ([`Media.md`](Media.md))
- No gallery write touches a bucket, nothing overwrites an object, and no object key contains a path. ([`Storage.md`](Storage.md))
- A media route reads only the objects under the version it names, and checks no row. ([`Media.md`](Media.md))
- Presign and the pipeline refuse by the same rules. ([`Uploads.md`](Uploads.md))

## The pieces

The entire site is one Worker per environment, serving the web app and everything behind it from the site's own hostname.

```text
     the site's hostname (pix.tacocat.com, staging-pix.tacocat.com)
                                  |
                 +----------------+----------------+
                 |                                 |
           static assets                      Worker code
          (the web app)               (/api, /i, /raw, /v)
                                                   |
       +------------+------------+-----------+-----+------+
       |            |            |           |            |
       D1       R2 x2        Images     Container
                                        (ffmpeg)

  media upload:  browser --PUT--> R2 originals, --POST--> Worker --> Workflow
                 (R2's event --> Queue --> Worker is the backstop)
```

| Piece                          | What it does                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| **`api/` (worker)**            | Serves the app's files, the API, login and the media; consumes upload events; runs the cron |
| **`web/` (web app)**           | The SvelteKit single-page app, built to static files the Worker serves                      |
| **`shared/`**                  | Code shared between the worker and web app: record shapes, path grammar, URL builders       |
| **`infra/` (OpenTofu)**        | Creates everything outside the Worker: the zone, the database, the buckets, the queues      |
| **Cloudflare D1**              | The database: every album and media item, the search index, uploads, login                  |
| **Cloudflare R2, two buckets** | `originals` as uploaded, and `derived` images and video                                     |
| **Image Transformations**      | Resizes and crops images, HEIC included, fetched by a URL the Worker signs                  |
| **Cloudflare Queue**           | Carries R2's event for each finished upload to the Worker, the backstop for its uploader    |
| **Cloudflare Workflow**        | Runs one upload pipeline per uploaded file                                                  |
| **Cloudflare Container**       | ffmpeg, for transcoding video                                                               |

**One origin.** There's no `api.`, `img.` or `auth.` subdomains, meaning there's no CORS between the app and the API, the session cookie needs no cross-site settings, and every URL the app builds is a root-relative path with no host. The one request that leaves the origin is the upload itself, a PUT straight to R2's S3 endpoint, so the originals bucket alone carries a CORS rule, in `infra/`.

The Worker's default export in `api/src/index.ts` has three handlers: `fetch`, the Hono app in `api/src/routes/app.ts`; `queue`, which starts a Workflow instance for each upload event and turns an event that ran out of retries into an upload error; and `scheduled`, the nightly job that deletes upload errors and spent login challenges past their use. The bindings are declared in `api/wrangler.jsonc`, and `GET /api/health` is what a release checks (Is production okay? in [`Observability.md`](Observability.md)).

## The gallery

The gallery is a tree of year and day albums holding images and videos, and a path is a URL: `/2001/06-15/felix` is a media item in a day album. [`DataModel.md`](DataModel.md) has the paths, the rows, the rules and the search index.

## Common flows

- **Reading an album.** `GET /api/album/2001/06-15/` opens a D1 session so the nearest replica can answer, reads the album's row and its children's and nothing else, filters to published albums for a guest, and answers in the record shapes `shared/` defines. The album page's headers preload this request and the parent's. ([`DataModel.md`](DataModel.md))
- **Serving media.** `/i/<path>/<versionId>?size=…` is answered from the colo's cache, then the derived bucket, then made on the spot by Image Transformations and stored. `/raw/` is the original and `/v/` a video's MP4. Every object is keyed by version id alone, so a rename touches no object and an old URL keeps working. ([`Storage.md`](Storage.md), [`Media.md`](Media.md))
- **Searching.** `GET /api/search` compiles the RediSearch syntax the gallery has always had into FTS5 matches in the same database, so nothing typed is a syntax error, and answers by day, newest first. ([`DataModel.md`](DataModel.md))
- **Writing**, whether a caption, a rename, a publish, a reorder or a delete. Every write needs a logged-in admin and is one statement whose cross-row rules are conditions in its `WHERE`, since D1 has no interactive transactions. When the statement changed nothing, one read says why, and the answer is a 400 with a message or a 404. A write answers 204 with the session's bookmark, so the admin's next read sees it from any replica. ([`DataModel.md`](DataModel.md))
- **Uploading.** The app asks the Worker to presign a PUT of the original to `originals/<versionId>`, PUTs the file straight to R2, and tells the Worker it landed; the Worker starts a Workflow instance named by the version id, which reads the file's facts or transcodes the video, writes the item in one batch and makes the media page's image. R2's event through the Queue is the backstop. ([`Uploads.md`](Uploads.md))

Admins log in with passkeys, sessions are signed cookies, reads never need login and writes always do, and every response tells search engines and AI crawlers to stay out. ([`Auth.md`](Auth.md))

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
api/src/media/     the metadata reader, image making, the transcoder
```

**The layers are enforced** by import rules and a cycle check in `eslint.config.ts`. Nothing imports `routes/`. `gallery/` never sees HTTP: who is asking arrives as a boolean. The bottom layers import `shared/` and not each other.

**The shapes live in `shared/`.** The Worker maps rows to its schemas and the app parses responses with them; neither side imports the other, and `shared/` imports neither.

**So do the endpoints.** `API` in `shared/src/api.ts` lists every endpoint with its method, its path, whether only an admin may call it, and the schema of the body it takes, carried in the entry's type alone. The Worker registers its routes from `API` and parses bodies with `API_BODIES`, which the type check holds to the schemas the entries name; the app sends every admin request through `callApi(API.renameAlbum, path, body)`, whose path and body are typed by the entry, so a renamed route or a changed body fails the type check on both sides. Because the entries hold no schema, a guest's page can use `API` without downloading one. Three things the table cannot type are held by tests instead: every endpoint has a route (`api/test/unit/routes.test.ts`), every admin endpoint refuses a guest (`api/test/integration/auth.test.ts`), and the album preloads in `web/static/_headers` name the URLs the app reads (`api/test/stack/headers.test.ts`). The search query string and the passkey answers are checked by the Worker alone.

**The web app** started as the AWS gallery's SvelteKit app, so the API answers in the shapes it was written against; it changes wherever that makes the site faster for its readers, and `docs/plans/migration_from_aws/PerfVsAws.md` records how it had come to differ from the AWS app by the time the two stopped being compared. It has to load in iOS 15.6 (The browser floor in `Development.md`). Which paths reach the Worker rather than the app's files is the `run_worker_first` list in `api/wrangler.jsonc`, so a new Worker route has to be added there; any other path with no file gets the app, which routes it in the browser.

**Beyond this page:** the web app's stores, cache and components are `WebApp.md`; how it is tested is `Testing.md`; how a change ships, `Releasing.md`; the running system, `Operations.md`; its logs, alerts and uptime checks, `Observability.md`; everything outside the Worker, `Infrastructure.md`; and the measurements `api/src/ops/` and `/debug/` serve, `Perf.md`.
