import { describe, expect, it, vi } from 'vitest';
import { load } from './+page';
import { albumLoadMachine } from '$lib/stores/AlbumLoadMachine.svelte';

type LoadEvent = Parameters<typeof load>[0];

describe('media page load', () => {
    it('fetches the album the media is in, without refetching one already loaded', () => {
        const fetch = vi.spyOn(albumLoadMachine, 'fetch').mockReturnValue(undefined);

        const data = load({ params: { year: '2001', day: '12-31', media: 'felix' } } as LoadEvent);

        expect(data).toStrictEqual({ albumPath: '/2001/12-31/', mediaPath: '/2001/12-31/felix' });
        expect(fetch.mock.calls).toStrictEqual([['/2001/12-31/', false]]);
    });

    it('is not found for a day the calendar does not have', () => {
        const fetch = vi.spyOn(albumLoadMachine, 'fetch').mockReturnValue(undefined);

        expect(() => {
            void load({ params: { year: '2001', day: '02-30', media: 'felix' } } as LoadEvent);
        }).toThrow(expect.objectContaining({ status: 404 }));
        expect(fetch).not.toHaveBeenCalled();
    });

    // Media URLs carried the file's extension until 2026, and were shared by email and text
    it.each([
        { media: 'felix.jpg', location: '/2001/12-31/felix' },
        { media: 'IMG_0001.HEIC', location: '/2001/12-31/img_0001' },
        { media: 'My Photo.JPG', location: '/2001/12-31/my_photo' },
    ])('sends the old URL of $media on to the name without its extension', ({ media, location }) => {
        const fetch = vi.spyOn(albumLoadMachine, 'fetch').mockReturnValue(undefined);

        expect(() => {
            void load({ params: { year: '2001', day: '12-31', media } } as LoadEvent);
        }).toThrow(expect.objectContaining({ status: 301, location }));
        expect(fetch).not.toHaveBeenCalled();
    });
});
