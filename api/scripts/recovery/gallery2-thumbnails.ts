// Gallery 2 let an admin cut a photo's thumbnail from a square of it. The 2014 move to Zenphoto did not carry the cut,
// and made every thumbnail from the middle of the photo. This traces each cut to the photo's name today, through the
// Zenphoto photo the Gallery 2 comparison matched it to, and says what writing it changes. Nothing here touches the
// network, so a test can hold it still.
//
// Gallery 2 kept each thumbnail as a derivative of the photo, listing the operations that made it, such as
// `crop|31.449,25.6,27.56,41.45;thumbnail|200`, whose crop is in percent of the image it was cut from. That image was
// the photo's preferred derivative where Gallery 2 had rotated the photo, which it did by making one, `rotate|-90`,
// and left the file alone; the gallery has every one of those upright, so a crop of one is in the gallery's frame.
import { type CropPercent, type Rectangle, mediaPath, sanitizeMediaName } from '@tacocat-gallery/shared';
import * as valibot from 'valibot';
import { type Gallery2Item, treeOf } from './gallery2.ts';
import type { Match } from './gallery2-order.ts';

/** A derivative row of Gallery 2's: a thumbnail, a resize or a preferred version of `parent`, made from `source`. */
export const GALLERY2_DERIVATIVE = valibot.object({
    id: valibot.number(),
    parent: valibot.number(),
    source: valibot.number(),
    type: valibot.number(),
    operations: valibot.nullable(valibot.string()),
});

export type Gallery2Derivative = valibot.InferOutput<typeof GALLERY2_DERIVATIVE>;

const THUMBNAIL = 1;
const PREFERRED = 3;

/**
 * How far apart, as a share, the shape of Gallery 2's file and the gallery's may be and still be the same picture:
 * Gallery 2's copies are scaled to 640 or 1024 pixels, which rounds their shape by a few tenths of a percent.
 */
const SAME_SHAPE = 0.01;

/** A thumbnail Gallery 2's admin cut, and the photo it belongs to today. */
export interface LostCrop {
    /** The photo's path in Gallery 2, such as `2007/01-28/skateboard1.jpg`. */
    from: string;
    /** Its path today, such as `/2007/01-28/skateboard1`. */
    path: string;
    crop: CropPercent;
    /** The shape of the image the crop was cut from, in Gallery 2. */
    shape: { width: number; height: number };
}

/**
 * Every thumbnail Gallery 2's admin cut from a photo, under the photo's name today, and the photos that have none
 * because the comparison matched them to nothing in Zenphoto.
 */
export function lostCrops(
    items: readonly Gallery2Item[],
    derivatives: readonly Gallery2Derivative[],
    matches: readonly Match[],
): { crops: LostCrop[]; unmatched: string[] } {
    const tree = treeOf(items);
    const derivativeById = new Map(derivatives.map((derivative) => [derivative.id, derivative]));
    const zenOf = new Map(matches.map((match) => [match.g2, match.zen]));
    const crops: LostCrop[] = [];
    const unmatched: string[] = [];
    for (const thumbnail of derivatives.filter((derivative) => derivative.type === THUMBNAIL)) {
        const photo = tree.byId.get(thumbnail.parent);
        const crop = cropOf(thumbnail.operations);
        if (photo?.type !== 'GalleryPhotoItem' || crop === null) {
            continue;
        }
        const from = tree.pathOf(photo);
        const zen = zenOf.get(from);
        if (zen === undefined) {
            unmatched.push(from);
            continue;
        }
        const width = photo.width ?? 0;
        const height = photo.height ?? 0;
        const turned = quarterTurned(derivativeById.get(thumbnail.source));
        crops.push({
            from,
            path: mediaPath(`/${dirOf(zen)}/`, sanitizeMediaName(nameOf(zen))),
            crop,
            shape: turned ? { width: height, height: width } : { width, height },
        });
    }
    return { crops, unmatched };
}

/** A media item of the album as the gallery lists it today, as far as writing its crop reads it. */
export interface ListedMedia {
    width: number | null;
    height: number | null;
    crop: Rectangle | null;
}

/**
 * What writing the crop does to the photo the gallery lists today: `write` it, or leave it because it is `done`
 * already, the photo is `missing`, culled or renamed since, is `cropped` otherwise, by an admin in a later gallery
 * whose choice stands, or is `reshaped`, a file of another shape than Gallery 2's, which the crop would not line up
 * with.
 */
export function cropOutcome(
    lost: LostCrop,
    today: ListedMedia | undefined,
): 'write' | 'done' | 'missing' | 'cropped' | 'reshaped' {
    if (today === undefined) {
        return 'missing';
    }
    const { width, height, crop } = today;
    if (crop !== null) {
        return width !== null && height !== null && sameRectangle(crop, inPixels(lost.crop, width, height))
            ? 'done'
            : 'cropped';
    }
    if (width === null || height === null || lost.shape.width === 0 || lost.shape.height === 0) {
        return 'reshaped';
    }
    const ratio = width / height / (lost.shape.width / lost.shape.height);
    return Math.abs(ratio - 1) <= SAME_SHAPE ? 'write' : 'reshaped';
}

/** The crop in pixels of an image `width` by `height`, each edge rounded on its own, as the Worker stores it. */
function inPixels(crop: CropPercent, width: number, height: number): Rectangle {
    const left = Math.round((width * crop.x) / 100);
    const top = Math.round((height * crop.y) / 100);
    return {
        x: left,
        y: top,
        width: Math.round((width * (crop.x + crop.width)) / 100) - left,
        height: Math.round((height * (crop.y + crop.height)) / 100) - top,
    };
}

/** Whether two rectangles are the same to within the pixel rounding can move an edge by. */
function sameRectangle(first: Rectangle, second: Rectangle): boolean {
    return (['x', 'y', 'width', 'height'] as const).every((side) => Math.abs(first[side] - second[side]) <= 1);
}

/**
 * The crop a thumbnail's operations begin with, or null for one made from the whole photo. Gallery 2 wrote each
 * figure to a thousandth, so a crop reaching the far edge can run a thousandth past it, and is moved back inside.
 */
function cropOf(operations: string | null): CropPercent | null {
    const [first = ''] = (operations ?? '').split(';', 1);
    const figures = /^crop\|(?<figures>[\d.]+,[\d.]+,[\d.]+,[\d.]+)$/v.exec(first)?.groups?.['figures'];
    if (figures === undefined) {
        return null;
    }
    const [left = 0, top = 0, width = 0, height = 0] = figures.split(',').map(Number);
    const across = inside(left, width);
    const down = inside(top, height);
    return { x: across.start, y: down.start, width: across.length, height: down.length };
}

/** A span of percent moved back so it ends by 100, by as much more as the sum's own rounding needs. */
function inside(start: number, length: number): { start: number; length: number } {
    const fitted = Math.min(length, 100);
    const overshoot = start + fitted - 100;
    return { start: overshoot > 0 ? Math.max(0, start - overshoot - 1e-9) : start, length: fitted };
}

/** Whether the derivative is a version of the photo turned a quarter, which swaps its width and height. */
function quarterTurned(derivative: Gallery2Derivative | undefined): boolean {
    return (
        derivative?.type === PREFERRED &&
        (derivative.operations ?? '').split(';').some((operation) => /^rotate\|-?(?:90|270)$/v.test(operation))
    );
}

function dirOf(path: string): string {
    return path.slice(0, path.lastIndexOf('/'));
}

function nameOf(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1);
}
