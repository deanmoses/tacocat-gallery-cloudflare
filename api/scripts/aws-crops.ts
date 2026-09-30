// What the copy from AWS does to a thumbnail crop the gallery's rule would refuse. AWS let a crop run past the image:
// its crop tool made squares a few pixels larger than a photo's short side, which its image Lambda trimmed when it
// cut the thumbnail, so those are trimmed here the same way and the thumbnail is the one readers saw. A crop far off
// the image was cut against the wrong size: AWS stored a rotated photo's raw pixel size, ignoring its EXIF
// orientation, until January 2026, and the migration that corrected the sizes left the crops drawn against the old
// ones. Trimming one of those would keep a crop nobody chose, so it is dropped for the default crop.

export interface Rectangle {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** How far past the image, as a share of its shorter side, a crop may run and still be a trimmed version of itself. */
const TRIMMABLE = 0.01;

/** The crop as the copy writes it, trimmed to fit the image, or null for one too far off to be the crop chosen. */
export function copiedCrop(crop: Rectangle, image: { width: number; height: number }): Rectangle | null {
    const overshoot = Math.max(
        -crop.x,
        -crop.y,
        crop.x + crop.width - image.width,
        crop.y + crop.height - image.height,
    );
    if (overshoot <= 0) {
        return crop;
    }
    if (overshoot > TRIMMABLE * Math.min(image.width, image.height)) {
        return null;
    }
    // Shrunk about its centre, keeping its shape, then moved inside.
    const scale = Math.min(1, image.width / crop.width, image.height / crop.height);
    const width = Math.min(image.width, Math.round(crop.width * scale));
    const height = Math.min(image.height, Math.round(crop.height * scale));
    const left = Math.round(crop.x + (crop.width - width) / 2);
    const top = Math.round(crop.y + (crop.height - height) / 2);
    return {
        x: Math.min(Math.max(left, 0), image.width - width),
        y: Math.min(Math.max(top, 0), image.height - height),
        width,
        height,
    };
}
