import { error, redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { albumPath, hrefOf, isMediaName, mediaPath, parsePath, sanitizeMediaName } from 'tacocat-gallery-shared';
import { albumLoadMachine } from '$lib/stores/AlbumLoadMachine.svelte';

export const load: PageLoad = ({ params }) => {
    const dayPath = albumPath(albumPath('/', params.year), params.day);
    const path = mediaPath(dayPath, params.media);
    if (parsePath(path) === null) {
        // Media URLs carried the file's extension until 2026, and were shared: `felix.jpg` is sent on to `felix`. An
        // item the copy from AWS had to suffix `_2` is not found by its old URL, which is accepted.
        const name = sanitizeMediaName(params.media);
        if (!isMediaName(name) || name === params.media) error(404, `No such media: [${path}]`);
        redirect(301, hrefOf(mediaPath(dayPath, name)));
    }
    const refetch = false; // don't refetch the album
    albumLoadMachine.fetch(dayPath, refetch);
    return {
        albumPath: dayPath,
        mediaPath: path,
    };
};
