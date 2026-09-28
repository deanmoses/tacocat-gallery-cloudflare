import { type Size, detailSize } from '@tacocat-gallery/shared';

/**
 * The size a media item is shown at on its page: the detail image's long side, and the short side scaled to match, so
 * the page can lay the frame out before the image arrives.
 */
export function detailDimensions({ width, height }: Size): Size {
    const shown = detailSize({ width, height });
    const scale = shown.width === null ? shown.height / height : shown.width / width;
    return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
