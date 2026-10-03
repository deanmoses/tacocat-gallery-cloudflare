import { describe, expect, it } from 'vitest';
import { type Gallery2Item, captionHtml, plainText, recoveredAlbum } from '../../../scripts/recovery/gallery2.ts';

function album(fields: Partial<Gallery2Item> & { id: number; parent: number; name: string | null }): Gallery2Item {
    return { type: 'GalleryAlbumItem', title: null, desc: null, order: null, width: null, height: null, ...fields };
}

function photo(fields: Partial<Gallery2Item> & { id: number; parent: number; name: string }): Gallery2Item {
    return { type: 'GalleryPhotoItem', title: null, desc: null, order: null, width: 1024, height: 768, ...fields };
}

const TREE = [
    album({ id: 7, parent: 0, name: null }),
    album({ id: 19, parent: 7, name: '2008' }),
    album({ id: 20, parent: 19, name: '01-21', title: 'Mountaineering' }),
];

describe(plainText, () => {
    it.each([
        { name: 'an escaped apostrophe', value: 'Tatou&#039;s Weekend', text: "Tatou's Weekend" },
        { name: 'an ampersand escaped twice', value: 'Lulu &amp;amp; Juju', text: 'Lulu & Juju' },
        { name: 'line breaks and spaces around it', value: ' Big\r\nGame ', text: 'Big Game' },
    ])('turns $name into text', ({ value, text }) => {
        expect(plainText(value)).toBe(text);
    });

    it.each([{ value: null }, { value: '' }, { value: ' \r\n' }])('is null for [$value]', ({ value }) => {
        expect(plainText(value)).toBeNull();
    });
});

describe(captionHtml, () => {
    it("makes Gallery 2's escaped tags tags, and its line breaks spaces", () => {
        expect(
            captionHtml('Bonjour!\r\n\r\n&lt;div class=&quot;caption&quot;&gt;Photo by Felix&lt;/div&gt; \r\n'),
        ).toBe('Bonjour! <div class="caption">Photo by Felix</div>');
    });

    it('unescapes tags that were escaped twice', () => {
        expect(captionHtml('&amp;lt;p&amp;gt;Hi&amp;lt;/p&amp;gt;')).toBe('<p>Hi</p>');
    });

    // Once the tags are tags, `&amp;` is the HTML's own way to write an ampersand
    it('leaves an entity the HTML needs', () => {
        expect(captionHtml('&lt;p&gt;Tom &amp;amp; Alva&lt;/p&gt;')).toBe('<p>Tom &amp; Alva</p>');
    });

    it('is null for a description that holds nothing', () => {
        expect(captionHtml(' \r\n')).toBeNull();
        expect(captionHtml(null)).toBeNull();
    });
});

describe(recoveredAlbum, () => {
    const lost = { from: '2008/01-21/tatou', to: '/2008/01-22/', files: { 'bikes.jpg': '1bikes.jpg' } };
    const items = [
        ...TREE,
        album({
            id: 30,
            parent: 20,
            name: 'tatou',
            title: 'Tatou&#039;s Weekend',
            desc: 'His turn!\r\n&lt;a href=&quot;../&quot;&gt;Return&lt;/a&gt;',
        }),
        photo({ id: 32, parent: 30, name: 'zzzz.jpg', order: 3000, title: 'Bedtime' }),
        photo({ id: 31, parent: 30, name: 'totland-1.jpg', order: 2000, width: 768, height: 1024 }),
        photo({ id: 33, parent: 30, name: 'bikes.jpg', order: 1000, title: 'Bikes', desc: '&lt;i&gt;Bikes&lt;/i&gt;' }),
        photo({ id: 40, parent: 20, name: 'austin.jpg', order: 1000 }),
    ];

    it("brings a sub-album back as a day album, unpublished, in Gallery 2's order", () => {
        expect(recoveredAlbum(items, lost).album).toStrictEqual({
            path: '/2008/01-22/',
            draft: true,
            summary: "Tatou's Weekend",
            description: 'His turn! <a href="/2008/01-21">Return</a>',
            thumbnail: '/2008/01-22/bikes',
            order: ['bikes', 'totland_1', 'zzzz'],
            media: [
                {
                    file: '2008/01-22/1bikes.jpg',
                    path: '/2008/01-22/bikes',
                    name: 'bikes',
                    title: 'Bikes',
                    description: '<i>Bikes</i>',
                    crop: null,
                    size: { width: 1024, height: 768 },
                    bytes: null,
                    tags: [],
                },
                {
                    file: '2008/01-22/totland-1.jpg',
                    path: '/2008/01-22/totland_1',
                    name: 'totland_1',
                    title: null,
                    description: null,
                    crop: null,
                    size: { width: 768, height: 1024 },
                    bytes: null,
                    tags: [],
                },
                {
                    file: '2008/01-22/zzzz.jpg',
                    path: '/2008/01-22/zzzz',
                    name: 'zzzz',
                    title: 'Bedtime',
                    description: null,
                    crop: null,
                    size: { width: 1024, height: 768 },
                    bytes: null,
                    tags: [],
                },
            ],
        });
    });

    it("says which link in the parent's description pointed at the sub-album", () => {
        expect(recoveredAlbum(items, lost).link).toStrictEqual({
            album: '/2008/01-21/',
            from: 'href="tatou/"',
            to: 'href="/2008/01-22"',
        });
    });

    it('has no link to move for a day album, whose parent is a year', () => {
        const day = [...TREE, photo({ id: 40, parent: 20, name: 'austin.jpg' })];

        expect(recoveredAlbum(day, { from: '2008/01-21', to: '/2008/01-21/', files: {} }).link).toBeNull();
    });

    it('refuses an album Gallery 2 does not have', () => {
        expect(() => recoveredAlbum(TREE, lost)).toThrow(/no album 2008\/01-21\/tatou/v);
    });
});
