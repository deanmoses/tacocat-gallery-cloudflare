import { describe, expect, it } from 'vitest';
import { isAwsMediaPath, renamedMedia, rewriteLinks, sanitizedPath } from '../../scripts/aws-names.ts';

describe(renamedMedia, () => {
    it('drops the extension and sanitizes, keeping the order it was given', () => {
        expect(renamedMedia([{ itemName: 'IMG_0001.HEIC' }, { itemName: 'Felix at the beach.jpg' }])).toStrictEqual([
            { from: 'IMG_0001.HEIC', to: 'img_0001', collided: false },
            { from: 'Felix at the beach.jpg', to: 'felix_at_the_beach', collided: false },
        ]);
    });

    // A Live Photo's still and clip, or two spellings of one name
    it('gives the earliest written of two that come out the same the name, and the later one _2', () => {
        expect(
            renamedMedia([
                { itemName: 'img_1234.mov', updatedOn: '2024-06-15T12:00:01Z' },
                { itemName: 'img_1234.jpg', updatedOn: '2024-06-15T12:00:00Z' },
                { itemName: 'IMG_1234.JPG' },
            ]),
        ).toStrictEqual([
            { from: 'img_1234.mov', to: 'img_1234_2', collided: true },
            { from: 'img_1234.jpg', to: 'img_1234', collided: false },
            { from: 'IMG_1234.JPG', to: 'img_1234_3', collided: true },
        ]);
    });

    it('steps past a name another item already has', () => {
        expect(renamedMedia([{ itemName: 'a.jpg' }, { itemName: 'a_2.jpg' }, { itemName: 'a.png' }])).toStrictEqual([
            { from: 'a.jpg', to: 'a', collided: false },
            { from: 'a_2.jpg', to: 'a_2', collided: false },
            { from: 'a.png', to: 'a_3', collided: true },
        ]);
    });
});

describe(isAwsMediaPath, () => {
    it.each(['/2016/12-18/dept_state1b.jpg', '/2001/06-15/My Photo.JPG', '/2001/06-15/felix.mov'])(
        'is true of %s',
        (path) => {
            expect(isAwsMediaPath(path)).toBe(true);
        },
    );

    it.each([
        '/2016/12-18/',
        '/2016/12-18',
        '/2016/',
        '/',
        '/2016/12-18/dept_state1b',
        'https://example.com/a.jpg',
        '',
    ])('is false of %s', (path) => {
        expect(isAwsMediaPath(path)).toBe(false);
    });
});

describe(rewriteLinks, () => {
    const resolve = (path: string): string | null =>
        path === '/2016/12-18/dept_state1b.jpg' ? '/2016/12-18/dept_state1b' : null;

    it('points a link at an AWS media path to the new path, and leaves album and outside links alone', () => {
        const html =
            '<ul><li><a href="/2023/01-15">El Salvador</a></li><li><a href="/2016/12-18/dept_state1b.jpg">DC</a></li><li><a href="https://example.com/x.jpg">Elsewhere</a></li></ul>';

        expect(rewriteLinks(html, resolve)).toStrictEqual({
            html: '<ul><li><a href="/2023/01-15">El Salvador</a></li><li><a href="/2016/12-18/dept_state1b">DC</a></li><li><a href="https://example.com/x.jpg">Elsewhere</a></li></ul>',
            links: [{ from: '/2016/12-18/dept_state1b.jpg', to: '/2016/12-18/dept_state1b' }],
        });
    });

    it("drops the gallery's own origin from a link, and reports one it cannot resolve unchanged", () => {
        const html =
            '<a href="https://pix.tacocat.com/2016/12-18/dept_state1b.jpg">DC</a> <a href="/2001/06-15/gone.jpg">gone</a>';

        expect(rewriteLinks(html, resolve)).toStrictEqual({
            html: '<a href="/2016/12-18/dept_state1b">DC</a> <a href="/2001/06-15/gone.jpg">gone</a>',
            links: [
                { from: 'https://pix.tacocat.com/2016/12-18/dept_state1b.jpg', to: '/2016/12-18/dept_state1b' },
                { from: '/2001/06-15/gone.jpg', to: null },
            ],
        });
    });

    it('leaves a link that already names a new path alone', () => {
        expect(rewriteLinks('<a href="/2016/12-18/dept_state1b">DC</a>', resolve).links).toStrictEqual([]);
    });
});

describe(sanitizedPath, () => {
    it('is the path under the name the sanitizer gives, or null when nothing is left of the name', () => {
        expect(sanitizedPath('/2001/06-15/My Photo.JPG')).toBe('/2001/06-15/my_photo');
        expect(sanitizedPath('/2001/06-15/.jpg')).toBeNull();
    });
});
