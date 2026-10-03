import { describe, expect, it } from 'vitest';
import { AlbumImpl } from './AlbumImpl';
import { albumRecord, imageRecord } from '$lib/test-support/records';
import { albumTitle } from '$lib/utils/date-utils';

describe(AlbumImpl, () => {
    it.each([
        { kind: 'root', path: '/', parentPath: '', title: '', parentTitle: '' },
        { kind: 'year', path: '/2001/', parentPath: '/', title: '2001', parentTitle: '' },
        {
            kind: 'day',
            path: '/2001/12-31/',
            parentPath: '/2001/',
            title: albumTitle('/2001/12-31/'),
            parentTitle: '2001',
        },
    ])('titles a $kind album and its parent', ({ path, parentPath, title, parentTitle }) => {
        const album = new AlbumImpl(albumRecord({ path, parentPath }));

        expect(album.title).toBe(title);
        expect(album.parentTitle).toBe(parentTitle);
    });

    it('refuses a path that is not an album', () => {
        const media = imageRecord();

        expect(() => new AlbumImpl(albumRecord({ path: media.path, parentPath: media.parentPath }))).toThrow(
            `Invalid album path [${media.path}]`,
        );
    });
});
