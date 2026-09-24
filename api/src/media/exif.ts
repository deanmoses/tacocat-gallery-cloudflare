import ExifReader from 'exifreader';
import type { Size } from 'tacocat-gallery-shared';

interface ImageFacts extends Size {
    title: string | null;
    description: string | null;
}

export type ImageOutcome = { ok: true; facts: ImageFacts } | { ok: false; error: string };

/**
 * The size of an image and the IPTC title and description, where Lightroom and Photos put them. An error for a file
 * that is not an image ExifReader can read, which is every format the gallery holds.
 */
export function readImage(bytes: ArrayBuffer): ImageOutcome {
    let tags: ExifReader.Tags;
    try {
        tags = ExifReader.load(bytes, { expanded: false });
    } catch (error) {
        return { ok: false, error: `not a readable image: ${String(error)}` };
    }
    const size = imageSize(tags);
    if (size === null) {
        return { ok: false, error: 'the image does not say its size' };
    }
    return {
        ok: true,
        facts: {
            ...size,
            title: tagText(tags.Headline) ?? tagText(tags['title']) ?? tagText(tags['ObjectName']),
            description: tagText(tags.ImageDescription) ?? tagText(tags['Caption/Abstract']),
        },
    };
}

/**
 * The size as the image is shown, from the file's own header, or the EXIF one where the file has no header ExifReader
 * reads, as HEIC. Orientations 5 to 8 turn the image a quarter turn, so it shows the other way round from how its
 * pixels are stored, and every size and crop the gallery keeps is in the shown frame.
 */
function imageSize(tags: ExifReader.Tags): Size | null {
    const width = tagNumber(tags['Image Width']) ?? tagNumber(tags.PixelXDimension);
    const height = tagNumber(tags['Image Height']) ?? tagNumber(tags.PixelYDimension);
    if (width === null || height === null) {
        return null;
    }
    const turned = (tagNumber(tags.Orientation) ?? 1) >= 5;
    return turned ? { width: height, height: width } : { width, height };
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
