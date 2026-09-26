import { describe, expect, it } from 'vitest';
import { type Query, ftsQuery } from '../../src/gallery/query';

/** A query as one line: each match with its index, AND, OR and NOT between, parentheses around what is not a match. */
function show(query: Query): string {
    if ('match' in query) return `${query.index === 'exact' ? 'exact' : 'stem'}:${query.match}`;
    return 'any' in query
        ? query.any.map(part).join(' OR ')
        : [query.all.map(part).join(' AND '), ...query.not.map((not) => `NOT ${part(not)}`)].join(' ');
}

function part(query: Query): string {
    return 'match' in query ? show(query) : `(${show(query)})`;
}

function compiled(terms: string): string {
    const result = ftsQuery(terms);
    return 'error' in result ? `error: ${result.error}` : show(result.query);
}

describe(ftsQuery, () => {
    it.each([
        { terms: 'felix', query: 'stem:"felix"' },
        { terms: '  felix   beach ', query: 'stem:("felix") AND ("beach")' },
        { terms: 'Felix BEACH', query: 'stem:("Felix") AND ("BEACH")' },
        { terms: '"felix beach"', query: 'stem:"felix beach"' },
        { terms: '“felix beach”', query: 'stem:"felix beach"' },
        { terms: 'fel*', query: 'exact:"fel"*' },
        { terms: 'felix -beach', query: 'stem:("felix") NOT (("beach"))' },
        { terms: 'felix -beach -milo', query: 'stem:("felix") NOT (("beach") OR ("milo"))' },
        { terms: 'felix|milo', query: 'stem:("felix") OR ("milo")' },
        { terms: 'felix beach | milo', query: 'stem:(("felix") AND ("beach")) OR ("milo")' },
        { terms: '(felix | milo) beach', query: 'stem:(("felix") OR ("milo")) AND ("beach")' },
        { terms: 'milo -(felix beach)', query: 'stem:("milo") NOT ((("felix") AND ("beach")))' },
        { terms: 'milo -(felix | beach)', query: 'stem:("milo") NOT ((("felix") OR ("beach")))' },
        { terms: 'felix (-milo)', query: 'stem:("felix") NOT (("milo"))' },
        { terms: 'felix (beach -milo)', query: 'stem:(("felix") AND ("beach")) NOT (("milo"))' },
        { terms: '@title:felix', query: 'stem:title:"felix"' },
        { terms: '@Title:felix', query: 'stem:title:"felix"' },
        { terms: '@title|tags:(felix beach)', query: 'stem:({title tags}:"felix") AND ({title tags}:"beach")' },
        { terms: '@title:(felix @tags:beach)', query: 'stem:(title:"felix") AND (tags:"beach")' },
        { terms: '@title:"felix beach"', query: 'stem:title:"felix beach"' },
        { terms: '@name:pat*', query: 'exact:name:"pat"*' },
        { terms: 'milo @title:-felix', query: 'stem:("milo") NOT ((title:"felix"))' },
        { terms: 'felix @tags:(-beach)', query: 'stem:("felix") NOT ((tags:"beach"))' },
        { terms: 'felix vac*', query: 'stem:"felix" AND exact:"vac"*' },
        { terms: 'felix -vac*', query: 'stem:"felix" NOT exact:"vac"*' },
        { terms: 'felix | vac*', query: 'stem:"felix" OR exact:"vac"*' },
        {
            terms: 'felix beach vac* -mil* -milo',
            query: 'stem:(("felix") AND ("beach")) NOT (("milo")) AND exact:("vac"*) NOT (("mil"*))',
        },
        { terms: '(felix | vac*) beach', query: '(stem:"felix" OR exact:"vac"*) AND stem:"beach"' },
    ])('compiles $terms', ({ terms, query }) => {
        expect(compiled(terms)).toBe(query);
    });

    it.each([
        { terms: 'felix at the beach', query: 'stem:("felix") AND ("beach")' },
        { terms: '"felix at the beach"', query: 'stem:"felix at the beach"' },
        { terms: 'felix -the', query: 'stem:"felix"' },
        { terms: '@title:the felix', query: 'stem:"felix"' },
    ])('drops the stop words from the words of $terms, though not from a phrase', ({ terms, query }) => {
        expect(compiled(terms)).toBe(query);
    });

    it.each([
        { terms: 'pat1', query: 'stem:"pat 1"' },
        { terms: 'pat1*', query: 'exact:"pat 1"*' },
        { terms: '"pat1 beach"', query: 'stem:"pat 1 beach"' },
        { terms: 'img_0715.jpg', query: 'stem:("img") AND ("0715") AND ("jpg")' },
        { terms: 'a1b2', query: 'stem:"a 1 b 2"' },
    ])('parts letters from digits in $terms, as the index does', ({ terms, query }) => {
        expect(compiled(terms)).toBe(query);
    });

    // Whatever is typed, SQLite gets an expression it can read.
    it.each([
        { terms: 'f*', query: 'stem:"f"' },
        { terms: 'felix *', query: 'stem:"felix"' },
        { terms: '(felix', query: 'stem:"felix"' },
        { terms: 'felix)', query: 'stem:"felix"' },
        { terms: ')felix(', query: 'stem:"felix"' },
        { terms: '"felix', query: 'stem:"felix"' },
        { terms: 'felix"', query: 'stem:"felix"' },
        { terms: '"" felix', query: 'stem:"felix"' },
        { terms: '((felix))', query: 'stem:"felix"' },
        { terms: 'felix | | milo', query: 'stem:("felix") OR ("milo")' },
        { terms: '| felix', query: 'stem:"felix"' },
        { terms: 'felix OR milo', query: 'stem:("felix") AND ("milo")' },
        { terms: 'NOT felix', query: 'stem:"felix"' },
        { terms: 'felix AND NOT milo', query: 'stem:("felix") AND ("milo")' },
        { terms: 'felix-beach', query: 'stem:("felix") AND ("beach")' },
        { terms: 'felix - beach', query: 'stem:("felix") AND ("beach")' },
        { terms: "felix's", query: 'stem:("felix") AND ("s")' },
        { terms: 'felix: beach; milo!', query: 'stem:("felix") AND ("beach") AND ("milo")' },
        { terms: '@title felix', query: 'stem:("title") AND ("felix")' },
        { terms: '@title: felix', query: 'stem:title:"felix"' },
        { terms: '@title|:felix', query: 'stem:("title") OR ("felix")' },
        { terms: 'title:felix', query: 'stem:("title") AND ("felix")' },
        { terms: 'title:-felix', query: 'stem:("title") AND ("felix")' },
        { terms: '^felix ~milo %beach%', query: 'stem:("felix") AND ("milo") AND ("beach")' },
        { terms: 'café', query: 'stem:"café"' },
        { terms: `${'('.repeat(8)}felix${')'.repeat(8)}`, query: 'stem:"felix"' },
        { terms: Array.from({ length: 32 }, (_, index) => `w${index}`).join(' '), query: expect.any(String) },
    ])('reads $terms as words and syntax it knows, never as an error', ({ terms, query }) => {
        expect(compiled(terms)).toStrictEqual(query);
    });

    it.each(['', ' '.repeat(3), 'the', 'a of the', '()', '""', '*', '-', '|', 'AND', '@title:'])(
        'refuses %j, which asks for nothing',
        (terms) => {
            expect(compiled(terms)).toBe('error: No search terms supplied');
        },
    );

    it.each(['-felix', '-felix -milo', 'the -felix', '-(felix milo)', 'felix | -milo', '@title:-felix', '-(-felix)'])(
        'refuses %s, which only leaves things out',
        (terms) => {
            expect(compiled(terms)).toBe('error: A search needs a word to look for, not only words to leave out');
        },
    );

    it('refuses a field it does not have, naming the ones it does', () => {
        expect(compiled('@caption:felix')).toBe(
            'error: No search field named [caption]; the fields are name, title, description, tags, summary',
        );
    });

    // SQLite's parsers have a depth, and D1 a number of parameters, that a long enough search would run past.
    it('counts only the words and phrases that reach the query toward the limit', () => {
        expect(
            compiled(`${Array.from({ length: 32 }, (_, index) => `w${index}`).join(' ')} the and "" of`),
        ).toStrictEqual(expect.stringMatching(/^stem:/v));
    });

    it('refuses more words than the statements can carry', () => {
        expect(compiled(Array.from({ length: 33 }, (_, index) => `w${index}`).join(' '))).toBe(
            'error: A search can have at most 32 words and phrases',
        );
    });

    it('refuses parentheses nested deeper than the statements can carry', () => {
        expect(compiled(`${'('.repeat(9)}felix${')'.repeat(9)}`)).toBe(
            'error: A search can nest parentheses at most 8 deep',
        );
    });
});
