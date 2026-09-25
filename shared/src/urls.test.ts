import { describe, expect, it } from 'vitest';
import {
    type ImageRequest,
    detailSize,
    imageUrl,
    originalUrl,
    parseImageRequest,
    parseMediaVersion,
    videoUrl,
} from './urls';

/** Reads a URL as the Worker does: the path after `/i`, and the query. */
function parse(url: string): ImageRequest | null {
    const [pathname = '', search = ''] = url.split('?', 2);
    const params = new Map(
        search.split('&').map((pair): [string, string] => {
            const [name = '', value = ''] = pair.split('=', 2);
            return [name, value];
        }),
    );
    return parseImageRequest(pathname.slice('/i'.length), { get: (name) => params.get(name) ?? null });
}

describe(imageUrl, () => {
    it.each<{ name: string; request: ImageRequest; url: string }>([
        {
            name: 'a square thumbnail',
            request: { path: '/2001/06-15/felix.jpg', versionId: 'v1', size: { width: 200, height: 200 }, crop: null },
            url: '/i/2001/06-15/felix.jpg/v1?size=200x200',
        },
        {
            name: 'a cropped thumbnail',
            request: {
                path: '/2001/06-15/felix.jpg',
                versionId: 'v1',
                size: { width: 200, height: 200 },
                crop: { x: 0, y: 20.5, width: 300, height: 300 },
            },
            url: '/i/2001/06-15/felix.jpg/v1?size=200x200&crop=0,20.5,300,300',
        },
        {
            name: 'a width alone',
            request: {
                path: '/2001/06-15/felix.jpg',
                versionId: 'v1',
                size: { width: 1024, height: null },
                crop: null,
            },
            url: '/i/2001/06-15/felix.jpg/v1?size=1024',
        },
        {
            name: 'a height alone',
            request: { path: '/2001/06-15/tall.jpg', versionId: 'v1', size: { width: null, height: 1024 }, crop: null },
            url: '/i/2001/06-15/tall.jpg/v1?size=x1024',
        },
    ])('writes $name so the Worker reads back the same request', ({ request, url }) => {
        expect(imageUrl(request)).toBe(url);
        expect(parse(url)).toStrictEqual(request);
    });
});

describe(parseImageRequest, () => {
    it('reads a missing size as 1024 wide', () => {
        expect(parse('/i/2001/06-15/felix.jpg/v1')?.size).toStrictEqual({ width: 1024, height: null });
    });

    it.each([
        { name: 'an empty size', url: '/i/2001/06-15/felix.jpg/v1?size=' },
        { name: 'a lone x', url: '/i/2001/06-15/felix.jpg/v1?size=x' },
        { name: 'a word for a size', url: '/i/2001/06-15/felix.jpg/v1?size=big' },
        { name: 'a zero side', url: '/i/2001/06-15/felix.jpg/v1?size=0x200' },
        { name: 'a padded side', url: '/i/2001/06-15/felix.jpg/v1?size=0200x200' },
        { name: 'three sides', url: '/i/2001/06-15/felix.jpg/v1?size=1x2x3' },
        { name: 'a crop of three numbers', url: '/i/2001/06-15/felix.jpg/v1?crop=1,2,3' },
        { name: 'a crop with no area', url: '/i/2001/06-15/felix.jpg/v1?crop=1,2,0,3' },
        { name: 'a negative crop', url: '/i/2001/06-15/felix.jpg/v1?crop=-1,2,3,4' },
        { name: 'no version', url: '/i/2001/06-15/felix.jpg/' },
        { name: 'no path', url: '/iv1' },
    ])('refuses $name', ({ url }) => {
        expect(parse(url)).toBeNull();
    });
});

describe(detailSize, () => {
    it.each([
        { name: 'a landscape photo', dimensions: { width: 4032, height: 3024 }, size: { width: 1024, height: null } },
        { name: 'a portrait photo', dimensions: { width: 3024, height: 4032 }, size: { width: null, height: 1024 } },
        { name: 'a square photo', dimensions: { width: 2000, height: 2000 }, size: { width: null, height: 1024 } },
        {
            name: 'a small photo, at its own size',
            dimensions: { width: 300, height: 225 },
            size: { width: 300, height: null },
        },
        {
            name: 'a photo exactly 1024 wide',
            dimensions: { width: 1024, height: 768 },
            size: { width: 1024, height: null },
        },
    ])('sizes $name by its long side', ({ dimensions, size }) => {
        expect(detailSize(dimensions)).toStrictEqual(size);
    });
});

describe(parseMediaVersion, () => {
    it.each([
        { name: 'the original', url: originalUrl('/2001/06-15/felix.jpg', 'v1'), prefix: '/raw' },
        { name: 'the video', url: videoUrl('/2001/06-15/clip.mov', 'v1'), prefix: '/v' },
    ])('reads back what $name URL says', ({ url, prefix }) => {
        expect(url.startsWith(`${prefix}/`)).toBe(true);
        expect(parseMediaVersion(url.slice(prefix.length))).toStrictEqual({
            path: url.includes('felix') ? '/2001/06-15/felix.jpg' : '/2001/06-15/clip.mov',
            versionId: 'v1',
        });
    });

    it('accepts the ids AWS assigned', () => {
        expect(parseMediaVersion('/2001/06-15/felix.jpg/Abc.123_xyz-9')).toStrictEqual({
            path: '/2001/06-15/felix.jpg',
            versionId: 'Abc.123_xyz-9',
        });
    });

    it.each([
        { name: 'no version', rest: '/2001/06-15/felix.jpg/' },
        { name: 'no path', rest: '/v1' },
        { name: 'an album', rest: '/2001/06-15/v1' },
        { name: 'a version with a slash', rest: '/2001/06-15/felix.jpg/a/b' },
        { name: 'a version with a plus', rest: '/2001/06-15/felix.jpg/a+b' },
        { name: 'a key in another part of the bucket', rest: '/backups/d1/2001-06-15.json/v1' },
    ])('refuses $name', ({ rest }) => {
        expect(parseMediaVersion(rest)).toBeNull();
    });
});
