import { describe, expect, it } from 'vitest';
import {
    type ZenphotoAlbum,
    type ZenphotoImage,
    captionHtml,
    plainText,
    recoveryPlan,
    unserialized,
} from '../../scripts/zenphoto.ts';

const noNames = (): null => null;

function album(fields: Partial<ZenphotoAlbum> & { id: number; folder: string }): ZenphotoAlbum {
    return { show: 1, desc: null, custom_data: null, thumb: null, ...fields };
}

function image(fields: Partial<ZenphotoImage> & { albumid: number; filename: string }): ZenphotoImage {
    return {
        show: 1,
        title: null,
        desc: null,
        width: 3072,
        height: 2304,
        thumbX: null,
        thumbY: null,
        thumbW: null,
        thumbH: null,
        filesize: null,
        tags: null,
        ...fields,
    };
}

describe(unserialized, () => {
    it.each([
        { name: 'a plain value as it is', value: 'Potliquor', text: 'Potliquor' },
        { name: 'the en_US text of an array', value: 'a:1:{s:5:"en_US";s:5:"07-04";}', text: '07-04' },
        // PHP counts bytes: é is two
        { name: 'a length counted in bytes', value: 'a:1:{s:5:"en_US";s:8:"la fève";}', text: 'la fève' },
        {
            name: 'text holding the quote and semicolon that end it',
            value: 'a:1:{s:5:"en_US";s:4:"a";b";}',
            text: 'a";b',
        },
        {
            name: 'en_US among other locales',
            value: 'a:2:{s:5:"fr_FR";s:4:"Chat";s:5:"en_US";s:3:"Cat";}',
            text: 'Cat',
        },
        { name: 'another locale when there is no en_US', value: 'a:1:{s:5:"fr_FR";s:4:"Chat";}', text: 'Chat' },
        { name: 'nothing for an empty array', value: 'a:0:{}', text: '' },
    ])('reads $name', ({ value, text }) => {
        expect(unserialized(value)).toBe(text);
    });

    it('refuses an array it cannot read rather than guess', () => {
        expect(() => unserialized('a:1:{i:0;s:3:"Cat";}')).toThrow(/PHP-serialized/v);
    });
});

describe(plainText, () => {
    it.each([
        { name: 'an escaped apostrophe', value: 'poudre d&apos;amande', text: "poudre d'amande" },
        { name: 'an escaped ampersand', value: 'Beate &amp; Susanna', text: 'Beate & Susanna' },
        { name: 'a serialized value', value: 'a:1:{s:5:"en_US";s:11:"l&apos;oeuf";}', text: "l'oeuf" },
        { name: 'spaces around it', value: ' Big Game ', text: 'Big Game' },
    ])('turns $name into text', ({ value, text }) => {
        expect(plainText(value)).toBe(text);
    });

    it.each([{ value: null }, { value: '' }, { value: ' ' }, { value: 'a:1:{s:5:"en_US";s:0:"";}' }])(
        'is null for [$value], which holds no text',
        ({ value }) => {
            expect(plainText(value)).toBeNull();
        },
    );
});

describe(captionHtml, () => {
    it('turns &apos; and &nbsp; into their characters and leaves the entities HTML needs', () => {
        expect(captionHtml('<p>Milo&apos;s week 5 &amp; 6. &nbsp;1 &lt; 2&nbsp;</p> ', '/2008/12-07/', noNames)).toBe(
            "<p>Milo's week 5 &amp; 6.  1 &lt; 2 </p>",
        );
    });

    it('makes a Zenphoto # link to an album a path', () => {
        expect(captionHtml('<a href="#2008/01-10">king cake</a>', '/2008/01-13/', noNames)).toBe(
            '<a href="/2008/01-10">king cake</a>',
        );
    });

    it("points a link to a photo of its own album at the photo's name here", () => {
        const names = new Map([['a.jpg', '/2008/01-10/a_2']]);

        expect(
            captionHtml('<a href="#2008/01-10/a.jpg">before</a>', '/2008/01-10/', (file) => names.get(file) ?? null),
        ).toBe('<a href="/2008/01-10/a_2">before</a>');
    });

    it("points a link to another album's photo at its sanitized name", () => {
        expect(captionHtml('<a href="#2013/10-27/1-grievous-injury.jpg">last year</a>', '/2014/11-01/', noNames)).toBe(
            '<a href="/2013/10-27/1_grievous_injury">last year</a>',
        );
    });

    it('is null for a description that holds nothing', () => {
        expect(captionHtml('a:1:{s:5:"en_US";s:0:"";}', '/2008/01-10/', noNames)).toBeNull();
        expect(captionHtml(null, '/2008/01-10/', noNames)).toBeNull();
    });
});

