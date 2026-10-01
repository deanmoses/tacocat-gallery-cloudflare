# Migrating the AWS gallery data

This plan copies the AWS gallery's rows and original media files into the Cloudflare production environment. What there is to copy, counted on 2026-09-24: 37,875 media items, 37,820 images and 52 videos, about 34 minutes of video in all, by the AWS repo's `docs/plans/HostingDeepDive.md`; and 38,334 objects, 145 GB, in the production originals bucket (`docs/Risks.md` #21).

The stages are 1. [Check DynamoDB for data quality issues](#check-dynamodb); 2. [Copy the media](#copy-media); 3. [Copy the database](#copy-database); 4. [Verify](#verify). The whole thing was [rehearsed on staging](#rehearsal) before it ran against production. **The copy is done:** production holds the AWS gallery, verified ([Log](#log), 2026-09-30, Production copy). What the earlier moves left behind is [Recovering lost content from pre-AWS galleries](RecoverPreAwsGalleries.md), and [pre-generating the derived images](#pre-generate-derived-images) waits for it; what those galleries were is [History of the Tacocat Gallery](../HistoryOfTacocatGallery.md).

Going live and taking over the hostname afterwards is a separate decision, and is its own section of `docs/plans/AwsPort.md`.

## Check DynamoDB

✅ This is DONE.

The first part exists: **`import-gallery.ts` run against `wrangler dev` (`--to local`) runs the constraints over the production gallery's data and reports every row they refuse.** It was `check-gallery.ts` until it became the importer, which is what the Log's early entries call it. There are reasons to expect some: AWS's image type had `dimensions` optional and its repo carries a dimensions-repair migration with an "unfixable" count, so some rows may lack a size; blank captions, an unlisted video extension, or a name outside AWS's own rule of letters, digits, underscore, hyphen and one extension, which came long after most of the uploads, are all possible in 25 years of them. A scan of the production table is under a penny by the AWS repo's `docs/Migrations.md`, or failing AWS access, every published album through the public API, which is most of the gallery but not the drafts. The copy then repairs rows, reading a missing size from the original, or a rule the gallery argues with is loosened by a table rebuild. What its runs against production found is in the [Log](#log); nothing is copied until its report is clean.

The second check is against S3 rather than the rows: `check-s3-versions.ts` reads a `ListObjectVersions` of the originals bucket, which says which version of each key is current. Super Slurper copies the current version, and the rename pass keys each copy by its row, so a row whose `versionId` is not S3's current version for its path is a row the copy would pair with the wrong file. That is what an upload whose AWS processing failed partway looks like, the row keeping the old version while S3 holds the new one as current, and each such row is looked at and settled before the copy rather than copied. The check found one, `/2026/01-23/jim13.jpg`, whose version has expired; the rename pass takes each row's file by its key's current version, which pairs it with the one file S3 holds for it, uploaded a second earlier. The rehearsal showed that file is another photo, so Moses puts the right one back after the copy ([Afterwards](#afterwards)).

## Copy media

✅ This is DONE.

We'll copy only originals, not derived, except for the videos' transcodes ([below](#videos)).

### IDs

✅ This is DONE.

Each current original in the AWS bucket gets a new version id, a ULID as issue #99 and its pull request make every version id: 48 bits of millisecond timestamp and 80 random bits, 26 characters of uppercase Crockford base32. S3's version ids are not kept: S3 documents them as opaque, its own example contains `/` and `+`, which the URL parser and the `version_id` constraint would both refuse, and keeping them would hold every id to the loosest format any of them has. Each original carries its gallery path and the S3 version the copy took of it as metadata, and no `upload` row, since that table tracks uploads in progress.

A migrated file's id is minted as an upload's is, stamped with the moment `mint-version-ids.ts` mints it, so the timestamp in every version id means one thing: when this gallery minted it. For a migrated file that is the day of the copy, which says nothing about when the photo was taken or first uploaded, and nothing else could: the photos were bulk-copied into AWS too, so S3's dates and the objects' `LastModified` say when that copy ran. When a photo was taken belongs in a column where it can be corrected, as the issue says, and the album's date and order say where it sits. The ids are random as well as timestamped, so a second minting would give every file a different one, which is why they are minted once, into a file the rename pass and the import both read ([below](#copy-process)).

### Originals bucket

✅ This is DONE.

Only finished originals are ever written to the originals bucket. Nothing else goes into this bucket.

### Copy process

✅ This is DONE.

We move the files in two server-side passes:

1. **The copy pass**. Super Slurper copies the AWS bucket into a temporary import bucket. It keeps AWS's keys, since it cannot rename. This makes the next move a cheaper Class A write.
2. **The rename pass**. `copy-originals.ts`, on Moses' laptop, copies each current original with `CopyObject`, many at a time, from the import bucket to `originals/<versionId>`, replacing the metadata and giving the content type the Worker's own sniffer reads from the file's first bytes, as an upload's is given.

The ids come first, from `mint-version-ids.ts`, which reads the scan and the bucket's version listing and writes every original's new id to a file, with the S3 version the listing shows as current, which is the file Super Slurper copies. It never overwrites a file; the rename pass and the import both read the one it writes, so the rows name the ids the objects have and a restart mints nothing twice. A later scan is minted `--from` the earlier file: an original it gave an id keeps it while S3 still holds the same version and the copy puts it at the same path, and only a new photo, one replaced on AWS since, or one whose path moved, as a new upload can move which of two same-named photos gets `_2`, gets a new id, so the rename pass copies only those. The minting records each file's size and ETag from the listing too, and the rename pass refuses a source in the import bucket that differs from them. A second Super Slurper run copies only keys the import bucket lacks, with its overwrite setting off, so a photo replaced on AWS since the first run still holds its old bytes there; the rename pass stops on it rather than copy the old file under the new id, and that photo's new version is copied into the import bucket by hand before the pass runs again. The rename pass runs with the OpenTofu token as `media.ts` does, since the Worker's own key cannot write originals, and logs one JSON line per object with the AWS key, the new version id and the outcome, so the log answers what was copied and where it stopped. A rerun is safe by the script's own doing: an object whose target a `HEAD` finds is skipped, never written again.

The rename pass and the import share their guard rails (`api/scripts/migration-run.ts`). Each touches only the albums it is named with `--only`, with the year albums that hold them for the import, or everything when told `--all`, and refuses to start with neither or both; each names its target with `--to`; each writes nothing without `--go`, and a run without it reads and judges everything in scope and says what it would write. Each tries a dropped request again twice, and stops the whole run on a refused credential, on a request that fails all three tries, and at the fifth item that goes wrong. So the order is a dry run, then one album with `--go`, looked at on the site, then more. Whether the originals bucket gets a lock that refuses overwrites is undecided, and the pass does not lean on one: a lock would refuse the one write a migration is likely to need, replacing an original the pass got wrong, so if one is on, expect to lift it for that repair and put it back after. Only API calls cross the laptop's connection; the bytes never leave Cloudflare.

The rehearsal and the production run both copy from the one import bucket, which is deleted once production is verified. That is about 38,000 Class A writes a pass, about 77,000 of the million a month includes, and deletes are free. A test with two throwaway buckets settled how the copy behaves ([Log](#log), 2026-09-30): R2's `CopyObject` takes a source in another bucket, so the import bucket stands, and one copy took 300 MiB, past the gallery's largest original of 281 MiB. Three things the rename pass has to do for itself follow from it. Replacing the metadata drops the content type, so each copy sends the source's `Content-Type` again. A copy ignores `If-None-Match: *` and overwrites, so the pass's `HEAD` before each copy is what keeps a rerun from writing twice. And a copy of an object written in parts comes out as one part, whose ETag is the MD5 of the whole file, which [Verify](#verify) uses.

### Videos

✅ This is DONE.

The 52 videos' originals are copied like any other. Their playable form is not regenerated: the AWS derived bucket holds MediaConvert's H.264 MP4 and poster frame for each at `i/<path>/<versionId>/video-transcoded` and `video-poster`, and the copy puts them at `derived/<newVersionId>/video.mp4` and `poster.jpg`, which is all the `/v/` route and the poster-based thumbnails read; the row's width, height and duration come from DynamoDB as they do for a photo. That is 104 objects, 540 MB, the largest 98 MB, which `copy-video-derivatives.ts` copies from S3 through the laptop, under the same guard rails as the rename pass. It finds each by the row's own AWS version id, which named the derived files, and writes it under the id minted for the video's original, with the content type the transcoder gives its own. Pushing a video through the transcoder instead is the fallback for any that plays wrong; 34 minutes of video is inside the month's container allowance either way.

## Copy database

✅ This is DONE.

The rows come from a DynamoDB export written through `PUT /api/item`, with `itemType` and `mediaType` finished on the way, each media row carrying the version id the rename pass minted for it. The order is year albums, then day albums, then media, then each album's thumbnail through `PATCH /api/album-thumb`, since the foreign key needs the media row to exist. The translation is the one the check does, sanitized names, `_n` for a collision, links in captions rewritten to the new paths, since the check is `import-gallery.ts` run against `wrangler dev`, and staging and production are `--to staging` and `--to production` with the version id file. `PUT /api/item` is an upsert that keeps a row's id and timestamps and answers a refusal with the constraint's name, so a rerun over the whole export is the resume, and about 40,000 single-row writes at 8 in flight is tens of minutes. The writes go through the production Worker, so they run outside the DebugBear hours in `api/wrangler.jsonc`'s `crons`, or `docs/Perf.md` notes them.

Two things the rows lose, decided rather than discovered later: AWS's `createdOn` and `updatedOn`, since the item write has no timestamp fields and the app shows neither, and keeping them would mean a field on the import body; and `position` only where the new names would reorder an album. AWS showed an album in its names' order by code point, and sanitizing moves some items, since a hyphen sorted before the extension's dot and a capital before any lowercase letter; captions that tell a story need their photos where they were, as in `/2010/10-10/`, whose `eiffel` follows nine `eiffel-tower` photos. So each of the 34 albums sanitizing reorders gets AWS's order through `PUT /api/album-order` (`awsOrder` in `aws-names.ts`), and every other album sorts by name, which is already AWS's order.

Derived images are not copied, only the videos' transcodes ([Videos](#videos)): images regenerate on request. The observed rate, about 7,700 distinct variants a month and 7,100 without bots, is above the 5,000 the Images allowance includes, so expect about $1 to $1.35 a month at $0.50 per 1,000 after the copy, which the Spending rules want said out loud; a backfill of the newest albums, if the first readers should not wait, is more of the same. `docs/Migrations.md` in the AWS repo has the lessons that apply: idempotent, resumable, newest albums first, diagnose before fix.

## Verify

✅ This is DONE.

- **Counts.** Rows per item type against the export, and objects in the originals bucket against media rows: every media row's original exists under its version id, and none is there without a row. Every video row has its `video.mp4` and `poster.jpg` in the derived bucket.
- **Orphans.** An original copied under an id that a later minting replaced, for a photo replaced or moved on AWS, or dropped, for one deleted there, belongs to no row. The mintings list them, and the counts above find them; they are listed with their ids and deleted by hand once Moses has said yes, since a delete cannot be undone.
- **Bytes.** Each original's size and ETag against S3's listing. S3 holds each original in one part, so its ETag is the file's MD5, and the rename pass's `CopyObject` gives each copy the MD5 of the whole file as its ETag, whether Super Slurper wrote it in one part or in several, so the two compare directly for every original, the largest included. A later listing with a multipart ETag, one containing a `-`, is a file uploaded to AWS in parts since, which is checked against the MD5 of Moses' own copy instead. The rclone sample verified 830 objects identical.
- **Decoding.** The bulk copy never opens a file, so nothing proves the Images binding can decode every file, scans of the 1800s included, where the pipeline would have refused one. Either the first reader finds a bad file as a broken image, or a sweep asks for one thumbnail per item, about 33,000 paid transformations at $0.50 per 1,000, about $17 once, newest albums first, and every refusal is a row to look at. Whether to sweep, or to [pre-generate](#pre-generate-derived-images), which sweeps on the way, is decided after the albums are migrated, and either needs a yes under the Spending rules.
- **Trimmed thumbnails, by Moses.** The 104 thumbnails whose AWS crop the copy trimmed ([Log](#log), 2026-09-30) are trimmed by at most 6 pixels, under 0.2% of the photo's short side, which no thumbnail shows, so the four trimmed most are looked at on the site against AWS while AWS still serves them: `/2019/08-31/boba_tea05`, `/2001/04-22/cherry_blossoms1`, `/2022/07-27/bithday_milo1` and `/2022/12-11/holiday_party10`. `import-gallery.ts` with `--paths` lists all 104 as `trimmed:`.
- **The app.** Albums from each decade browsed on the site, a search that finds a caption, since the FTS triggers index each row as it is written, and a video that plays.

## Freezing AWS

✅ This is DONE.

AWS stays live while the copy is prepared, so the final run starts by freezing it: from the final scan until the hostname moves, Moses uploads, edits and deletes nothing on AWS, since a change made after the scan would not reach Cloudflare. The final run is, in order: the freeze; a fresh DynamoDB scan and S3 listing; the two checks over them; a minting `--from` the rehearsal's id file, which keeps every id the rehearsal minted for an unchanged original; a second Super Slurper run into the import bucket, which copies only the keys it lacks, with any photo replaced on AWS since copied in by hand ([Copy process](#copy-process)); the rename pass to production, which skips every original already there; the copy of the videos' MP4s and posters, which does the same; the import; the verification; and the move of the hostname.

## Rehearsal

✅ This is DONE.

The whole thing runs against staging first, from the production export, since staging holds nothing that matters: the checks, the two passes, the rows, the verification. S3's egress is paid once: the production run's rename pass copies from the same import bucket, `--to production`, and Super Slurper runs again only for what is new on AWS since. The rows are cheap to write twice.

## Afterwards

- ✅ **Done: Moses cut eight thumbnails again**, whose AWS crops the copy dropped ([Log](#log), 2026-09-30): `/2024/05-25/doubles_pickle2`, `/2024/08-23/river5`, `/2024/09-05/dog_walk2`, `/2024/10-21/show_hadestown2`, `/2025/06-15/photo020`, `/2025/06-15/photo022`, `/2025/09-21/go_petrovaradin08` and `/2025/12-28/uc_campus1`. Cut on production on 2026-09-30.
- ✅ **Done: Moses put `/2026/01-23/jim13`'s photo back** on production on 2026-09-30, replacing the copy's photo of a couple with the group's original, `jim13.heic`, under the row's title "EB Parents" and caption "A posse of École Bilingue parents", and added the couple as `/2026/01-23/jim12`, which the album had lacked ([Log](#log), 2026-09-30).
- ✅ **Done: `/1991/11-30/` stays on the 30th.** AWS held it as `/1991/11-31/`, a day the calendar lacks, and could not rename an album with photos in it, so the copy put it on the 30th (`copiedAlbumPath` in `api/scripts/aws-names.ts`), and Moses kept it there.
- **The first full backup.** The nightly workflow in `.github/workflows/backup.yml` has only ever mirrored a few hundred megabytes; the night after the copy it mirrors 145 GB, against the job's 4-hour limit, which `docs/Risks.md` #22 lists as untested.
- [Recover lost stuff from pre-AWS galleries](RecoverPreAwsGalleries.md):

    - the Zenphoto drafts
    - lost items from Gallery 2
    - lost photos and videos from the static gallery prior to Zenphoto and Gallery 2

## Pre-generate derived images

Perhaps, decided once every [recovery](RecoverPreAwsGalleries.md) is in, so that it runs once over all of the gallery: each copied item's derived images made ahead of its first reader, as an upload's are. The upload pipeline makes each photo's thumbnail at both densities and its detail image before the upload is ready, so no first reader waits, but the copy writes rows through `PUT /api/item` and never runs it, so the first view of a copied photo waits for its transformations: a few beats on an album page making them all at once, as the rehearsal's `/2010/10-10/` showed on staging. What the recoveries bring back goes through the upload itself and is made already.

A script under the same guard rails as the copy asks the Worker for each item's URLs, newest albums first, which generates and stores each as a reader's request does. It does the [decode sweep](#verify) on the way, every refusal a row to look at. The thumbnails at both densities are about 76,000 transformations, about $36 once, and are where the wait shows most; with the detail image too, about 114,000 and $55; against the sweep's $17 for one thumbnail per item. It runs on production only, since staging's derived images serve no reader, and needs a yes under the Spending rules.

## Cost and time

| Step                                               | Time            | Cost                                    |
| -------------------------------------------------- | --------------- | --------------------------------------- |
| Super Slurper, 38,334 objects, 145 GB              | minutes         | about $13 of S3 egress, once            |
| Rename pass, about 38,000 `CopyObject`s            | tens of minutes | inside the free million Class A writes  |
| Rows, about 40,000 `PUT /api/item`                 | tens of minutes | negligible D1                           |
| Decode sweep, one thumbnail per item, optional     | an hour or so   | about $17, once                         |
| Pre-generated thumbnails, both densities, optional |                 | about $36, once; $55 with detail images |
| Storage afterwards                                 |                 | about $2 a month                        |
| Derived images on request                          |                 | about $1 to $1.35 a month               |

## Log

### 2026-09-30

#### Production copy

Ran the same evening as the rehearsal, from the same scan, S3 listing and `version-ids-rehearsal.json`, without the freeze's rescan: Moses had changed nothing on AWS since the scan. Production held 2 test albums, `/2025/09-29/` and `/2026/09-13/`, with their year albums and 51 media, from earlier imports, every one at a path the import writes, so the import wrote over them.

- **Rename pass, `--all --go`** from `aws-import`: 37,975 copied, none failed, from 02:33 to 03:09 UTC. The laptop slept partway and the run carried on when it woke.
- **Videos, `--all --go`.** 104 copied.
- **Import, `--all --go`.** 41,717 writes, none refused, from 03:18 to 03:42 UTC, before the DebugBear runs at 05:23.
- **Verified.** 67 year albums, 1,787 day albums, 37,923 images and 52 videos, the export's 39,829 rows and no others; each row the same as staging's field by field, version ids included, so the test rows kept nothing of their own. Every original in `production-originals` at S3's size and ETag, beside the 102 originals of the test imports, which no row names; every video's `video.mp4` and `poster.jpg` in `production-derived`. Searches for "eiffel paris" and "café" find 22 and 267, both FTS5 indexes pass `integrity-check`, `/2010/10-10/` keeps AWS's order, and `sasha6` and an `eiffel_tower1` thumbnail are served.

Moses looked over the site and made the fixes in [Afterwards](#afterwards). The 102 test originals were two test imports of the same 51 photos of `/2025/09-29/` and `/2026/09-13/`, 51 under an older key format and 51 under ULIDs that 51 completed `upload` rows still name, which the pipeline never reads again once complete; with Moses' yes they were deleted, leaving `production-originals` with 37,976 objects, one for each media row. Left: `aws-import`, deleted once Moses says yes, and the first full backup.

#### `/2026/01-23/jim13` is the wrong photo

Moses found it looking at staging against AWS: the copy shows a couple where AWS shows the five École Bilingue parents of its caption. Both are on his laptop as `jim13.jpeg` and `jim13.heic`, and both were uploaded on 2026-01-24 within a second as `jim13.jpg`: the couple first, as S3 version `xD_IF9jlA6O.kNyfXzfhwAbtHs9i4fck`, then the group as `h.QQqWw47jlMEw5RHlwjZXJXsLxWoXjL`, which the row names. S3 has since expired the group's version and keeps the couple's, the only one the copy can take, so the S3 check's guess that the two were the same photo was wrong. AWS's derived bucket still holds the group at 1024 pixels and 200×200, which is what its page shows, and the couple at 1024. The group's original is only on Moses' laptop, so the fix is his, after the copy ([Afterwards](#afterwards)).

#### Staging rehearsal, verification

The checks of [Verify](#verify) that need no one's eyes, against staging:

- **Rows.** 67 year albums, 1,787 day albums and 37,975 media, 37,923 images and 52 videos, as the export holds, besides 2 day albums and 74 media under `/2026/09-29/` and `/2026/09-30/` that staging held before. Every row agrees field by field with the local `wrangler dev` import of the same export, titles, captions with their rewritten links, summaries, sizes, durations, publication, thumbnails, trimmed crops and the 34 orders, all but the version ids, and every media row names the id the rehearsal's file gives its path.
- **Originals.** Every media row's original is in `staging-originals`. The only objects without a row are 31 with keys of an older format, `originals/0mulp…`, from staging's test uploads before the rehearsal; the copy left no orphan.
- **Videos.** All 52 video rows have their `video.mp4` and `poster.jpg`.
- **Bytes.** All 37,975 originals have S3's size and ETag. No S3 ETag in the listing is a multipart one, so every original, the 3 over 100 MiB included, is checked against S3's MD5 rather than against Moses' own copies; the other 4 files over 100 MiB the plan counted are among those the copy leaves behind.
- **The app, through the API.** A search for "eiffel paris" finds 22 items and one for "café" 267, accents ignored, and both FTS5 indexes pass `integrity-check`. `/v/` serves `match_5419`, 98 MB, and `sasha6` as `video/mp4`, answering a range.

Moses then looked at the site: albums from each decade, the oldest scans of `/1918/11-11/` and `/1987/06-15/`, the GIFs of `/2019/06-30/` and `/2018/04-08/`, the PNGs of `/2026/09-21/` and `/2026/09-10/` and a detail image in each, all rendered right; the four most-trimmed thumbnails match AWS's; and `/2002/04-29/sasha6`, an AVI on AWS, plays. The one thing wrong is `/2026/01-23/jim13` (above). That closes the rehearsal, but for the decode sweep, which waits for production ([Pre-generate derived images](#pre-generate-derived-images)).

#### Staging rehearsal, the whole gallery

- **The OpenTofu token expired** at 2026-09-30T23:59:59Z, minutes before the rename pass's `--all --go`, which stopped on its first batch at the first `HEAD`'s 403, nothing copied. Cloudflare's verify route still answers `success` for an expired token, with a `status` of `expired`, so `tokenCredentials` derived keys from it and the run started. Editing the token's TTL in the dashboard answered "Token not found"; rolling it gave a new value, in `api/.dev.vars`, that expires on 2026-10-09T00:12:01Z. The final run needs it extended or replaced before then.
- **Rename pass, `--all --go`.** 37,959 copied and the 16 of `/2010/10-10/` present, none failed, in 30.5 minutes at 32 in flight, about 23 originals a second. A listing of `staging-originals` holds every minted id under `originals/` at its S3 size, and 105 other objects that were there before the rehearsal, staging's own test uploads.
- **Videos, `--all --go`.** All 104 MP4s and posters copied, 540 MB from S3 through the laptop, in a minute.
- **Import, `--all --go`.** 67 year albums, 1,787 day albums, 37,975 media, 1,854 thumbnails and 34 orders written, none refused, in 17 minutes; the same trims, drops, collision and link rewrites as the local check.

#### Staging rehearsal, first album

- **Ids.** `mint-version-ids.ts` minted `version-ids-rehearsal.json` from the scan and S3 listing above: 37,975 ids, all distinct. Against the test file minted earlier the same day, every entry has the same path, media type, S3 version, size and ETag, and every id differs. The test file was minted before the scripts were committed, and nothing was ever written under its ids, so the rehearsal and the final run's `--from` start from this one.
- **Rename pass, dry run, `--all`.** All 37,975 would copy, none refused on size, ETag or sniffing: 37,753 JPEG, 167 PNG, 3 GIF, 27 AVI, 21 QuickTime, 3 MP4 and 1 M4V, every one the media type its row says. At 8 in flight it read 16.8 originals a second, two round trips of about 240 ms each, so about 38 minutes.
- **Rename pass, `/2010/10-10/` with `--go`.** 16 copied, 58.7 MB, each in `staging-originals` with its source's size and S3's ETag, `image/jpeg`, and its gallery path and S3 version id as metadata. With the copy's own round trips, about 1 to 1.5 seconds an original, so `--all` at 8 in flight would take about two hours; `copy-originals.ts` now runs 32 at once.
- **Import, `/2010/10-10/` with `--go`.** The year album, the day album, 16 media, 2 thumbnails and AWS's order written, none refused. The API answers the album in AWS's order, `eiffel` after the nine `eiffel_tower` photos, and the Images binding makes its detail image and thumbnail from the copied original. Looked at on staging against AWS, the album is identical but for the WebP thumbnails. Its photos took a few beats to appear, each made on its first request since the copy never runs the upload pipeline that pre-generates them ([Pre-generate derived images](#pre-generate-derived-images)).

#### Super Slurper copy pass

The import bucket is `aws-import`, in `wnam` like the originals, made with `wrangler r2 bucket create` and not in OpenTofu, since it is deleted after Verify; it has no Worker binding. Super Slurper read S3 as `cloudflare-super-slurper`, an IAM user whose one inline policy, `read-originals`, allows `s3:Get*` and `s3:List*` on the originals bucket alone, and wrote with an R2 token scoped to `aws-import` with Object Read & Write. The job copied the whole bucket, no subpath, overwrite set to skip.

A listing of `aws-import` against the S3 version listing: 38,334 objects, 145.1 GB, every one S3's current version of its key at the same size, and nothing S3 lacks. The only current keys not copied are the 1,544 folder markers.

Afterwards the IAM user's access key and the R2 token were deleted; the user and its policy stay, keyless, for the second run after the freeze, which needs a new key and token.

#### Copy scripts built and tried locally

Nothing has been written to staging or production yet: there is no import bucket.

- **`mint-version-ids.ts`** wrote 37,975 ids to a test file, and a second run refused to overwrite it. Minted `--from` that file with the same scan, it kept all 37,975.
- **`import-gallery.ts --to local`** with that file wrote `/2010/10-10/` alone with `--only`, its year album included, AWS's order and both thumbnails, then all of it with `--all`: 39,829 rows, 1,854 thumbnails and 34 orders, none refused, in 80 seconds. The copy plan refuses a day album that would move onto an existing one and an item whose name sanitizes to nothing; today's data has neither.
- **`copy-originals.ts`**, dry run of `/2010/10-10/` against staging from a bucket that does not exist, stopped at the fifth failure, and the three already under way when it stopped failed after it.
- **`copy-video-derivatives.ts`**, dry run against staging with the test file, read the first bytes of `video-transcoded` and `video-poster` for all 52 videos and would copy all 104. All 52 of MediaConvert's MP4s declare M4V as their major brand, which the Worker's sniffer reads as `video/x-m4v`; they are H.264 MP4s all the same, and are copied as `video/mp4`.

#### Two-bucket R2 copy test

A throwaway script copied a 200 KB object and a 300 MiB one built from thirty parts between two throwaway buckets, with the OpenTofu token, then deleted both buckets. A copy crosses buckets and takes 300 MiB, past the gallery's largest original of 281 MiB; it keeps a one-part object's size and ETag, and gives a multipart one the MD5 of the whole file as its ETag; `x-amz-metadata-directive: REPLACE` drops the content type unless the copy sends it; and `If-None-Match: *` is ignored, so a second copy overwrites.

#### S3 version check

`aws s3api list-object-versions` of `tacocat-gallery-sam-prod-original-images`: 39,926 versions and 43 delete markers of 39,920 keys, complete. The delete markers are all single photos deleted in September 2026. `api/scripts/check-s3-versions.ts` compared it with the scan:

- **37,974 of 37,975 rows are on their key's current version.** The other, `/2026/01-23/jim13.jpg`, names a version that has expired. S3 holds one version of the key, written a second before the row; AWS's page still shows the expired one, from derived images made before it expired. **Decided: the copy pairs the row with the current file.** The rehearsal showed that file is another photo, which Moses puts right after the copy (`/2026/01-23/jim13` is the wrong photo, above).
- **1,903 current files no row names**, which the copy leaves behind:
    - 1,544 folder markers, keys ending in `/`.
    - About 190 files that are not photos: 81 `.xmp` sidecars, 78 beside a JPEG of the same name and 3 named for an album, mostly in `2014/10-31/`, `2014/12-21/` and `2014/12-28/`; 90 dotfiles and files with no extension; 17 `.txt` files; `.picasa.ini`, `Thumbs.db` and `.BridgeSort`. Left behind, sidecars included, without looking inside.
    - 147 photos in 11 albums that have no row, unpublished albums in Zenphoto ([Recovering lost content from pre-AWS galleries](RecoverPreAwsGalleries.md#zenphoto)).
    - 18 more files in albums that do exist: 9 TIFFs in `2008/08-21/`, a Sony `.arw`, a Nikon `.nef`, a `.heic`, 4 PNGs in `2025/04-27/`, `2015/01-11/a4-aceeyah-laughing.jpg` and a file named `.jpg` in `2019/07-15/`. **Decided: left behind**, and revisited in [Recovering lost content from pre-AWS galleries](RecoverPreAwsGalleries.md#zenphoto-comparison).

#### check-gallery.ts #4

With empty captions left out: all 39,829 rows written, none refused, and all 34 album orders accepted. The report is clean.

#### check-gallery.ts #3

With crops trimmed and dropped: 39,809 rows written, 20 refused, the 13 empty titles and 7 empty summaries.

#### check-gallery.ts #2

39,697 rows written, 132 refused:

- 112 thumbnail crops that start below 0 or run past the image. 104 run at most 10 pixels past, all within 1% of the photo's short side: AWS's crop tool made squares a few pixels larger than the short side, such as 3653×3653 on the 5472×3648 `/2023/05-07/horse_race5.jpg`, and its image Lambda trimmed them when cutting the thumbnail, which looks right on the site. The copy trims them the same way (`copiedCrop` in `api/scripts/aws-crops.ts`). The other 8 run exactly 1,008 pixels past, 4032 less 3024: each was cut while AWS stored the photo's raw pixel size with width and height swapped, since uploads ignored the EXIF orientation until commit 00dea18 of the AWS repo on 2026-01-14, and each was last updated on 2026-01-15 by that repo's Fix Dimensions & Tags migration, which corrected the size and left the crop. Their thumbnails on AWS are not what was chosen, as `/2025/12-28/uc_campus1.jpg` shows, so the copy drops those crops for the default and Moses cuts them again afterwards ([Afterwards](#afterwards)).
- 13 titles, all in `/2025/12-12/`, and 7 album summaries that AWS stored as empty strings, which the caption rule refuses so that no caption is always written one way. The copy leaves them out.

What the copy changes: `/1991/11-31/`, an impossible date, goes to `/1991/11-30/` ([Afterwards](#afterwards)). 3,640 names change beyond losing their extension, mostly hyphens to underscores, and one collides, `/2026/09-21/o_the_flip08.png` becoming `o_the_flip08_2`. Sanitizing would reorder 34 albums, which get AWS's order back, all 34 accepted. 201 caption links are rewritten, none unresolved.

#### check-gallery.ts #1

`check-gallery.ts` against `wrangler dev` refused 37,842 rows on `item_file_check`, because it sent S3's version ids, which the ULID constraint refuses. The check now mints each id as the copy will ([IDs](#ids)).

#### DynamoDB scan

`aws dynamodb scan` of the table: 39,829 rows, 1,854 albums and 37,975 media, 47 MB, complete with no `NextToken`. Saved outside the repo as `~/dev/tacocat-migration/prod-items.json`, since it holds the drafts. There are 100 more media than the count of 2026-09-24.

#### DynamoDB capacity change

The production items table, `tacocat-gallery-sam-prod-items`, is on-demand with a maximum of 10 reads and 3 writes a second, although the SAM template still declares it provisioned at 3 and 3, so a `sam deploy` would try to switch it back. The site shares that cap, and a scan at 10 would have taken about 8 minutes while throttling the site's reads, so the maximum reads were raised to 1,000 for the scan and then set back to 10 afterwards.
