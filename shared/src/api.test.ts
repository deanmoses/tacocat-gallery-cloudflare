import { describe, expect, it } from 'vitest';
import { API, apiUrl } from './api.ts';

describe(apiUrl, () => {
    it('is the path of an endpoint at one path', () => {
        expect(apiUrl(API.authStatus)).toBe('/api/auth/status');
    });

    it('goes on with the gallery path an endpoint takes', () => {
        expect(apiUrl(API.readAlbum, '/')).toBe('/api/album/');
        expect(apiUrl(API.renameMedia, '/2001/12-31/felix.jpg')).toBe('/api/media-rename/2001/12-31/felix.jpg');
    });
});
