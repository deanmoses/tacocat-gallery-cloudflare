# Serving images and video

How a thumbnail, a photo, an original or a video reaches the browser, and the transcoder. The routes are `api/src/routes/`, the image making `api/src/media/`, and every URL is spelled by `shared/src/urls.ts`.

## An image request

The album page asks for `/i/2001/06-15/felix/01ARYZ6S41TSV4RRFFQ69G5FAV?size=200x200`, or `size=400x400` from a screen with two device pixels per CSS pixel, since each thumbnail offers both in its `srcset`:

1. **The colo's cache.** A hit is answered there.
2. **The derived bucket**, under `derived/01ARYZ6S41TSV4RRFFQ69G5FAV/200x200-webp`, the name spelled from the URL and the format it settles, and served as the type it was stored with.
3. **Made on the spot** by Image Transformations, from the version's poster if it is a video, or else its original, then stored in the derived bucket and cached. The Worker fetches the source through a URL it signed for that one object, with `cf.image` options, so the image never passes through the Worker and an original can be up to 100 MB, where the Images binding takes 20. A failure is tried once more after a short pause, unless the code in its `cf-resized` header says the file cannot be decoded, and a response the transformation did not mark is a failure, so an original is never stored as its own derivative.

Every image is cached for a year, since its URL names one version and a new upload has a new URL. The path in the URL is for people reading it, in the network panel or the logs; only the version finds the object, so an old URL keeps working after a rename. The colo cache keys an image by its derived bucket name rather than its URL, so a renamed item's old and new URLs, and a URL with a stray query parameter, share one entry.

Transformations stay disabled on both zones in the dashboard: a Worker's `cf.image` works without them, and enabling them would turn on `/cdn-cgi/image/` URLs, through which anyone could transform images on the account's bill.

## Formats and metadata

Thumbnails are WebP; the media page's image is WebP for a GIF or a PNG and JPEG for anything else. A GIF's WebP keeps its frames and a PNG's its transparency. The media page's image of a photo stays JPEG because readers drag it into other apps, most of which cannot open a WebP. Its format comes from the original's content type, which its file's extension gave it at upload, so its derivative's name carries no format. Every browser the app supports shows WebP, so no `Accept` header is read and responses carry no `Vary`.

The Images binding was found to leave the original's IPTC and XMP blocks and most of its EXIF, GPS position included, in a JPEG whatever its `metadata` option says, three quarters of a thumbnail's bytes, and the XMP's orientation after it has turned the pixels by the EXIF one, which Safari then applies again. So the Worker drops those blocks from every JPEG it stores; a photo dragged into another app therefore arrives without its capture date or caption. Its WebP carries nothing.

## The other media routes

- `/raw/<path>/<versionId>` is the original. A HEIC comes back as a JPEG, since only Safari shows HEIC, unless `?format=original` asks for the file itself.
- `/v/<path>/<versionId>` is a video's MP4, with byte ranges for seeking.

## The transcoder

ffmpeg in a Container (`api/transcoder/`) behind a Durable Object, one instance per video on the largest instance type, so a drop of several videos transcodes them side by side, each asleep once its video is done. The Worker hands it presigned URLs to read the original and write the MP4 and poster into the derived bucket, and it answers with the video's size and duration. The output is H.264 at 1080p at most, keeping an iPhone HDR clip's HLG and BT.2020 tags, which each browser converts to its screen; only the poster is tone-mapped, since a JPEG cannot carry HLG. A file ffmpeg rejects becomes an upload error rather than a retry. A stored video could be transcoded again the same way, after a change to the ffmpeg settings say; nothing does that yet. When the Worker stops waiting, as when its step times out, the container kills the encode, so a retry never shares the CPU with the attempt before it.

## Why it's this way

**One spelling.** `shared/src/urls.ts` builds every image URL, for the app and for the pipeline's pre-made images alike, and the stored name is spelled from the same text. A stored image is found only by a URL spelled exactly the same way, so there must be one place that spells them.

**The media routes need no login.** Knowing a version id is knowing the photo, and its 80 random bits cannot be guessed. Each route reads only the objects under the version it names, in the originals and derived buckets, so nothing else is reachable through them. Checking whether the album is published would cost a database read on routes that otherwise need none.
