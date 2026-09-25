import { DOMParser, onErrorStopParsing } from '@xmldom/xmldom';
import ExifReader from 'exifreader';
import type { Size } from 'tacocat-gallery-shared';

interface ImageFacts extends Size {
    title: string | null;
    description: string | null;
    tags: string[] | null;
}

export type ImageOutcome = { ok: true; facts: ImageFacts } | { ok: false; error: string };

// Workers have no DOMParser, and without one ExifReader skips the XMP packet. xmldom's `onError` option makes it give
// up on a malformed packet, which its README says it otherwise loops on.
const XML_PARSER = new DOMParser({ onError: onErrorStopParsing });

/**
 * The size of an image and the caption written into it: the IPTC fields a JPEG carries, else the XMP ones, which are
 * all a HEIC or PNG has. Adobe Bridge writes both, the same text in each. The fields and their order are the AWS
 * Lambda's, so a file captioned once reads the same on either site. An error for a file ExifReader cannot read.
 */
export async function readImage(bytes: ArrayBuffer): Promise<ImageOutcome> {
    let tags: ExifReader.ExpandedTags;
    try {
        tags = await ExifReader.load(bytes, { expanded: true, async: true, domParser: XML_PARSER });
    } catch (error) {
        return { ok: false, error: `not a readable image: ${String(error)}` };
    }
    const size = imageSize(tags);
    if (size === null) {
        return { ok: false, error: 'the image does not say its size' };
    }
    const { iptc, xmp } = tags;
    return {
        ok: true,
        facts: {
            ...size,
            title:
                tagText(iptc?.['Object Name']) ??
                tagText(iptc?.Headline) ??
                tagText(xmp?.['title']) ??
                tagText(xmp?.['Headline']),
            description: tagText(iptc?.['Caption/Abstract']) ?? tagText(xmp?.['description']),
            tags: keywords(iptc?.Keywords) ?? keywords(xmp?.['subject']?.value),
        },
    };
}

/**
 * The size as the image is shown, from the file's own header, or the EXIF one where the file has no header ExifReader
 * reads, as HEIC. Orientations 5 to 8 turn the image a quarter turn, so it shows the other way round from how its
 * pixels are stored, and every size and crop the gallery keeps is in the shown frame.
 */
function imageSize(tags: ExifReader.ExpandedTags): Size | null {
    const { file, exif, pngFile, gif } = tags;
    const width =
        tagNumber(file?.['Image Width']) ??
        tagNumber(exif?.ImageWidth) ??
        tagNumber(exif?.PixelXDimension) ??
        tagNumber(pngFile?.['Image Width']) ??
        tagNumber(gif?.['Image Width']);
    const height =
        tagNumber(file?.['Image Height']) ??
        tagNumber(exif?.ImageLength) ??
        tagNumber(exif?.PixelYDimension) ??
        tagNumber(pngFile?.['Image Height']) ??
        tagNumber(gif?.['Image Height']);
    if (width === null || height === null) {
        return null;
    }
    const turned = (tagNumber(exif?.Orientation) ?? 1) >= 5;
    return turned ? { width: height, height: width } : { width, height };
}

/** The keywords of a tag that lists them, one per element, blanks and repeats dropped; null when that leaves none. */
function keywords(tag: unknown): string[] | null {
    if (!Array.isArray(tag)) {
        return null;
    }
    const words = tag.map(tagText).filter((word) => word !== null);
    return words.length === 0 ? null : [...new Set(words)];
}

function tagText(tag: unknown): string | null {
    if (typeof tag !== 'object' || tag === null || !('description' in tag)) {
        return null;
    }
    const { description } = tag;
    return typeof description === 'string' && description.trim() !== '' ? description.trim() : null;
}

function tagNumber(tag: unknown): number | null {
    if (typeof tag !== 'object' || tag === null || !('value' in tag)) {
        return null;
    }
    const { value } = tag;
    return typeof value === 'number' && value > 0 ? value : null;
}
