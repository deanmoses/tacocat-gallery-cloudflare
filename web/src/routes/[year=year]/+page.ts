import type { PageLoad } from './$types';
import { albumPath } from 'tacocat-gallery-shared';
import { albumLoadMachine } from '$lib/stores/AlbumLoadMachine.svelte';

export const load: PageLoad = ({ params }) => {
    const yearPath = albumPath('/', params.year);
    albumLoadMachine.fetch(yearPath);
    albumLoadMachine.fetch('/'); // the page's prev/next come from its child list
    return { albumPath: yearPath };
};
