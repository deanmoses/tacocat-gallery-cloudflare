import { describe, expect, it } from 'vitest';
import { albumTiles } from './albumTiles';
import { UploadState } from '$lib/models/album';
import toAlbum from '$lib/models/impl/AlbumCreator';
import { albumRecord, dayAlbum, imageRecord, mediaPath, uploadEntry } from '$lib/test-support/records';
import type { Album } from '$lib/models/GalleryItemInterfaces';

function media(name: string): ReturnType<typeof imageRecord> {
    return imageRecord({ path: mediaPath(name), itemName: name });
}

function upload(name: string): ReturnType<typeof uploadEntry> {
    return uploadEntry({ path: mediaPath(name), status: UploadState.UPLOADING });
}

/** An album in an admin's order, as the server marks one */
function reordered(names: string[]): Album {
    const album = dayAlbum(names.map(media));
    return toAlbum(albumRecord({ ...album.json, order: true }));
}

/** Each tile's name, and whether it is an upload */
function shown(album: Album, uploads: string[]): string[] {
    return albumTiles(album, uploads.map(upload)).map(
        (tile) => `${tile.path.split('/').pop() ?? ''}${tile.kind === 'upload' ? ' (uploading)' : ''}`,
    );
}

describe(albumTiles, () => {
    it.each([
        {
            name: 'puts uploads among the media in name order',
            album: dayAlbum(['b', 'd'].map(media)),
            uploads: ['e', 'a', 'c'],
            tiles: ['a (uploading)', 'b', 'c (uploading)', 'd', 'e (uploading)'],
        },
        {
            name: 'orders names byte by byte, as the server does',
            album: dayAlbum(['a_1', 'img_10'].map(media)),
            uploads: ['img_9', 'a1'],
            tiles: ['a1 (uploading)', 'a_1', 'img_10', 'img_9 (uploading)'],
        },
        {
            name: 'puts uploads after the media of a reordered album, in name order',
            album: reordered(['d', 'b']),
            uploads: ['c', 'a'],
            tiles: ['d', 'b', 'a (uploading)', 'c (uploading)'],
        },
        {
            name: 'shows an upload replacing an item in its place',
            album: dayAlbum(['a', 'b', 'c'].map(media)),
            uploads: ['b'],
            tiles: ['a', 'b (uploading)', 'c'],
        },
        {
            name: 'shows an upload replacing an item of a reordered album in its place',
            album: reordered(['c', 'b', 'a']),
            uploads: ['b'],
            tiles: ['c', 'b (uploading)', 'a'],
        },
        {
            name: 'shows uploads to an empty album',
            album: dayAlbum([]),
            uploads: ['b', 'a'],
            tiles: ['a (uploading)', 'b (uploading)'],
        },
        {
            name: 'shows the media as the server ordered them when nothing is uploading',
            album: reordered(['b', 'a']),
            uploads: [],
            tiles: ['b', 'a'],
        },
    ])('$name', ({ album, uploads, tiles }) => {
        expect(shown(album, uploads)).toStrictEqual(tiles);
    });
});
