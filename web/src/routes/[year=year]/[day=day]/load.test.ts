import { describe, expect, it, vi } from 'vitest';
import { load } from './+page';
import { albumLoadMachine } from '$lib/stores/AlbumLoadMachine.svelte';

type LoadEvent = Parameters<typeof load>[0];

describe('day album page load', () => {
    it('fetches the album, and its parent for prev/next', () => {
        const fetch = vi.spyOn(albumLoadMachine, 'fetch').mockReturnValue(undefined);

        const data = load({ params: { year: '2001', day: '12-31' } } as LoadEvent);

        expect(data).toStrictEqual({ albumPath: '/2001/12-31/' });
        expect(fetch.mock.calls).toStrictEqual([['/2001/12-31/'], ['/2001/']]);
    });

    // The route matches the shape of a day; a day the calendar does not have is not found rather than fetched
    it('is not found for a day the calendar does not have', () => {
        const fetch = vi.spyOn(albumLoadMachine, 'fetch').mockReturnValue(undefined);

        expect(() => {
            void load({ params: { year: '2001', day: '02-30' } } as LoadEvent);
        }).toThrow(expect.objectContaining({ status: 404 }));
        expect(fetch).not.toHaveBeenCalled();
    });
});
