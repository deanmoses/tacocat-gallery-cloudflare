# The AWS site

The gallery this repo replaced ran on AWS from December 2023 to 2026-10-02, and stays up, unedited, until it is retired (deanmoses/tacocat-gallery-sam#179). This page is where a comparison with it starts: what it was made of, which repo holds each part, and how each part maps to this Worker. The repos are checked out beside this one (`../<repo>`, and on GitHub under `deanmoses`), and `docs/Ecosystem.md` in `tacocat-gallery-sveltekit` maps how they fit together.

## How it works

The web app is a SvelteKit single-page app, built to static files on S3 and served by CloudFront on `pix.tacocat.com`. Everything else is on a subdomain of its own: the API on `api.pix.tacocat.com` is API Gateway in front of a Lambda per operation, the images on `img.pix.tacocat.com` are a CloudFront distribution whose misses call a Lambda that makes the derived image with Sharp, and login on `auth.pix.tacocat.com` and `login.tacocat.com` is Cognito's hosted UI, so every API call crosses origins with CORS and a credentials option. The data is one DynamoDB table, every album and media item a row, with the rules about rows in the Lambdas that write them; the originals are in a versioned S3 bucket keyed by gallery path, so a rename copies every original and derivative, and a replacement is a new S3 version the row points at, with `revertS3Version` and a 24-day expiry to undo one. An upload is a presigned PUT to S3, whose event runs a Lambda per file that reads the metadata, converts a HEIC to JPEG, and writes the row; a video goes through MediaConvert, whose completion event finishes the row. Search is RediSearch on Redis Labs, configured by hand in its dashboard with no repo, fed from the table by a DynamoDB stream and a sync Lambda. AWS Backup keeps the originals. The logs, CloudFront's TSV files in S3, CloudWatch and Grafana, were pulled into a DuckDB database to be queried at all.

## The repos

| Repo                          | What it is                                                                        | Read first                                                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `tacocat-gallery-sam`         | The back end: DynamoDB, Lambdas, API Gateway, S3 media, the image CDN             | `docs/plans/Hosting.md` and `docs/plans/HostingDeepDive.md` (the move), `docs/plans/EdgeCachedAlbums.md`, `docs/Architecture.md` |
| `tacocat-gallery-sveltekit`   | The SvelteKit single-page app that `web/` started from                            | `docs/plans/Observability.md` (AWS performance, measured), `docs/Observability.md` (`npm run perf`), `docs/Ecosystem.md`         |
| `tacocat-gallery-hosting-aws` | The S3 bucket and CloudFront distribution that serve the app on `pix.tacocat.com` | `template.yaml`                                                                                                                  |
| `tacocat-gallery-auth`        | Cognito login, which the passkey login here replaces                              | `template.yaml`                                                                                                                  |

`web/` is `tacocat-gallery-sveltekit` at commit 8c57e5f of its `claude/getalbum-caching-nextprev-as8yq8` branch, which finds an album's prev and next in its parent and the latest album in the current year. That is why the Worker answers in the AWS API's record shapes (`shared/src/album.ts`): the app parsed them unchanged, and keeping the two apps identical was what made the platforms comparable. Every change to the app since is listed in [PerfVsAws.md](PerfVsAws.md), under _Differences from the AWS app_.

## From AWS to the Worker

| AWS                                                           | Worker                                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `GetAlbum`, `AlbumExists`, `MediaExists`                      | `GET`/`HEAD /api/album`, `HEAD /api/media`                                      |
| `GetLatestAlbum`                                              | Dropped; the app reads it off the current year                                  |
| `Search` on RediSearch, `DynamoToRedis` stream, `SyncRedis`   | `GET /api/search` on FTS5 in the same database; the triggers keep it in step    |
| `CreateAlbum`, `UpdateAlbum`, `DeleteAlbum`, `RenameAlbum`    | `PUT`, `PATCH`, `DELETE /api/album`, `POST /api/album-rename`                   |
| `SetAlbumThumbnail`                                           | `PATCH /api/album-thumb`, by row id                                             |
| `UpdateMedia`, `DeleteMedia`, `RenameMedia`, `RecutThumbnail` | `PATCH`, `DELETE /api/media`, `POST /api/media-rename`, `PATCH /api/thumb`      |
| `GenerateUploadUrls`, `GetErrors`                             | `POST /api/presigned`, `POST /api/errors`                                       |
| `ProcessMediaUpload` on an S3 event                           | A Workflow instance per upload, started by the app's announcement or R2's event |
| MediaConvert and `VideoTranscodingComplete`                   | The ffmpeg container, called from the same pipeline                             |
| `GenerateDerivedImage` behind CloudFront                      | `GET /i/*` with Image Transformations and the derived bucket                    |
| S3 versioning, `revertS3Version`, the 24-day expiry           | Write-once keys, and a row that points only at what succeeded                   |
| Cognito and `tacocat-gallery-auth`                            | Passkeys, unchanged                                                             |
| The errors table with a TTL                                   | `upload_error`, purged nightly                                                  |
| AWS Backup of the originals                                   | A nightly GitHub workflow mirroring the originals to a versioned S3 bucket      |
| CloudFront, CloudWatch and Grafana logs in DuckDB             | Workers Logs, through the dashboard's query builder or the observability MCP    |

## What is still there

The AWS production names `api.pix`, `auth.pix` and `img.pix` and their certificate validation records stay in the `tacocat.com` zone (`infra/tacocat.tf`) for the readers a stale delegation still sends to the AWS app, until it is retired. The gallery's AWS account also holds the `tacocat-gallery-cloudflare-backup` bucket this site's nightly backup writes to, which outlives the AWS site.
