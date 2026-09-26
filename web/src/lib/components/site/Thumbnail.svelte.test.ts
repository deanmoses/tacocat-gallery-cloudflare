import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from '$lib/test-support/render.svelte';
import type { Locator } from 'vitest/browser';
import Thumbnail from './Thumbnail.svelte';

/**
 * A play overlay is gated on the thumbnail image having fired `load` for its
 * current source, so that it is never drawn over a broken or not-yet-arrived
 * image. Only a real browser fetches an <img> and fires that event, which is
 * why these run in the browser project.
 */
const LOADABLE_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const BROKEN_IMAGE = 'data:image/gif;base64,not-a-gif';

/** An overlay is absent before the image settles as well as after, so absence only means something once it has. */
async function settles(image: Locator): Promise<void> {
    const img = image.element();
    if (!(img instanceof HTMLImageElement)) {
        throw new TypeError('The locator did not find an <img>');
    }
    await vi.waitFor(() => {
        expect(img.complete).toBe(true);
    });
}

describe(Thumbnail, () => {
    it('offers the same frame at 200 and 400 pixels, so a 2x screen draws it pixel for pixel', async () => {
        render(Thumbnail, {
            thumbnailUrlInfo: {
                imagePath: '/2001/06-15/felix.jpg',
                versionId: 'v1',
                crop: { x: 0, y: 20, width: 300, height: 300 },
            },
        });

        const image = page.getByTestId('thumbnail-image');

        await expect.element(image).toHaveAttribute('src', '/i/2001/06-15/felix.jpg/v1?size=200x200&crop=0,20,300,300');
        await expect
            .element(image)
            .toHaveAttribute(
                'srcset',
                '/i/2001/06-15/felix.jpg/v1?size=200x200&crop=0,20,300,300 1x, /i/2001/06-15/felix.jpg/v1?size=400x400&crop=0,20,300,300 2x',
            );
    });

    it('offers no srcset for a source given directly, such as a file being uploaded', async () => {
        render(Thumbnail, { src: LOADABLE_IMAGE });

        await expect.element(page.getByTestId('thumbnail-image')).not.toHaveAttribute('srcset');
    });

    it('shows a play overlay once a video thumbnail has loaded', async () => {
        render(Thumbnail, { src: LOADABLE_IMAGE, isVideo: true });

        await expect.element(page.getByTestId('play-overlay')).toBeVisible();
    });

    it('leaves the play overlay off a video whose thumbnail fails to load', async () => {
        render(Thumbnail, { src: BROKEN_IMAGE, isVideo: true });

        await settles(page.getByTestId('thumbnail-image'));

        await expect.element(page.getByTestId('play-overlay')).not.toBeInTheDocument();
    });

    /**
     * Rendered as a video first, so the overlay coming up proves the image's
     * `load` handler has run before the flag flips. Rendered as a still from
     * the start, the overlay is absent before the image loads as well as after,
     * and `complete` turns true before the handler runs, so its absence would
     * prove nothing.
     */
    it('takes the play overlay down when the thumbnail stops being a video', async () => {
        const screen = render(Thumbnail, { src: LOADABLE_IMAGE, isVideo: true });

        await expect.element(page.getByTestId('play-overlay')).toBeVisible();

        screen.rerender({ src: LOADABLE_IMAGE, isVideo: false });

        await expect.element(page.getByTestId('play-overlay')).not.toBeInTheDocument();
    });

    /**
     * The replacement is a broken image on purpose. A loadable one would fire
     * `load` again, and the overlay could be back up before the assertion saw
     * it down, so the reset could not be told apart from the reload. Broken, the
     * only thing that can take the overlay down is the reset.
     */
    it('takes the play overlay back down when the thumbnail is replaced', async () => {
        const screen = render(Thumbnail, { src: LOADABLE_IMAGE, isVideo: true });

        await expect.element(page.getByTestId('play-overlay')).toBeVisible();

        screen.rerender({ src: BROKEN_IMAGE, isVideo: true });

        await expect.element(page.getByTestId('play-overlay')).not.toBeInTheDocument();
    });
});
