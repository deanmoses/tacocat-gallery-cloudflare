import type { SearchResponse } from 'tacocat-gallery-shared';
import * as valibot from 'valibot';
import { currentAdmin } from '../auth/passkeys';
import { orm } from '../db';
import { d1Header } from '../db/timing';
import { ftsQuery } from '../gallery/query';
import { type SearchQuery, searchItems } from '../gallery/search';
import { pathAfter } from '../http/paths';
import { failure, json } from '../http/responses';

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

const YEAR = valibot.pipe(
    valibot.string(),
    valibot.regex(/^\d{4}$/v, 'is a four-digit year'),
    valibot.transform(Number),
);
const COUNT = valibot.pipe(valibot.string(), valibot.regex(/^\d+$/v, 'is a whole number'), valibot.transform(Number));

// The query string as the web app writes it.
const PARAMS = valibot.object({
    oldest: valibot.optional(YEAR),
    newest: valibot.optional(YEAR),
    oldestFirst: valibot.optional(valibot.picklist(['true', 'false'])),
    startAt: valibot.optional(COUNT),
    pageSize: valibot.optional(valibot.pipe(COUNT, valibot.minValue(1), valibot.maxValue(MAX_PAGE_SIZE))),
});

/**
 * `GET /api/search/<terms>?oldest=&newest=&oldestFirst=&startAt=&pageSize=`, the terms percent-encoded and in the
 * syntax `ftsQuery` reads.
 */
export async function search(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const compiled = ftsQuery(pathAfter(url, '/api/search/'));
    if ('error' in compiled) {
        return failure(400, compiled.error);
    }
    const params = valibot.safeParse(PARAMS, Object.fromEntries(url.searchParams));
    if (!params.success) {
        return failure(400, valibot.summarize(params.issues));
    }
    const query: SearchQuery = {
        query: compiled.query,
        ...(params.output.oldest !== undefined && { oldestYear: params.output.oldest }),
        ...(params.output.newest !== undefined && { newestYear: params.output.newest }),
        oldestFirst: params.output.oldestFirst === 'true',
        startAt: params.output.startAt ?? 0,
        pageSize: params.output.pageSize ?? DEFAULT_PAGE_SIZE,
    };
    const admin = (await currentAdmin(request, env)) !== null;
    const started = performance.now();
    const found = await searchItems(orm(env.DB.withSession('first-unconstrained')), query, admin);
    const body: SearchResponse = { total: found.total, items: found.items };
    const [counted, page] = found.meta;
    const meta = page ?? counted;
    return json(body, 200, {
        ...(meta !== undefined && {
            'x-d1': d1Header(meta, performance.now() - started, (counted?.rows_read ?? 0) + (page?.rows_read ?? 0)),
        }),
    });
}
