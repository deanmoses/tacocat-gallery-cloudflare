# Migrating the AWS gallery data

This plan copies the AWS gallery's rows and original media files into the Cloudflare production environment. What there is to copy, counted on 2026-09-24: 37,875 media items, 37,820 images and 52 videos, about 34 minutes of video in all, by the AWS repo's `docs/plans/HostingDeepDive.md`; and 38,334 objects, 145 GB, in the production originals bucket (`docs/Risks.md` #21).

The stages are 1. [Check DynamoDB for data quality issues](#check-dynamodb); 2. [Copy the media](#copy-media); 3. [Copy the database](#copy-database); 4. [Verify](#verify). The whole thing is [rehearsed on staging](#rehearsal) before it runs against production. Then we bring back what the 2023 move from Zenphoto to AWS lost is [its own step](#recover-lost-zenphoto-albums) after the copy, followed by [a check of the gallery before Zenphoto](#check-the-gallery-before-zenphoto).

Going live and taking over the hostname afterwards is a separate decision, and is its own section of `docs/plans/AwsPort.md`.

## Check DynamoDB

The first part exists: **`import-gallery.ts` run against `wrangler dev` (`--to local`) runs the constraints over the production gallery's data and reports every row they refuse.** It was `check-gallery.ts` until it became the importer, which is what the Log's early entries call it. There are reasons to expect some: AWS's image type had `dimensions` optional and its repo carries a dimensions-repair migration with an "unfixable" count, so some rows may lack a size; blank captions, an unlisted video extension, or a name outside AWS's own rule of letters, digits, underscore, hyphen and one extension, which came long after most of the uploads, are all possible in 25 years of them. A scan of the production table is under a penny by the AWS repo's `docs/Migrations.md`, or failing AWS access, every published album through the public API, which is most of the gallery but not the drafts. The copy then repairs rows, reading a missing size from the original, or a rule the gallery argues with is loosened by a table rebuild. What its runs against production found is in the [Log](#log); nothing is copied until its report is clean.

The second check is against S3 rather than the rows: `check-s3-versions.ts` reads a `ListObjectVersions` of the originals bucket, which says which version of each key is current. Super Slurper copies the current version, and the rename pass keys each copy by its row, so a row whose `versionId` is not S3's current version for its path is a row the copy would pair with the wrong file. That is what an upload whose AWS processing failed partway looks like, the row keeping the old version while S3 holds the new one as current, and each such row is looked at and settled before the copy rather than copied. The check found one, `/2026/01-23/jim13.jpg`, whose version has expired; the rename pass takes each row's file by its key's current version, which pairs it with the one file S3 holds for it, the same photo uploaded a second earlier ([Log](#log), 2026-09-30).

## Copy media

We'll copy only originals, not derived, except for the videos' transcodes ([below](#videos)).

### IDs

Each current original in the AWS bucket gets a new version id, a ULID as issue #99 and its pull request make every version id: 48 bits of millisecond timestamp and 80 random bits, 26 characters of uppercase Crockford base32. S3's version ids are not kept: S3 documents them as opaque, its own example contains `/` and `+`, which the URL parser and the `version_id` constraint would both refuse, and keeping them would hold every id to the loosest format any of them has. Each original carries its gallery path and the S3 version the copy took of it as metadata, and no `upload` row, since that table tracks uploads in progress.

A migrated file's id is minted as an upload's is, stamped with the moment `mint-version-ids.ts` mints it, so the timestamp in every version id means one thing: when this gallery minted it. For a migrated file that is the day of the copy, which says nothing about when the photo was taken or first uploaded, and nothing else could: the photos were bulk-copied into AWS too, so S3's dates and the objects' `LastModified` say when that copy ran. When a photo was taken belongs in a column where it can be corrected, as the issue says, and the album's date and order say where it sits. The ids are random as well as timestamped, so a second minting would give every file a different one, which is why they are minted once, into a file the rename pass and the import both read ([below](#copy-process)).

### Originals bucket

Only finished originals are ever written to the originals bucket. Nothing else goes into this bucket.

### Copy process

We move the files in two server-side passes:

1. **The copy pass**. Super Slurper copies the AWS bucket into a temporary import bucket. It keeps AWS's keys, since it cannot rename. This makes the next move a cheaper Class A write.
2. **The rename pass**. `copy-originals.ts`, on Moses' laptop, copies each current original with `CopyObject`, many at a time, from the import bucket to `originals/<versionId>`, replacing the metadata and giving the content type the Worker's own sniffer reads from the file's first bytes, as an upload's is given.

The ids come first, from `mint-version-ids.ts`, which reads the scan and the bucket's version listing and writes every original's new id to a file, with the S3 version the listing shows as current, which is the file Super Slurper copies. It never overwrites a file; the rename pass and the import both read the one it writes, so the rows name the ids the objects have and a restart mints nothing twice. A later scan is minted `--from` the earlier file: an original it gave an id keeps it while S3 still holds the same version and the copy puts it at the same path, and only a new photo, one replaced on AWS since, or one whose path moved, as a new upload can move which of two same-named photos gets `_2`, gets a new id, so the rename pass copies only those. The minting records each file's size and ETag from the listing too, and the rename pass refuses a source in the import bucket that differs from them. A second Super Slurper run copies only keys the import bucket lacks, with its overwrite setting off, so a photo replaced on AWS since the first run still holds its old bytes there; the rename pass stops on it rather than copy the old file under the new id, and that photo's new version is copied into the import bucket by hand before the pass runs again. The rename pass runs with the OpenTofu token as `media.ts` does, since the Worker's own key cannot write originals, and logs one JSON line per object with the AWS key, the new version id and the outcome, so the log answers what was copied and where it stopped. A rerun is safe by the script's own doing: an object whose target a `HEAD` finds is skipped, never written again.

The rename pass and the import share their guard rails (`api/scripts/migration-run.ts`). Each touches only the albums it is named with `--only`, with the year albums that hold them for the import, or everything when told `--all`, and refuses to start with neither or both; each names its target with `--to`; each writes nothing without `--go`, and a run without it reads and judges everything in scope and says what it would write. Each tries a dropped request again twice, and stops the whole run on a refused credential, on a request that fails all three tries, and at the fifth item that goes wrong. So the order is a dry run, then one album with `--go`, looked at on the site, then more. Whether the originals bucket gets a lock that refuses overwrites is undecided, and the pass does not lean on one: a lock would refuse the one write a migration is likely to need, replacing an original the pass got wrong, so if one is on, expect to lift it for that repair and put it back after. Only API calls cross the laptop's connection; the bytes never leave Cloudflare.

Counts and checksums are checked against the source, then the import bucket is deleted. That is about 38,000 Class A writes a pass, about 77,000 of the million a month includes, and deletes are free. A test with two throwaway buckets settled how the copy behaves ([Log](#log), 2026-09-30): R2's `CopyObject` takes a source in another bucket, so the import bucket stands, and one copy took 300 MiB, past the gallery's largest original of 281 MiB. Three things the rename pass has to do for itself follow from it. Replacing the metadata drops the content type, so each copy sends the source's `Content-Type` again. A copy ignores `If-None-Match: *` and overwrites, so the pass's `HEAD` before each copy is what keeps a rerun from writing twice. And a copy of an object written in parts comes out as one part, whose ETag is the MD5 of the whole file, which [Verify](#verify) uses.

### Videos

The 52 videos' originals are copied like any other. Their playable form is not regenerated: the AWS derived bucket holds MediaConvert's H.264 MP4 and poster frame for each at `i/<path>/<versionId>/video-transcoded` and `video-poster`, and the copy puts them at `derived/<newVersionId>/video.mp4` and `poster.jpg`, which is all the `/v/` route and the poster-based thumbnails read; the row's width, height and duration come from DynamoDB as they do for a photo. That is 104 objects, few enough to move by key list with rclone. Pushing a video through the transcoder instead is the fallback for any that plays wrong; 34 minutes of video is inside the month's container allowance either way.

## Copy database

The rows come from a DynamoDB export written through `PUT /api/item`, with `itemType` and `mediaType` finished on the way, each media row carrying the version id the rename pass minted for it. The order is year albums, then day albums, then media, then each album's thumbnail through `PATCH /api/album-thumb`, since the foreign key needs the media row to exist. The translation is the one the check does, sanitized names, `_n` for a collision, links in captions rewritten to the new paths, since the check is `import-gallery.ts` run against `wrangler dev`, and staging and production are `--to staging` and `--to production` with the version id file. `PUT /api/item` is an upsert that keeps a row's id and timestamps and answers a refusal with the constraint's name, so a rerun over the whole export is the resume, and about 40,000 single-row writes at 8 in flight is tens of minutes. The writes go through the production Worker, so they run outside the DebugBear hours in `api/wrangler.jsonc`'s `crons`, or `docs/Perf.md` notes them.

Two things the rows lose, decided rather than discovered later: AWS's `createdOn` and `updatedOn`, since the item write has no timestamp fields and the app shows neither, and keeping them would mean a field on the import body; and `position` only where the new names would reorder an album. AWS showed an album in its names' order by code point, and sanitizing moves some items, since a hyphen sorted before the extension's dot and a capital before any lowercase letter; captions that tell a story need their photos where they were, as in `/2010/10-10/`, whose `eiffel` follows nine `eiffel-tower` photos. So each of the 34 albums sanitizing reorders gets AWS's order through `PUT /api/album-order` (`awsOrder` in `aws-names.ts`), and every other album sorts by name, which is already AWS's order.

The derived bucket is not copied: derivatives regenerate on request. The observed rate, about 7,700 distinct variants a month and 7,100 without bots, is above the 5,000 the Images allowance includes, so expect about $1 to $1.35 a month at $0.50 per 1,000 after the copy, which the Spending rules want said out loud; a backfill of the newest albums, if the first readers should not wait, is more of the same. `docs/Migrations.md` in the AWS repo has the lessons that apply: idempotent, resumable, newest albums first, diagnose before fix.

## Verify

- **Counts.** Rows per item type against the export, and objects in the originals bucket against media rows: every media row's original exists under its version id, and none is there without a row.
- **Orphans.** An original copied under an id that a later minting replaced, for a photo replaced or moved on AWS, or dropped, for one deleted there, belongs to no row. The mintings list them, and the counts above find them; they are listed with their ids and deleted by hand once Moses has said yes, since a delete cannot be undone.
- **Bytes.** Each original's size against S3's listing, and its ETag where the object was written in one part, which is every object under 100 MiB by Super Slurper's rule; the rename pass's `CopyObject` keeps a one-part object's ETag. An object Super Slurper wrote in parts, the 7 originals over 100 MiB, comes out of the rename pass with the MD5 of the whole file as its ETag, which S3's multipart ETag cannot be compared with, so those 7 are checked against the MD5 of Moses' own copies. The rclone sample verified 830 objects identical the same way.
- **Decoding.** The bulk copy never opens a file, so nothing proves the Images binding can decode every file, scans of the 1800s included, where the pipeline would have refused one. Either the first reader finds a bad file as a broken image, or a sweep asks for one thumbnail per item, about 33,000 paid transformations at $0.50 per 1,000, about $17 once, newest albums first, and every refusal is a row to look at. The sweep is the choice this plan leans to; it needs a yes under the Spending rules before it runs.
- **Trimmed thumbnails, by Moses.** Each of the 104 thumbnails whose AWS crop the copy trimmed ([Log](#log), 2026-09-30) looked at on the site against the same photo on AWS, while AWS still serves it: the trim is a few pixels, so the two should match, and one that does not is cut again. `import-gallery.ts` with `--paths` lists them as `trimmed:`.
- **`/2026/01-23/jim13`, by Moses.** Its row named an upload S3 has since expired, and the copy pairs it with the other upload of the same second, so the photo on the site is looked at against AWS's page while AWS still serves it.
- **The app.** Albums from each decade browsed on the site, a search that finds a caption, since the FTS triggers index each row as it is written, and a video that plays.

## Freezing AWS

AWS stays live while the copy is prepared, so the final run starts by freezing it: from the final scan until the hostname moves, Moses uploads, edits and deletes nothing on AWS, since a change made after the scan would not reach Cloudflare. The final run is, in order: the freeze; a fresh DynamoDB scan and S3 listing; the two checks over them; a minting `--from` the rehearsal's id file, which keeps every id the rehearsal minted for an unchanged original; the copy of whatever is new; the rename pass, which skips every original already there; the import; the verification; and the move of the hostname.

## Rehearsal

The whole thing runs against staging first, from the production export, since staging holds nothing that matters: the checks, the two passes, the rows, the verification. It costs a second round of S3 egress, about $13, unless the production run then copies staging's verified originals bucket within R2 instead of slurping S3 again, which costs no egress and keeps the ids the rehearsal minted; the rows are cheap to write twice either way.

## Afterwards

- **The first full backup.** The nightly workflow in `.github/workflows/backup.yml` has only ever mirrored a few hundred megabytes; the night after the copy it mirrors 145 GB, against the job's 4-hour limit, which `docs/Risks.md` #22 lists as untested.
- **Spending to say out loud**: about $2 a month of R2 storage for 135 GB over the free 10, and the Images transformations above.
- `import-album.ts` stays for the odd single album, or is retired once the copy has proved the gallery.
- **Moses cuts eight thumbnails again**, whose AWS crops the copy drops ([Log](#log), 2026-09-30): `/2024/05-25/doubles_pickle2`, `/2024/08-23/river5`, `/2024/09-05/dog_walk2`, `/2024/10-21/show_hadestown2`, `/2025/06-15/photo020`, `/2025/06-15/photo022`, `/2025/09-21/go_petrovaradin08` and `/2025/12-28/uc_campus1`.
- **Moses renames `/1991/11-30/` to its real date.** AWS holds it as `/1991/11-31/`, a day the calendar lacks, and could not rename an album with photos in it, so the copy puts it on the 30th (`copiedAlbumPath` in `api/scripts/aws-names.ts`).

## Recover lost Zenphoto albums

From 2007 to 2023 the gallery ran on Zenphoto at Dreamhost, where it still is, and its MySQL database is still to hand. The 2023 move to AWS copied its files into S3 on 2023-12-13 and wrote a DynamoDB row per album and photo, and some albums got the files but no rows. The S3 version check found 11 ([Log](#log), 2026-09-30), 147 photos in all: `1977/12-31/`, `2007/01-07/`, `2008/01-10/`, `2008/12-07/`, `2009/05-16/`, `2015/03-25/`, `2015/07-12/`, `2016/08-01/`, `2019/09-14/`, `2019/09-21/` and `2023/01-10/`. They are real albums: the caption of `/2008/01-13/` links readers to `/2008/01-10`, "Felix's class bake a king cake", whose photos are `galette01.jpg` and `galette02-recette.jpg`, and AWS never deleted them, since its deletes leave delete markers in the versioned bucket and these files have none. Moses also has the photos on his own disk.

The recovery comes after the AWS copy is verified, so Verify compares Cloudflare with the AWS export alone, and the recovery is an addition the counts expect.

1. **Compare Zenphoto with DynamoDB.** The S3 check finds only albums whose files reached S3 without rows; an album whose files were lost too leaves no trace there, and a caption lost on the way looks like none. So every Zenphoto album, photo, title and caption is compared with the DynamoDB scan, which says what else is missing, and whether any of the 18 other files in albums that do exist, such as the TIFFs of `2008/08-21/`, was a gallery photo.
2. **Import what is missing** through the Worker's own upload, from Moses' disk or the AWS bucket, so the pipeline reads each photo's size from the file, with the titles and captions from Zenphoto and the names and order the copy uses (`aws-names.ts`). The albums go in unpublished, for Moses to look over before publishing.

## Check the gallery before Zenphoto

From 2001 to 2007 the gallery ran on at least one system before Zenphoto, also still at Dreamhost, and moving from it to Zenphoto may have lost albums or photos the same way the move to AWS did. Moses' laptop holds every photo from every system and every year.

After the Zenphoto recovery, that system's albums and photos are listed from its own storage at Dreamhost and compared with the gallery, and the laptop's archive with both, so that an album or photo any system held, or that only the laptop holds, and that the gallery lacks is found. What turns up is imported as the Zenphoto recovery imports, unpublished for Moses to look over.

## Cost and time

| Step                                           | Time            | Cost                                   |
| ---------------------------------------------- | --------------- | -------------------------------------- |
| Super Slurper, 38,334 objects, 145 GB          | minutes         | about $13 of S3 egress, once           |
| Rename pass, about 38,000 `CopyObject`s        | tens of minutes | inside the free million Class A writes |
| Rows, about 40,000 `PUT /api/item`             | tens of minutes | negligible D1                          |
| Decode sweep, one thumbnail per item, optional | an hour or so   | about $17, once                        |
| Storage afterwards                             |                 | about $2 a month                       |
| Derived images on request                      |                 | about $1 to $1.35 a month              |

## Log

### 2026-09-30

#### Second review of the copy scripts

The second review found four more things, and each is changed:

- **The copy checks what it copies.** A second Super Slurper run with overwrite off leaves a photo replaced on AWS with its old bytes in the import bucket. The minting now records each file's size and ETag from the listing, and `copy-originals.ts` refuses a source whose size differs, or whose ETag differs where the source is one part, which is every object under 100 MiB. S3's listing has no multipart ETag today.
- **A moved path gets a new id.** A new upload can move which of two same-named photos gets `_2`; an item whose path moved now gets a new id, so its copy's metadata names the path it has.
- **Orphans are deleted by hand** after the counts ([Verify](#verify)).
- **Comment lines over 120 characters**, which Prettier does not rewrap, are rewrapped.

#### Review of the copy scripts

A second session reviewed the copy scripts, and these changed:

- **A later scan keeps the ids.** `mint-version-ids.ts` takes `--from` an earlier id file and mints only for new or replaced originals, where it had minted every id afresh each run, which after a fresh scan near cutover would have meant copying all 145 GB again under new ids. Minted from the first test file with the same scan, it kept all 37,975.
- **The metadata names the file copied.** Each original's `aws-version-id` is now the version S3's listing shows as current, which is the one Super Slurper copies, where it was the version the row named: `/2026/01-23/jim13.jpg` now records `xD_IF9…`, the file it holds, not the expired `h.QQqWw…`.
- **AWS freezes for the final run** ([Freezing AWS](#freezing-aws)), which the plan had not said.
- **Two checks that pass on today's data:** the copy plan refuses a day album that would move onto an existing one, since `/1991/11-31/` moving onto a `/1991/11-30/` would merge the two, and an item whose name sanitizes to nothing gets no id, so its row is refused rather than written under its album's path.

#### Version ids stamped with when they are minted

A review of the copy scripts questioned stamping migrated ids with their album's date, and the ids now carry the moment they are minted, as an upload's do ([IDs](#ids)). The album-date stamps bought a listing of the originals bucket in album order, at the price of a timestamp that meant one thing for uploads and another for 38,000 migrated files, a special case for albums before 1970 and a refusal of any album dated 1970-01-01. The copy's newest-albums-first order now comes from the album paths. The entries below that mention stamping by album date describe the scripts as they were then.

#### Copy scripts built and tried locally

`mint-version-ids.ts` wrote 37,975 ids to a test file, the first `01C2JBFP00…`, midnight UTC on 2017-12-30, and a second run refused to overwrite it. `import-gallery.ts --to local` with that file wrote `/2010/10-10/` alone with `--only`, its year album included, AWS's order and both thumbnails, then all of it with `--all`: 39,829 rows, 1,854 thumbnails and 34 orders, none refused, in 80 seconds. `copy-originals.ts` has not copied anything yet, since there is no import bucket; a dry run of `/2010/10-10/` against staging from a bucket that does not exist stopped at the fifth failure, and the three already under way when it stopped failed after it, as they should.

#### Two-bucket R2 copy test

A throwaway script, with the OpenTofu token as S3 credentials, made two buckets, put a 200 KB object typed `image/jpeg` in one, and built a 300 MiB `video/quicktime` object there from thirty 10 MiB `UploadPartCopy`s, then copied each into the other bucket under an `originals/` key with its metadata replaced. Both buckets were deleted afterwards. What it showed:

- **A copy crosses buckets**, and one copy takes 300 MiB, more than the gallery's largest original, `2019/03-17/match_5419.mov` at 281 MiB. So Super Slurper fills an import bucket, and no original needs `UploadPartCopy`.
- **Size and one-part ETag are kept**: the small object's ETag was the same after the copy.
- **A multipart source comes out as one part**: the 300 MiB object's ETag went from `da88…-30`, S3's form for thirty parts, to `58720d58…`, which is the MD5 of the whole file, computed locally.
- **`x-amz-metadata-directive: REPLACE` drops the content type** unless the copy sends it; with `Content-Type` sent, it is kept, and the new metadata is all there is.
- **`If-None-Match: *` on a copy is ignored**: a second copy onto an existing key answered 200 and overwrote.

#### The missing albums are real

The 11 albums the S3 version check found with files and no rows are real albums, which the 2023 move from Zenphoto to AWS lost, and Moses has their photos and Zenphoto's MySQL database, hosted on Dreamhost.

Bringing them back is [its own step](#recover-lost-zenphoto-albums), after the copy.

#### S3 version check

`aws s3api list-object-versions` of `tacocat-gallery-sam-prod-original-images`: 39,926 versions and 43 delete markers of 39,920 keys, complete. The delete markers are all single photos deleted in September 2026. `api/scripts/check-s3-versions.ts` compared it with the scan:

- **37,974 of 37,975 rows are on their key's current version.** The other, `/2026/01-23/jim13.jpg`, names a version that has expired. S3 holds one version of the key, written at 04:34:17 on 2026-01-24, and the row was made a second later naming another: most likely the photo was uploaded twice within a second and its processing recorded the first upload after the second had replaced it. The only file there is is that one. AWS's page still shows it, from the derived images made from the expired version at 04:34:25 and 04:34:44, before it expired; the derived bucket also holds a 1024 made from the current one at 04:34:24. **Decided: the copy pairs the row with the current file**, and Moses looks at it afterwards ([Verify](#verify)).
- **1,903 current files no row names**, which the copy leaves behind:
    - 1,544 folder markers, keys ending in `/`.
    - About 190 files that are not photos: 81 `.xmp` sidecars, 78 beside a JPEG of the same name and 3 named for an album, mostly in `2014/10-31/`, `2014/12-21/` and `2014/12-28/`; 90 dotfiles and files with no extension; 17 `.txt` files; `.picasa.ini`, `Thumbs.db` and `.BridgeSort`. Left behind, sidecars included, without looking inside.
    - 147 photos in 11 albums that have no row, which are real albums the 2023 move lost ([above](#the-missing-albums-are-real)).
    - 18 more files in albums that do exist: 9 TIFFs in `2008/08-21/`, a Sony `.arw`, a Nikon `.nef`, a `.heic`, 4 PNGs in `2025/04-27/`, `2015/01-11/a4-aceeyah-laughing.jpg` and a file named `.jpg` in `2019/07-15/`. **Decided: left behind**, and revisited in the Zenphoto comparison ([Recover lost Zenphoto albums](#recover-lost-zenphoto-albums)).

#### check-gallery.ts #4

With empty captions left out: all 39,829 rows written, none refused, and all 34 album orders accepted. The report is clean.

#### check-gallery.ts #3

With crops trimmed and dropped: 39,809 rows written, 20 refused, the 13 empty titles and 7 empty summaries.

#### check-gallery.ts #2

39,697 rows written, 132 refused:

- 112 thumbnail crops that start below 0 or run past the image. 104 run at most 10 pixels past, all within 1% of the photo's short side: AWS's crop tool made squares a few pixels larger than the short side, such as 3653×3653 on the 5472×3648 `/2023/05-07/horse_race5.jpg`, and its image Lambda trimmed them when cutting the thumbnail, which looks right on the site. The copy trims them the same way (`copiedCrop` in `api/scripts/aws-crops.ts`). The other 8 run exactly 1,008 pixels past, 4032 less 3024: each was cut while AWS stored the photo's raw pixel size with width and height swapped, since uploads ignored the EXIF orientation until commit 00dea18 of the AWS repo on 2026-01-14, and each was last updated on 2026-01-15 by that repo's Fix Dimensions & Tags migration, which corrected the size and left the crop. Their thumbnails on AWS are not what was chosen, as `/2025/12-28/uc_campus1.jpg` shows, so the copy drops those crops for the default and Moses cuts them again afterwards ([Afterwards](#afterwards)).
- 13 titles, all in `/2025/12-12/`, and 7 album summaries that AWS stored as empty strings, which the caption rule refuses so that no caption is always written one way. The copy leaves them out.

What the copy changes: `/1991/11-31/`, an impossible date, goes to `/1991/11-30/` ([Afterwards](#afterwards)). 3,640 names change beyond losing their extension, mostly hyphens to underscores, and one collides, `/2026/09-21/o_the_flip08.png` becoming `o_the_flip08_2`. Sanitizing would reorder 34 albums, which get AWS's order back, all 34 accepted. 201 caption links are rewritten, none unresolved. 100 media are in albums before 1970 and are stamped from 1970-01-01.

#### check-gallery.ts #1

`check-gallery.ts` against `wrangler dev` refused 37,842 rows on `item_file_check`, because it sent S3's version ids, which the ULID constraint refuses. The check now mints each id as the copy will, stamped by album date ([IDs](#ids)).

#### DynamoDB scan

`aws dynamodb scan` of the table: 39,829 rows, 1,854 albums and 37,975 media, 47 MB, complete with no `NextToken`. Saved outside the repo as `~/dev/tacocat-migration/prod-items.json`, since it holds the drafts. There are 100 more media than the count of 2026-09-24.

#### DynamoDB capacity change

The production items table, `tacocat-gallery-sam-prod-items`, is on-demand with a maximum of 10 reads and 3 writes a second, although the SAM template still declares it provisioned at 3 and 3, so a `sam deploy` would try to switch it back. The site shares that cap, and a scan at 10 would have taken about 8 minutes while throttling the site's reads, so the maximum reads were raised to 1,000 for the scan and then set back to 10 afterwards.
