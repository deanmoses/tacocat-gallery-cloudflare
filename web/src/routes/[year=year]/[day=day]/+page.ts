import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { albumPath, isDayAlbumPath } from '@tacocat-gallery/shared';
import { albumLoadMachine } from '$lib/stores/AlbumLoadMachine.svelte';

export const load: PageLoad = ({ params }) => {
    const yearPath = albumPath('/', params.year);
    const dayPath = albumPath(yearPath, params.day);
    // The route matches the shape of a day; whether the calendar has it is judged here.
    if (!isDayAlbumPath(dayPath)) error(404, `No such day: [${dayPath}]`);
    albumLoadMachine.fetch(dayPath);
    albumLoadMachine.fetch(yearPath); // the page's prev/next come from its child list
    return { albumPath: dayPath };
};
