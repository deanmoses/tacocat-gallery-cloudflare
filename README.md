# tacocat-gallery-cloudflare

Throwaway prototype to find out whether moving pix.tacocat.com to Cloudflare works. The goals and the vendor comparison are in `docs/plans/Hosting.md` and `docs/plans/HostingDeepDive.md` in the `tacocat-gallery-sam` repo. If the risks below are retired, this repo gets emptied and rebuilt properly; nothing here is meant to survive.

One Worker holds every spike, with one D1 database, one R2 bucket, one Queue and the Images binding. It is deployed to `workers.dev`, so the tacocat.com DNS move is not needed yet.

## Risk register

| #   | Risk                                                                                  | Spike                                                                         | Local result                                                                            | Remote result |
| --- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------- |
| 1   | Worker plus D1 replica read is not under 100 ms from California, Louisiana and France | `GET /api/album/<path>`, `scripts/probe.sh`, Grafana probes from Paris        | n/a                                                                                     | pending       |
| 2   | Read-your-writes after an admin save is slow or wrong                                 | `POST /api/item` returns `x-d1-bookmark`; pass it to the next `GET`           | n/a                                                                                     | pending       |
| 3   | FTS5 triggers do not keep the search index in sync on D1                              | `migrations/0001_init.sql`; insert, upsert, update, delete, then compare      | ✅ in sync through insert, upsert, update and delete                                    | pending       |
| 4   | Time Travel restore leaves the FTS5 table inconsistent                                | `wrangler d1 time-travel restore`, then compare `item` and `item_fts` counts | n/a                                                                                     | pending       |
| 5   | No workable D1 backup, because `wrangler d1 export` refuses FTS5                      | `POST /api/backup` and the nightly cron dump `item` to R2 as JSON              | not run                                                                                 | pending       |
| 6   | Images binding cannot reproduce the crop-then-cover thumbnails                        | `GET /i/<path>/<versionId>?size=200x200&crop=x,y,w,h`                          | ✅ 200x200 generated, stored in R2, served from R2 the second time                      | pending       |
| 7   | Images binding mishandles EXIF orientation or HEIC                                    | same, on `PortraitOrientation6.jpg` and `FullMetadataHeic.heic`                | ⚠️ local emulator ignores orientation and cannot decode HEIC; says nothing about remote | pending       |
| 8   | Images binding bills something at zero usage, or needs a paid plan                    | check the dashboard and invoice after enabling                                | n/a                                                                                     | pending       |
| 9   | R2 event notification to Queue to Worker is not a usable upload pipeline              | `PUT /upload/<path>` into `inbox/`, consumer reads IPTC and writes the item    | not emulated locally                                                                    | pending       |
| 10  | Browser presigned PUT to R2 fails on CORS or needs a custom domain                    | not built yet; needs an R2 S3 API token                                        |                                                                                         | pending       |
| 11  | Video: Stream cannot take iPhone HEVC, or an ffmpeg Container is too awkward          | not built yet                                                                  |                                                                                         | pending       |
| 12  | Access plus Google login on `/admin/*` does not suit four admins                      | not built yet                                                                  |                                                                                         | pending       |

## Running it

```bash
npm install
npm run db:migrate:local
npm run dev
```

## Deploying to your account

`cloudflared` is the Tunnel client; everything here uses `wrangler`, installed as a dev dependency.

```bash
npx wrangler login
npx wrangler d1 create tacocat-proto --location wnam   # paste the database_id into wrangler.jsonc
npx wrangler r2 bucket create tacocat-proto-media --location wnam
npx wrangler queues create tacocat-proto-uploads
npx wrangler r2 bucket notification create tacocat-proto-media --event-type object-create --queue tacocat-proto-uploads --prefix inbox/
npm run db:migrate
npm run deploy
```

Read replication is off by default and has to be turned on through the REST API (see the D1 read replication docs).
