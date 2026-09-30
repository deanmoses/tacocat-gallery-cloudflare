# Migrating the AWS gallery data

This plan copies the AWS gallery db and media files into the Cloudflare production environment.

The stages are 1. [Check DynamoDB for data quality issues](#check-dynamodb); 2. [Copy the media](#copy-media); 3. [Copy the database](#copy-database).

## Check DynamoDB

The first part exists: **`check-gallery.ts` runs the constraints over the production gallery's data and reports every row they refuse.** There are reasons to expect some: AWS's image type had `dimensions` optional and its repo carries a dimensions-repair migration with an "unfixable" count, so some rows may lack a size; blank captions, an unlisted video extension, or a name outside AWS's own rule of letters, digits, underscore, hyphen and one extension, which came long after most of the uploads, are all possible in 25 years of them. A scan of the production table is under a penny by the AWS repo's `docs/Migrations.md`, or failing AWS access, every published album through the public API, which is most of the gallery but not the drafts. The copy then repairs rows, reading a missing size from the original, or a rule the gallery argues with is loosened by a table rebuild.

## Copy media

We'll copy only originals, not derived.

### IDs

Each current original in the AWS bucket gets a new version ID, a ULID whose timestamps the copy assigns itself, oldest album first and newest photo last, so a listing of the originals bucket follows album order and every later upload sorts after the copy. The copy runs many objects at a time, so the timestamps cannot be the moments the ids were minted: they are a counter, and say nothing about when a photo was taken or copied. S3's version ids are not kept: S3 documents them as opaque, its own example contains `/` and `+`, which the URL parser and the `version_id` constraint would both refuse, and keeping them would hold every id to the loosest format any of them has. Their dates say nothing either, since the photos were bulk-copied into AWS too. Each original carries its gallery path and its S3 version id as metadata, and no `upload` row, since that table tracks uploads in progress.

### Originals bucket

Only finished originals are ever written to the originals bucket. Nothing else goes into this bucket.

### Copy process

We move the files in two server-side passes:

1. **The copy pass**. Super Slurper copies the AWS bucket into a temporary import bucket. It keeps AWS's keys, since it cannot rename. This makes the next move a cheaper Class A write.
2. **The rename pass**. A script on Moses' localhost laptop copies each current original with `CopyObject`, many at a time, from the import bucket to `originals/<versionId>`, replacing the metadata and keeping the content type. A rerun is safe: the lock refuses an original already there.

Counts and checksums are checked against the source, then the import bucket is deleted. That is about 38,000 Class A writes a pass, about 77,000 of the million a month includes, and deletes are free. Not yet checked, and settled by a test with two throwaway buckets: whether R2's `CopyObject` takes a source in another bucket, which its docs do not say, and the largest object one copy takes (S3's is 5 GB, past which it is `UploadPartCopy`, which R2 has). If a copy cannot cross buckets, Super Slurper writes into the originals bucket under `import/`, which the lock does not cover, and the second pass is a copy within the bucket.

## Copy database

The rows come from a DynamoDB export written through `PUT /api/item`, with `itemType` and `mediaType` finished on the way; media rows go in before any album's thumbnail is set through `PATCH /api/album-thumb`, since the foreign key needs the media row to exist. The derived bucket is not copied: derivatives regenerate on request. The observed rate, about 7,700 distinct variants a month and 7,100 without bots, is above the 5,000 the Images allowance includes, so expect about $1 to $1.35 a month at $0.50 per 1,000 after the copy, which the Spending rules want said out loud; a backfill of the newest albums, if the first readers should not wait, is more of the same. `docs/Migrations.md` in the AWS repo has the lessons that apply: idempotent, resumable, newest albums first, diagnose before fix.
