# Storage

Where the media files live and how they are keyed. `api/src/storage/keys.ts` builds every key.

## Two buckets, keyed by version

Media is stored in Cloudflare R2, in a bucket for the originals and one for everything made from them. Each environment's buckets are named for it, `production-originals` and so on. The key the Worker signs URLs with can write both, since the browser's upload is a signed PUT of the original itself and an R2 API token is scoped to whole buckets; it reaches no other bucket.

Take the photo `/2001/06-15/felix`, whose current version id is `01ARYZ6S41TSV4RRFFQ69G5FAV`. Everything stored for it is keyed by that id:

```text
originals bucket
  originals/01ARYZ6S41TSV4RRFFQ69G5FAV               the file as uploaded, put there by the browser

derived bucket
  derived/01ARYZ6S41TSV4RRFFQ69G5FAV/200x200-webp    the album page's thumbnail
  derived/01ARYZ6S41TSV4RRFFQ69G5FAV/400x400-webp    the same for a 2x screen
  derived/01ARYZ6S41TSV4RRFFQ69G5FAV/1024            the media page's image, in the format its original calls for
  derived/01ARYZ6S41TSV4RRFFQ69G5FAV/…               any other size or crop, made the first time it is asked for
  derived/<versionId>/video.mp4, poster.jpg         for a video: its transcode, and the still its images are cut from
```

A version id is a [ULID](https://github.com/ulid/spec), uppercase as its spec writes it: the millisecond it was minted, then 80 random bits, so listings come out in upload order, an id cannot be guessed, and any ULID tool reads its time. The database and the URL parser admit nothing but that shape. Each original also carries the path it was uploaded to as metadata, and `api/scripts/media.ts` prints an item's row and every object stored for it.

## Why it's this way

**No path is in a key.** An original is written once and never overwritten, and the `item` row says which version is current. So create, edit, publish, rename, set a thumbnail and delete are database writes that touch no object: renaming an album full of photos is one batch of row updates. A replacement is a new version, and a delete leaves the objects, so either can be undone by pointing a row back at the old version. Objects no row references any more stay where they are.

**A bucket per role.** An R2 token scopes to whole buckets, never to a prefix, so each role that needs its own permissions gets a bucket of its own: the Worker's signing key reaches the originals and derived buckets, the backup's key reads production's originals, and neither reaches OpenTofu's state.

**Originals stay as uploaded**, HEIC included: Image Transformations decode HEIC, so nothing is converted on the way in and nothing in the pipeline is specific to HEIC.