describe(recoveryPlan, () => {
    it('recovers an unpublished day album with its words and every photo, under the names the copy gives', () => {
        const plan = recoveryPlan(
            [
                album({
                    id: 1,
                    folder: '2008/01-10',
                    show: 0,
                    desc: '<p>Felix&apos;s class made a king cake.</p>',
                    custom_data: 'Epiphany with Felix&apos;s Class',
                    thumb: 'galette02-recette.jpg',
                }),
            ],
            [
                image({
                    albumid: 1,
                    filename: 'galette02-recette.jpg',
                    title: 'la recette',
                    desc: 'Sarah lit la recette.',
                    filesize: 3_570_313,
                    tags: ['school'],
                }),
                image({ albumid: 1, filename: 'galette01.jpg', thumbX: 38, thumbY: 0, thumbW: 2304, thumbH: 2304 }),
            ],
        );

        expect(plan).toStrictEqual([
            {
                path: '/2008/01-10/',
                draft: true,
                summary: "Epiphany with Felix's Class",
                description: "<p>Felix's class made a king cake.</p>",
                thumbnail: '/2008/01-10/galette02_recette',
                order: null,
                media: [
                    {
                        file: '2008/01-10/galette01.jpg',
                        path: '/2008/01-10/galette01',
                        name: 'galette01',
                        title: null,
                        description: null,
                        crop: { x: 38, y: 0, width: 2304, height: 2304 },
                        size: { width: 3072, height: 2304 },
                        bytes: null,
                        tags: [],
                    },
                    {
                        file: '2008/01-10/galette02-recette.jpg',
                        path: '/2008/01-10/galette02_recette',
                        name: 'galette02_recette',
                        title: 'la recette',
                        description: 'Sarah lit la recette.',
                        crop: null,
                        size: { width: 3072, height: 2304 },
                        bytes: 3_570_313,
                        tags: ['school'],
                    },
                ],
            },
        ]);
    });

    // Zenphoto holds `1` for an album shown by whichever photo comes first
    it.each([{ thumb: '1' }, { thumb: null }])(
        'shows an album whose thumbnail is $thumb by its first photo',
        ({ thumb }) => {
            const [recovered] = recoveryPlan(
                [album({ id: 1, folder: '2008/12-07', show: 0, thumb })],
                [image({ albumid: 1, filename: 'geo01.jpg' }), image({ albumid: 1, filename: 'charlotte.jpg' })],
            );

            expect(recovered?.thumbnail).toBe('/2008/12-07/charlotte');
        },
    );

    // A hyphen sorted before the extension's dot, so `eiffel-tower` came before `eiffel` on AWS
    it('keeps the order AWS showed the names in where the new names sort differently', () => {
        const [recovered] = recoveryPlan(
            [album({ id: 1, folder: '2010/10-10', show: 0 })],
            [image({ albumid: 1, filename: 'eiffel.jpg' }), image({ albumid: 1, filename: 'eiffel-tower.jpg' })],
        );

        expect(recovered?.order).toStrictEqual(['eiffel_tower', 'eiffel']);
        expect(recovered?.thumbnail).toBe('/2010/10-10/eiffel_tower');
    });

    it('recovers only the hidden photo of a published album, named past its published neighbours', () => {
        const plan = recoveryPlan(
            [album({ id: 1, folder: '2015/01-11', desc: '<p>Yearbook photos</p>', thumb: 'a4_laughing.jpg' })],
            [
                image({ albumid: 1, filename: 'a4_laughing.jpg' }),
                image({ albumid: 1, filename: 'a4-laughing.jpg', show: 0, title: 'Laughing' }),
            ],
        );

        expect(plan).toMatchObject([
            {
                path: '/2015/01-11/',
                draft: false,
                summary: null,
                description: null,
                thumbnail: null,
                order: null,
                media: [{ file: '2015/01-11/a4-laughing.jpg', path: '/2015/01-11/a4_laughing_2', title: 'Laughing' }],
            },
        ]);
        expect(plan[0]?.media).toHaveLength(1);
    });

    it('leaves out what the 2023 move took or nobody wants', () => {
        const plan = recoveryPlan(
            [
                album({ id: 1, folder: '2014/11-23' }),
                album({ id: 2, folder: '2014', show: 0 }),
                album({ id: 3, folder: '1993/08-15/test1', show: 0 }),
                album({ id: 4, folder: '2022/11-01/not_for_tacocat/tacos', show: 0 }),
            ],
            [
                image({ albumid: 1, filename: 'belt-test.jpg' }),
                image({ albumid: 3, filename: 'test.jpg' }),
                image({ albumid: 4, filename: 'taco.jpg' }),
                // A row whose album Zenphoto no longer has
                image({ albumid: 99, filename: 'zalva2.jpg', show: 0 }),
            ],
        );

        expect(plan).toStrictEqual([]);
    });

    it('drops a crop cut far off the image', () => {
        const [recovered] = recoveryPlan(
            [album({ id: 1, folder: '2007/01-07', show: 0 })],
            [image({ albumid: 1, filename: 'a.jpg', thumbX: 2000, thumbY: 0, thumbW: 2304, thumbH: 2304 })],
        );

        expect(recovered?.media[0]?.crop).toBeNull();
    });
});
