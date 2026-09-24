import { json } from './http';

/**
 * `GET /api/health`: 200 once the database and both buckets answer, with the running version's id and the newest
 * migration applied, so a release can tell that its check reached the version it uploaded and that the migration it
 * applied is there. A binding that fails throws, which the top-level handler turns into a 500.
 */
export async function health(env: Env): Promise<Response> {
    const [migration] = await Promise.all([
        env.DB.prepare('SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1').first<{ name: string }>(),
        env.MEDIA.list({ limit: 1 }),
        env.DERIVED.list({ limit: 1 }),
    ]);
    return json({
        version: env.CF_VERSION_METADATA.id,
        tag: env.CF_VERSION_METADATA.tag,
        migration: migration?.name ?? null,
    });
}
