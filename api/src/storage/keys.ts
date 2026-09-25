// Every object is keyed by the version id of the upload it came from and by nothing else. A gallery path is the row's
// business, so a rename of a photo or an album touches no object, and everything a version has is found from its id.

/** A media item's file as it was uploaded, in the media bucket. */
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
