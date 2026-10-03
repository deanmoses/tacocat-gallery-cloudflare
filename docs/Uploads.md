# Uploads

How a file dropped on an album becomes a media item. Presign is `api/src/gallery/presign.ts`, the pipeline `api/src/gallery/upload.ts`.

## The sequence

An admin drops `Felix.HEIC` on `/2001/06-15/`, which the app names `felix`:

```text
app                        Worker                          R2 / Queue / Workflow
 | POST /api/presigned/2001/06-15/                               |
 |   [{ path: "/2001/06-15/felix", extension: "heic" }]          |
 |----------------------------->  check the album, the name and  |
 |                                the type, mint a version id,   |
 |  { url, contentType,           insert an upload row           |
 |    versionId }                                                |
 |<-----------------------------                                 |
 | PUT the file to url, as contentType ------------------------> | originals/<versionId>
 | POST /api/uploaded/<versionId>                                |
 |----------------------------->  start instance                 |
 |  202                           named <versionId> -----------> | Workflow:
 |                                                               |  1. read the photo's facts,
 |                                                               |     or transcode the video
 |                                                               |  2. write the item
 |                                                               |  3. make the detail image
 | poll the album until it holds <versionId>                     |
```

1. **Presign** checks the album exists, the name is one the gallery takes, nothing is already there, and the file's extension is one the gallery takes, then mints the version id, records it in `upload` with the album's id, and answers with a presigned PUT to the original's own key, `originals/<versionId>`, signed with the content type the extension gives.
2. **The browser PUTs** the file straight to R2, as that content type, which R2 stores on the original; a PUT claiming any other type fails its signature. Once the PUT succeeds, the app tells the Worker with `POST /api/uploaded/<versionId>`, and the Worker starts a Workflow instance named by the version id, once it has found the original there. R2 also announces the original on the queue, and the consumer starts the same instance: that is the backstop for an app that never said, as from a tab closed after the PUT, and whichever comes second finds the instance and starts nothing.
3. **The pipeline** looks up the upload row and reads the original where it is. A photo's size, caption and keywords come from its first 256 KB for a JPEG whose headers fit there and from the whole file otherwise; an original stored as a video is transcoded, and its size and duration are the transcoder's.
4. **One batch** inserts the item into the album and marks the upload complete; the first photo in a day becomes its thumbnail.
5. **The media page's image is made**, from the photo or the video's poster, so the admin's first look at the upload does not wait for it. It is tried once, and a failure is only logged: the image's first reader makes it then, as each thumbnail's does.
6. **The app** sees the new version in the album and shows it.

## Replacing

Dropping a file on an existing item updates that row in place: new version, type and size, under the name the row has. Any file may replace any item, so an edited JPEG replaces the HEIC it came from, and a video may replace a photo. Captions and every album showing it are kept, and the file's tags join the row's. The thumbnail crop is kept only if the new image has exactly the old size.

## When it fails

A file that cannot be read or decoded, or an album or item deleted while the upload was in flight, becomes an `upload_error` row, which the app polls for after a drop. Every HEIC straight off an iPhone decodes, 863 sampled from 2023 to 2026 and all 8-bit `heic`; one another app has re-encoded may not, as a 10-bit `heix` with a gain map and an 8-bit HEIC written by macOS `sips` did not on the Images binding, and such a file becomes an upload error naming the decode failure, where exported as JPEG it goes through.

Anything else throws, and the step is retried; once its retries are spent, the error's message becomes the `upload_error` row. Whatever happens, the original stays where the browser put it, so one that never became an item is an object no row points at.

- An announcement whose instance does not start is answered 503, which the app tries twice more before telling the admin; the event may still start it.
- An event whose instance never starts is retried by the queue, 10 s apart, and once those retries are spent it reaches the dead-letter queue, whose consumer writes an `upload_error` telling the admin to upload the file again, unless an instance turns out to be running after all.
- A read of the original that goes 10 s without a byte, before its body starts or partway through, is cancelled and read again at once, logging `read_stalled` with how far it got, and the step fails after three; such reads have hung for minutes inside a Workflow, though nearly a thousand reads of the same kind on staging, in requests and in Workflow instances alike, never did.
- Each attempt at reading a photo logs `upload_stages`: how long each stage took and how the attempt ended, so a slow upload or a failed attempt says where.

## Locally

A Worker cannot consume a real queue, so with `UPLOAD_MODE=local` presign hands out the Worker's own `/upload/<versionId>`, which stores the file as the original and raises the event R2 would. The pipeline runs unchanged. Local development in `Development.md` has what else differs, the images above all.

## Why it's this way

**Presign judges first.** Presign applies the rules the pipeline applies again when the file lands, so what would fail is refused while the admin is still watching, and the pipeline leaves alone an object nobody presigned, as one a script copied into the bucket is. Only a write through R2's S3 API raises the event at all: a file put through the Cloudflare REST API, `wrangler r2 object put` or the dashboard is never announced.

**The type comes from the file's name.** The extension is all presign has before the file is sent, and signing the type it gives into the PUT is what makes the stored type one the Worker chose. Nothing reads the file's bytes to check it, so a file misnamed as another format becomes a broken image, or an upload error if its size cannot be read. The extension stays out of the item's name and URL.

**A Workflow instance per upload.** A queue adds consumers slowly and only as a backlog builds, so fifty photos processed by the consumer run nearly one at a time; as fifty Workflow instances they run at once, each step retried on its own. Instances are not given an isolate each: like any Worker's invocations, several can share one and its 128 MB. The app announces an upload and R2 announces it again, perhaps more than once, and an instance name can be used once, so a second announcement starts nothing. A start that fails counts as a second announcement only once an instance by that id is found: the Workflows API once answered a production upload as though its id were taken when no instance had it, and acking that event lost the upload without a word.

**The app announces its uploads.** R2's event usually arrives within seconds of the PUT, but it has arrived minutes late, for a reason the logs do not settle, and the app's wait ran out. A start that fails in the request also reaches the admin at once, where the queue would retry it in silence.

**These steps.** A step boundary persists its result and costs time, so a step ends only where a retry must respect a change of state. A step never hands the file to the next, since its result is stored. The detail image comes after the item and decides nothing about it: making it a condition of the upload meant a busy image service failed uploads of files with nothing wrong with them. The item is written by the album's id, so an album renamed during the upload still receives it.
