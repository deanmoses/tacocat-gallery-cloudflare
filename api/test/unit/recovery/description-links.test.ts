import { describe, expect, it } from 'vitest';
import { type Relink, parseRelinks, relinked } from '../../../scripts/recovery/description-links.ts';

function point(from: string, to: string): Relink {
    return { id: 'H1', source: '/2015/01-26/fenetre', from, kind: 'point', to };
}

function unlink(from: string): Relink {
    return { id: 'H2', source: '/2002/10-26/', from, kind: 'unlink' };
}

describe(parseRelinks, () => {
    it('reads each kind of pick the contact sheet copies out', () => {
        const text = [
            'H1  a  /2015/01-22  /2015/01-26/fenetre  https://tacocat.com/p/#2015/01-22',
            'H68  unlink  /2002/10-26  ../index.htm',
            '',
            'I1  abs  https://tacocat.com/img/2012/10/matrix-cover.jpg  /2012/10-29/matrix1  /img/2012/10/matrix-cover.jpg',
        ].join('\n');

        expect(parseRelinks(text)).toStrictEqual([
            {
                id: 'H1',
                source: '/2015/01-26/fenetre',
                from: 'https://tacocat.com/p/#2015/01-22',
                kind: 'point',
                to: '/2015/01-22',
            },
            { id: 'H68', source: '/2002/10-26/', from: '../index.htm', kind: 'unlink' },
            {
                id: 'I1',
                source: '/2012/10-29/matrix1',
                from: '/img/2012/10/matrix-cover.jpg',
                kind: 'point',
                to: 'https://tacocat.com/img/2012/10/matrix-cover.jpg',
            },
        ]);
    });

    it('gives a year album its trailing slash', () => {
        expect(parseRelinks('I11  unlink  /2001  https://tacocat.com/pix/img/kitten.gif')[0]?.source).toBe('/2001/');
    });

    it.each([
        ['an unknown kind', 'H1  leave  /2002/10-26  ../index.htm', 'a pick is a, abs or unlink'],
        ['a missing address', 'H1  a  /2015/01-22  /2015/01-26/fenetre', 'a pick to point a link takes'],
        ['an extra field', 'H68  unlink  /2002/10-26  ../index.htm  extra', 'a pick to unlink takes'],
        [
            'a source that is no gallery path',
            'H1  a  /2015/01-22  fenetre  https://tacocat.com/p/#2015/01-22',
            'not an album or photo path',
        ],
    ])('refuses %s', (_, line, reason) => {
        expect(() => parseRelinks(line)).toThrow(reason);
    });
});

describe(relinked, () => {
    it('points an href at the gallery path and leaves the rest of the description alone', () => {
        const description = '<p>See <a href="https://tacocat.com/p/#2015/01-22" title="x">the window</a> again.</p>';

        expect(relinked(description, point('https://tacocat.com/p/#2015/01-22', '/2015/01-22'))).toStrictEqual({
            description: '<p>See <a href="/2015/01-22" title="x">the window</a> again.</p>',
            outcome: 'rewritten',
        });
    });

    it('reads an address however it is quoted, and writes it double-quoted', () => {
        expect(relinked("<a href='yosemite/'>Yosemite</a>", point('yosemite/', '/2009/05-16')).description).toBe(
            '<a href="/2009/05-16">Yosemite</a>',
        );
        expect(relinked('<a href=motrip/>Malaysia</a>', point('motrip/', '/2008/07-04')).description).toBe(
            '<a href="/2008/07-04">Malaysia</a>',
        );
    });

    it('matches an address whose entities the description encodes', () => {
        expect(relinked('<a href="a.html?x=1&amp;y=2">x</a>', point('a.html?x=1&y=2', '/2010/01-01')).description).toBe(
            '<a href="/2010/01-01">x</a>',
        );
    });

    it('points an image’s src', () => {
        const from = '/img/2012/10/matrix-cover.jpg';
        const to = 'https://tacocat.com/img/2012/10/matrix-cover.jpg';

        expect(relinked(`<p><img src="${from}" alt="" /> Cover</p>`, point(from, to)).description).toBe(
            `<p><img src="${to}" alt="" /> Cover</p>`,
        );
    });

    it('points every link holding the address, and no other', () => {
        const description =
            '<a href="/pictures/v/2013/08-22/">one</a> <a href="/2013/08-31">two</a> <a href="/pictures/v/2013/08-22/">three</a>';

        expect(relinked(description, point('/pictures/v/2013/08-22/', '/2013/08-22')).description).toBe(
            '<a href="/2013/08-22">one</a> <a href="/2013/08-31">two</a> <a href="/2013/08-22">three</a>',
        );
    });

    it('leaves an address that only contains the picked one', () => {
        const description = '<a href="/pictures/v/2010/06-30/yosemite1.jpg.html">x</a>';

        expect(relinked(description, point('/pictures/v/2010/06-30/', '/2010/06-30'))).toStrictEqual({
            description,
            outcome: 'absent',
        });
    });

    it('leaves the address where it is only text, not a link', () => {
        const description = '<p>It was at tacocat.com/p/#2015/01-22 once.</p>';

        expect(relinked(description, point('tacocat.com/p/#2015/01-22', '/2015/01-22')).outcome).toBe('absent');
    });

    it('says a link already points where the pick does, so a rerun writes nothing', () => {
        const description = '<a href="/2015/01-22">the window</a>';

        expect(relinked(description, point('https://tacocat.com/p/#2015/01-22', '/2015/01-22'))).toStrictEqual({
            description,
            outcome: 'already',
        });
    });

    it('takes an <a> off and keeps what it holds', () => {
        const description =
            '<p>A <strong>Halloween party</strong> was a success!<a href="../index.htm"></a> And <a href="../index.htm">back</a>.</p>';

        expect(relinked(description, unlink('../index.htm')).description).toBe(
            '<p>A <strong>Halloween party</strong> was a success! And back.</p>',
        );
    });

    it('takes an image out', () => {
        expect(relinked('<p><img src="kitten.gif" /> Meow</p>', unlink('kitten.gif')).description).toBe('<p> Meow</p>');
    });
});
