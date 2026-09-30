# Migrating the AWS gallery data

This plan copies the AWS gallery's rows and original media files into the Cloudflare production environment. What there is to copy, counted on 2026-09-24: 37,875 media items, 37,820 images and 52 videos, about 34 minutes of video in all, by the AWS repo's `docs/plans/HostingDeepDive.md`; and 38,334 objects, 145 GB, in the production originals bucket (`docs/Risks.md` #21).

The stages are 1. [Check DynamoDB for data quality issues](#check-dynamodb); 2. [Copy the media](#copy-media); 3. [Copy the database](#copy-database); 4. [Verify](#verify); then the whole thing is [rehearsed on staging](#rehearsal) before it runs against production. Taking over the hostname afterwards is its own section of `docs/plans/AwsPort.md`.

## Why a bulk copy and not `import-album.ts`

`api/scripts/import-album.ts` copies one day album through the Worker's own routes, downloading each original from the AWS image CDN and uploading it as a browser would, and it is the right tool for one album. It is the wrong tool for the gallery:

- **Every byte goes through this laptop twice**, down from CloudFront and up to R2. The home uplink measured 6.3 MB/s, so 145 GB is about 6.5 hours each way before any pipeline time, and a couple of days of wall clock once failures are counted.
- **It pays for the derived backfill this plan declines.** Each upload runs the pipeline, which pre-generates a thumbnail and a detail image, so 38,000 uploads are about 76,000 Images transformations, the roughly $35 case, plus 38,000 Workflow instances.
- **It leaves videos behind** by design, and it is not resumable, logged or idempotent at gallery scale, which is what the AWS repo's `docs/Migrations.md` learned the hard way.

The one thing it has that the bulk copy lacks is proof that the Images binding can decode every file, since the pipeline refuses a file it cannot open; [Verify](#verify) has the alternative. The script stays for copying a single album before or after the bulk copy.

## Check DynamoDB

The first part exists: **`check-gallery.ts` runs the constraints over the production gallery's data and reports every row they refuse.** There are reasons to expect some: AWS's image type had `dimensions` optional and its repo carries a dimensions-repair migration with an "unfixable" count, so some rows may lack a size; blank captions, an unlisted video extension, or a name outside AWS's own rule of letters, digits, underscore, hyphen and one extension, which came long after most of the uploads, are all possible in 25 years of them. A scan of the production table is under a penny by the AWS repo's `docs/Migrations.md`, or failing AWS access, every published album through the public API, which is most of the gallery but not the drafts. The copy then repairs rows, reading a missing size from the original, or a rule the gallery argues with is loosened by a table rebuild. It has not yet been run against production, and nothing is copied until it has and its report is clean.

The second check is against S3 rather than the rows: a `ListObjectVersions` of the originals bucket, which says which version of each key is current. Super Slurper copies the current version, and the rename pass keys each copy by its row, so a row whose `versionId` is not S3's current version for its path is a row the copy would pair with the wrong file. That is what an upload whose AWS processing failed partway looks like, the row keeping the old version while S3 holds the new one as current, and each such row is looked at and settled before the copy rather than copied.

## Copy media

We'll copy only originals, not derived, except for the videos' transcodes ([below](#videos)).

### IDs

Each current original in the AWS bucket gets a new version id, a ULID as issue #99 and its pull request make every version id: 48 bits of millisecond timestamp and 80 random bits, 26 characters of lowercase Crockford base32. S3's version ids are not kept: S3 documents them as opaque, its own example contains `/` and `+`, which the URL parser and the `version_id` constraint would both refuse, and keeping them would hold every id to the loosest format any of them has. Each original carries its gallery path and its S3 version id as metadata, and no `upload` row, since that table tracks uploads in progress.

The timestamp in a migrated file's id is its album's calendar date, midnight UTC, plus the item's index in the album's name order in milliseconds, since `/2001/06-15/` is the one date every item has and the order the album shows them in. A ULID's 48 bits count milliseconds from 1970 and cannot go below it, and the gallery has twelve year albums before that, from 1918 to 1969, so an item of a pre-1970 album takes instead its ordinal among the pre-1970 items, in the same album-then-name order, as milliseconds from 1970-01-01: they sit in the first seconds of that day, before anything dated later. A ULID sorts by its timestamp as text, so a listing of the originals bucket runs oldest album first and newest photo last, a listing by time range is a listing by album for everything since 1970, and every later upload, minted at its real moment, sorts after every migrated file. The one date the two rules could collide on is 1970-01-01 itself; there is no 1970 album today, and the pre-flight check refuses an album dated that day rather than let the copy order it wrong. The timestamp is an ordering key and nothing more: `created_at` says when the row was made, which is the day of the copy, and the capture date belongs in a column where it can be corrected, as the issue says. Both rules are deterministic, so a rerun of the rename pass over the same export gives each file the same timestamp, and the random bits are what make a rerun's ids differ, which is why the pass keeps its mapping ([below](#copy-process)). Neither S3's dates nor the objects' `LastModified` would do: the photos were bulk-copied into AWS too, so both say when that copy ran.

### Originals bucket

Only finished originals are ever written to the originals bucket. Nothing else goes into this bucket.

### Copy process

We move the files in two server-side passes:

1. **The copy pass**. Super Slurper copies the AWS bucket into a temporary import bucket. It keeps AWS's keys, since it cannot rename. This makes the next move a cheaper Class A write.
2. **The rename pass**. A script on Moses' localhost laptop copies each current original with `CopyObject`, many at a time, from the import bucket to `originals/<versionId>`, replacing the metadata and keeping the content type.

The rename pass is a checked-in script under `api/scripts/`, run with the OpenTofu token as `media.ts` is, since the Worker's own key cannot write originals. It logs one JSON line per object with the AWS key, the new version id and the outcome, so the log answers what was copied and where it stopped, and it writes the mapping it minted to a file it takes as input on a rerun, so a restart mints nothing twice and the database pass writes the ids the objects have. A rerun is safe by the script's own doing: an object the mapping names and a `HEAD` finds is skipped, never written again. Whether the originals bucket gets a lock that refuses overwrites is undecided, and the pass does not lean on one: a lock would refuse the one write a migration is likely to need, replacing an original the pass got wrong, so if one is on, expect to lift it for that repair and put it back after. Only API calls cross the laptop's connection; the bytes never leave Cloudflare.

Counts and checksums are checked against the source, then the import bucket is deleted. That is about 38,000 Class A writes a pass, about 77,000 of the million a month includes, and deletes are free. Not yet checked, and settled by a test with two throwaway buckets: whether R2's `CopyObject` takes a source in another bucket, which its docs do not say, and the largest object one copy takes (S3's is 5 GB, past which it is `UploadPartCopy`, which R2 has). If a copy cannot cross buckets, Super Slurper writes into the originals bucket under `import/` and the second pass is a copy within the bucket, after which the `import/` objects are deleted; a lock, if there is one, would have to leave that prefix alone.

### Videos

The 52 videos' originals are copied like any other. Their playable form is not regenerated: the AWS derived bucket holds MediaConvert's H.264 MP4 and poster frame for each at `i/<path>/<versionId>/video-transcoded` and `video-poster`, and the copy puts them at `derived/<newVersionId>/video.mp4` and `poster.jpg`, which is all the `/v/` route and the poster-based thumbnails read; the row's width, height and duration come from DynamoDB as they do for a photo. That is 104 objects, few enough to move by key list with rclone. Pushing a video through the transcoder instead is the fallback for any that plays wrong; 34 minutes of video is inside the month's container allowance either way.

## Copy database

The rows come from a DynamoDB export written through `PUT /api/item`, with `itemType` and `mediaType` finished on the way, each media row carrying the version id the rename pass minted for it. The order is year albums, then day albums, then media, then each album's thumbnail through `PATCH /api/album-thumb`, since the foreign key needs the media row to exist. The translation is the one `check-gallery.ts` already does, sanitized names, `_n` for a collision, links in captions rewritten to the new paths, so the importer is that script with the writes kept, sharing `aws-names.ts`. `PUT /api/item` is an upsert that keeps a row's id and timestamps and answers a refusal with the constraint's name, so a rerun over the whole export is the resume, and about 40,000 single-row writes at 8 in flight is tens of minutes. The writes go through the production Worker, so they run outside the DebugBear hours in `api/wrangler.jsonc`'s `crons`, or `docs/Perf.md` notes them.

Two things the rows lose, decided rather than discovered later: AWS's `createdOn` and `updatedOn`, since the item write has no timestamp fields and the app shows neither, and keeping them would mean a field on the import body; and nothing for `position`, since AWS had no ordering, so every album sorts by name until an admin reorders it.

The derived bucket is not copied: derivatives regenerate on request. The observed rate, about 7,700 distinct variants a month and 7,100 without bots, is above the 5,000 the Images allowance includes, so expect about $1 to $1.35 a month at $0.50 per 1,000 after the copy, which the Spending rules want said out loud; a backfill of the newest albums, if the first readers should not wait, is more of the same. `docs/Migrations.md` in the AWS repo has the lessons that apply: idempotent, resumable, newest albums first, diagnose before fix.

## Verify

- **Counts.** Rows per item type against the export, and objects in the originals bucket against media rows: every media row's original exists under its version id, and none is there without a row.
- **Bytes.** Each original's size against S3's listing, and its ETag where the object was written in one part, which is every object under 100 MiB by Super Slurper's rule; the rename pass's `CopyObject` keeps it. The rclone sample verified 830 objects identical the same way.
- **Decoding.** The bulk copy never opens a file, so nothing proves the Images binding can decode every file, scans of the 1800s included, where the pipeline would have refused one. Either the first reader finds a bad file as a broken image, or a sweep asks for one thumbnail per item, about 33,000 paid transformations at $0.50 per 1,000, about $17 once, newest albums first, and every refusal is a row to look at. The sweep is the choice this plan leans to; it needs a yes under the Spending rules before it runs.
- **The app.** Albums from each decade browsed on the site, a search that finds a caption, since the FTS triggers index each row as it is written, and a video that plays.

## Rehearsal

The whole thing runs against staging first, from the production export, since staging holds nothing that matters: the checks, the two passes, the rows, the verification. It costs a second round of S3 egress, about $13, unless the production run then copies staging's verified originals bucket within R2 instead of slurping S3 again, which costs no egress and keeps the ids the rehearsal minted; the rows are cheap to write twice either way.

## Afterwards

- **The first full backup.** The nightly workflow in `.github/workflows/backup.yml` has only ever mirrored a few hundred megabytes; the night after the copy it mirrors 145 GB, against the job's 4-hour limit, which `docs/Risks.md` #22 lists as untested.
- **Spending to say out loud**: about $2 a month of R2 storage for 135 GB over the free 10, and the Images transformations above.
- `import-album.ts` stays for the odd single album, or is retired once the copy has proved the gallery.

## Cost and time

| Step                                           | Time            | Cost                                   |
| ---------------------------------------------- | --------------- | -------------------------------------- |
| Super Slurper, 38,334 objects, 145 GB          | minutes         | about $13 of S3 egress, once           |
| Rename pass, about 38,000 `CopyObject`s        | tens of minutes | inside the free million Class A writes |
| Rows, about 40,000 `PUT /api/item`             | tens of minutes | negligible D1                          |
| Decode sweep, one thumbnail per item, optional | an hour or so   | about $17, once                        |
| Storage afterwards                             |                 | about $2 a month                       |
| Derived images on request                      |                 | about $1 to $1.35 a month              |
