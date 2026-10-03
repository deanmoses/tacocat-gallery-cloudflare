import { flushSync } from 'svelte';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { render } from '$lib/test-support/render.svelte';
import FullScreenDropZone from './FullScreenDropZone.svelte';

describe(FullScreenDropZone, () => {
    it('covers the window scrolled down a long album, so a drop anywhere in it lands on the zone', () => {
        const longAlbum = document.createElement('div');
        longAlbum.style.height = `${innerHeight * 5}px`;
        document.body.append(longAlbum);
        onTestFinished(() => {
            longAlbum.remove();
            scrollTo(0, 0);
        });
        scrollTo(0, innerHeight * 2);
        render(FullScreenDropZone, { isDropAllowed: () => true, onDrop: vi.fn<() => Promise<void>>() });

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(new File(['x'], 'felix.jpg', { type: 'image/jpeg' }));
        dispatchEvent(new DragEvent('dragenter', { dataTransfer, cancelable: true }));
        flushSync();

        const zone = document.querySelector('p');
        const middle = innerWidth / 2;

        expect(zone).not.toBeNull();
        expect(document.elementFromPoint(middle, 1)).toBe(zone);
        expect(document.elementFromPoint(middle, innerHeight - 1)).toBe(zone);
    });
});
