import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { albumPath, isMediaPath, mediaPath } from 'tacocat-gallery-shared';
import { albumLoadMachine } from '$lib/stores/AlbumLoadMachine.svelte';

export const load: PageLoad = ({ params }) => {
    const dayPath = albumPath(albumPath('/', params.year), params.day);
    const path = mediaPath(dayPath, params.media);
    if (!isMediaPath(path)) error(404, `No such media: [${path}]`);
    const refetch = false; // don't refetch the album
    albumLoadMachine.fetch(dayPath, refetch);
    return {
        albumPath: dayPath,
        mediaPath: path,
    };
};
