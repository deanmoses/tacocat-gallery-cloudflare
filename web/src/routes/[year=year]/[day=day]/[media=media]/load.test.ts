import { describe, expect, it, vi } from 'vitest';
import { load } from './+page';
import { albumLoadMachine } from '$lib/stores/AlbumLoadMachine.svelte';

type LoadEvent = Parameters<typeof load>[0];

describe('media page load', () => {
    it('fetches the album the media is in, without refetching one already loaded', () => {
        const fetch = vi.spyOn(albumLoadMachine, 'fetch').mockReturnValue(undefined);

        const data = load({ params: { year: '2001', day: '12-31', media: 'felix.jpg' } } as LoadEvent);

        expect(data).toStrictEqual({ albumPath: '/2001/12-31/', mediaPath: '/2001/12-31/felix.jpg' });
        expect(fetch.mock.calls).toStrictEqual([['/2001/12-31/', false]]);
    });

    it('is not found for a day the calendar does not have', () => {
        const fetch = vi.spyOn(albumLoadMachine, 'fetch').mockReturnValue(undefined);

        expect(() => {
            void load({ params: { year: '2001', day: '02-30', media: 'felix.jpg' } } as LoadEvent);
        }).toThrow(expect.objectContaining({ status: 404 }));
        expect(fetch).not.toHaveBeenCalled();
    });
});
