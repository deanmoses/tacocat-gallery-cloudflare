import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import {
    albumKey,
    dayAlbumPathSql,
    dayNameSql,
    extensionOf,
    isAlbumPath,
    isDayAlbumPath,
    isDayName,
    isMediaName,
    isMediaPath,
    isVersionId,
    isYearName,
    mediaKey,
    mediaNameSql,
    mediaPathSql,
    versionIdSql,
    yearAlbumPathSql,
    yearNameSql,
} from 'tacocat-gallery-shared';

// The check constraints are the SQL forms of the rules in shared/, written by hand since a GLOB cannot be made from a
// regex. Each pair is held to the same answer on the same inputs, so a rule that changes in one place and not the
// other fails here rather than in a write the database refuses and the code allowed, or the reverse.

/** Whether `expression`, applied to a column holding `value`, is true in SQLite, as a check constraint would ask. */
async function sqlAdmits(expression: (column: string) => string, value: string): Promise<boolean> {
    const row = await env.DB.prepare(`SELECT (${expression('value')}) AS ok FROM (SELECT ? AS value)`)
        .bind(value)
        .first<{ ok: number | null }>();
    return row?.ok === 1;
}

/** Each rule's SQL form and the code it must agree with. */
const RULES: { name: string; sql: (column: string) => string; code: (value: string) => boolean }[] = [
    { name: 'year name', sql: yearNameSql, code: isYearName },
    { name: 'day name', sql: dayNameSql, code: isDayName },
    {
        name: 'year album path',
        sql: yearAlbumPathSql,
        code: (value) => isAlbumPath(value) && albumKey(value)?.parentPath === '/',
    },
    { name: 'day album path', sql: dayAlbumPathSql, code: isDayAlbumPath },
    // The constraint refuses `.jpeg` as the stored-name rule does, and leaves the extension list to the code.
    { name: 'media name', sql: mediaNameSql, code: (value) => isMediaName(value) && extensionOf(value) !== 'jpeg' },
    {
        name: 'media path',
        sql: mediaPathSql,
        code: (value) => isMediaPath(value) && extensionOf(mediaKey(value)?.itemName ?? '') !== 'jpeg',
    },
    { name: 'version id', sql: versionIdSql, code: isVersionId },
];

// Every input is run through every rule, so each rule is tried on what the others accept as well as its own edge cases.
const INPUTS = [
    '',
    ' ',
    '/',
    '2001',
    '20011',
    '200',
    '200a',
    '06-15',
    '13-45',
    '6-15',
    '06-15/',
    '/2001',
    '/2001/',
    '/2001//',
    '/2001/06-15',
    '/2001/06-15/',
    '/2001/06-15/felix.jpg',
    '/2001/06-15/felix.jpeg',
    '/2001/06-15/Felix.JPG',
    '/2001/06-15/felix',
    '/2001/06-15/felix.tar.gz',
    '/2001/06-15/more/felix.jpg',
    '/2001/06-15/felix.jpg/v1',
    '/2001/felix.jpg',
    '/felix.jpg',
    'felix.jpg',
    'felix.jpeg',
    'felix.JPEG',
    'Felix.JPG',
    'felix',
    'felix.',
    '.jpg',
    'felix.tar.gz',
    'my photo.jpg',
    'a/b.jpg',
    'v1',
    'abc.def_-1',
    '01j8x2y3z4a5b6c7d8e9f0g1h2',
    'a b',
    'a/b',
    'a+b',
    "it's",
];

describe('a rule in SQL and in code', () => {
    it.each(RULES)('$name gives the same answer on every input', async ({ sql, code }) => {
        const disagreements: string[] = [];
        for (const input of INPUTS) {
            const inSql = await sqlAdmits(sql, input);
            if (inSql !== code(input)) {
                disagreements.push(`[${input}]: SQL ${inSql ? 'admits' : 'refuses'}, code does not`);
            }
        }

        expect(disagreements).toStrictEqual([]);
    });

    it.each(RULES)('$name is given inputs it admits and inputs it refuses', ({ code }) => {
        expect(new Set(INPUTS.map(code))).toStrictEqual(new Set([true, false]));
    });
});
