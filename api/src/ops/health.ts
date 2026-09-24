import { json } from '../http/responses';

/**
 * `GET /api/health`: 200 once the database and both buckets answer, with the running version's id and the latest-named
 * migration applied, so a release can tell that its check reached the version it uploaded and that the database the
 * Worker reads has its migrations. Latest by name rather than by when it was applied: staging also gets the migrations
 * of other branches, in whatever order they were pushed, and a name is a timestamp. A binding that fails throws, which
 * the top-level handler turns into a 500.
 */
export async function health(env: Env): Promise<Response> {
    const [migration] = await Promise.all([
        env.DB.prepare('SELECT name FROM d1_migrations ORDER BY name DESC LIMIT 1').first<{ name: string }>(),
        // A key that does not exist: the cheapest read R2 has, since this route is public.
        env.MEDIA.head('health'),
        env.DERIVED.head('health'),
    ]);
    return json({
        version: env.CF_VERSION_METADATA.id,
        tag: env.CF_VERSION_METADATA.tag,
        migration: migration?.name ?? null,
    });
}
