// Every object is keyed by the version id of the upload it came from and by nothing else. A gallery path is the row's
// business, so a rename of a photo or an album touches no object, and everything a version has is found from its id.

/** A media item's file as it was uploaded, in the originals bucket. */
export function originalKey(versionId: string): string {
    return `originals/${versionId}`;
}

/** Under which everything made from a version lives in the derived bucket: image sizes, and a video's MP4 and poster. */
export function derivedPrefix(versionId: string): string {
    return `derived/${versionId}`;
}

/** The MP4 the transcoder wrote for a video. */
export function videoKey(versionId: string): string {
    return `${derivedPrefix(versionId)}/video.mp4`;
}

/** The still the transcoder cut from a video, which its thumbnails are made from. */
export function posterKey(versionId: string): string {
    return `${derivedPrefix(versionId)}/poster.jpg`;
}

/** A derivative of a version, by the name the image route gives it. Nothing here is imported, so a Node script can. */
export function derivedImageKey(versionId: string, name: string): string {
    return `${derivedPrefix(versionId)}/${name}`;
}

/**
 * Where a local Worker takes an upload itself, in place of a presigned URL into the bucket: a path on the site, which
 * the browser resolves against the page it is on, since under `wrangler dev` the Worker sees its route's hostname in
 * every request rather than the one the browser used.
 */
export function localUploadUrl(versionId: string): string {
    return `/upload/${versionId}`;
}

/** Where the browser puts an upload, in the uploads bucket, under the version id minted for it. */
export function inboxKey(versionId: string): string {
    return `inbox/${versionId}`;
}

/**
 * A new version id: a ULID, the moment it was minted as a 48-bit millisecond timestamp, so a listing of originals is
 * in upload order, then 80 random bits, which are what make knowing the id knowing the photo. Each id's random bits
 * are its own: the spec's monotonic mode, which counts up from the last id within a millisecond, would make every
 * sibling of one id from a batch upload guessable.
 */
export function mintVersionId(now = Date.now()): string {
    const bytes = new Uint8Array(16);
    let time = now;
    for (let index = 5; index >= 0; index -= 1) {
        bytes[index] = time % 256;
        time = Math.floor(time / 256);
    }
    crypto.getRandomValues(bytes.subarray(6));
    return crockford(bytes);
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** The 128 bits as the ULID spec writes them: 26 characters of five bits, the first two bits of the first being zero. */
function crockford(bytes: Uint8Array): string {
    let text = '';
    let buffer = 0;
    let buffered = 2;
    for (const byte of bytes) {
        buffer = (buffer << 8) | byte;
        buffered += 8;
        while (buffered >= 5) {
            buffered -= 5;
            text += CROCKFORD.charAt((buffer >>> buffered) & 31);
        }
    }
    return text;
}
