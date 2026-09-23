import { type Album, type AlbumChild, type MediaChild, albumKey, mediaKey } from 'tacocat-gallery-shared';

const UPDATED_ON = '2001-06-15T12:00:00.000Z';

export function albumChild(path: string, overrides: Partial<AlbumChild> = {}): AlbumChild {
    return {
        itemType: 'album',
        path,
        itemName: albumKey(path)?.itemName ?? '',
        title: null,
        description: null,
        updatedOn: UPDATED_ON,
        published: true,
        thumbnail: null,
        ...overrides,
    };
}

export function mediaChild(path: string, overrides: Partial<MediaChild> = {}): MediaChild {
    return {
        itemType: 'media',
        mediaType: 'image',
        path,
        itemName: mediaKey(path)?.itemName ?? '',
        title: null,
        description: null,
        updatedOn: UPDATED_ON,
        tags: null,
        versionId: 'v1',
        width: 4032,
        height: 3024,
        durationSeconds: null,
        thumbnailCrop: null,
        ...overrides,
    };
}

export function album(path: string, overrides: Partial<Album> = {}): Album {
    return {
        path,
        title: null,
        description: null,
        published: true,
        updatedOn: path === '/' ? null : UPDATED_ON,
        thumbnail: null,
        children: [],
        ...overrides,
    };
}
