import type { SearchResponse } from 'tacocat-gallery-shared';
import { currentAdmin } from '../auth/passkeys';
import { orm } from '../db';
import { d1Header } from '../db/timing';
import { searchItems } from '../gallery/search';
import { json } from '../http/responses';

export async function search(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const query = url.searchParams.get('q') ?? '';
    const admin = (await currentAdmin(request, env)) !== null;
    const session = env.DB.withSession('first-unconstrained');
    const started = performance.now();
    const found = await searchItems(orm(session), query, admin);
    const searchMs = performance.now() - started;
    const body: SearchResponse = { q: query, count: found.results.length, results: found.results };
    return json(body, 200, { 'x-d1': d1Header(found.meta, searchMs) });
}
