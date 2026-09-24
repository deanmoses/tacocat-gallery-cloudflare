import { currentAdmin, purgeSpentChallenges, routeAuth } from './auth/passkeys';
import { orm } from './db';
import { purgeUploadErrors } from './gallery/errors';
import { type R2EventMessage, processUploadEvent } from './gallery/upload';
import { json, notFound } from './http/responses';
import { backupDatabase } from './ops/backup';
import { startBrowserRuns } from './ops/browser-runs';
import { health } from './ops/health';
import { probeIdleLatency } from './ops/probes';
import { readYourWrites } from './ops/ryw';
import { seed } from './ops/seed';
import { getAlbum, setAlbumThumbnail } from './routes/albums';
import { debugImage } from './routes/debug';
import { uploadErrors } from './routes/errors';
import { derivedViaCacheApi, derivedViaCdn, raw } from './routes/images';
import { putItem } from './routes/items';
import { search } from './routes/search';
import { upload, uploadUrl } from './routes/upload';
import { media } from './routes/video';
import { inSequence } from './util/sequence';

export { Transcoder } from './media/transcoder';

const BACKUP_CRON = '17 9 * * *';
const BROWSER_COLD_CRON = '23 5,11,19,22 * * *';
const BROWSER_WARM_CRON = '38 5,11,19,22 * * *';

export default {
    async fetch(request, env, ctx): Promise<Response> {
        const started = performance.now();
        const { pathname } = new URL(request.url);
        let response: Response;
        try {
            response = await route(request, env, ctx);
        } catch (error) {
            console.error({ event: 'server_exception', path: pathname, error: String(error) });
            response = json({ error: String(error) }, 500);
        }
        response = new Response(response.body, response);
        if (pathname.startsWith('/api/')) {
            const admin = await currentAdmin(request, env);
            response.headers.set('x-auth-status', admin === null ? 'guest' : 'admin');
        }
        response.headers.set('x-worker-colo', request.cf?.colo ?? 'local');
        response.headers.append('server-timing', `worker;dur=${(performance.now() - started).toFixed(1)}`);
        return response;
    },

    async queue(batch, env): Promise<void> {
        // One upload at a time: each holds its whole file in memory.
        await inSequence(batch.messages, async (message) => {
            await processUploadEvent(message.body, env);
            message.ack();
        });
    },

    async scheduled(controller, env): Promise<void> {
        switch (controller.cron) {
            case BACKUP_CRON: {
                await backupDatabase(env);
                await purgeUploadErrors(env);
                await purgeSpentChallenges(orm(env.DB));
                break;
            }
            case BROWSER_COLD_CRON: {
                await startBrowserRuns(env, 'cold');
                break;
            }
            case BROWSER_WARM_CRON: {
                await startBrowserRuns(env, 'warm');
                break;
            }
            default: {
                await probeIdleLatency(env);
            }
        }
    },
} satisfies ExportedHandler<Env, R2EventMessage>;

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const auth = await routeAuth(request, env);
    if (auth) {
        return auth;
    }
    const { method } = request;
    if (method === 'POST' || method === 'PUT') {
        return routeWrite(request, env);
    }
    return method === 'GET' ? routeRead(request, env, ctx) : notFound();
}

/** Every write needs a logged-in admin. */
async function routeWrite(request: Request, env: Env): Promise<Response> {
    if ((await currentAdmin(request, env)) === null) {
        return json({ error: 'admin login required' }, 401);
    }
    const { pathname } = new URL(request.url);
    if (pathname === '/api/item') {
        return putItem(request, env);
    }
    if (pathname === '/api/seed') {
        return seed(request, env);
    }
    if (pathname === '/api/backup') {
        return json(await backupDatabase(env));
    }
    if (pathname === '/api/upload-url') {
        return uploadUrl(request, env);
    }
    if (pathname === '/api/errors') {
        return uploadErrors(request, env);
    }
    if (pathname.startsWith('/api/album/') && pathname.endsWith('/thumbnail')) {
        return setAlbumThumbnail(request, env);
    }
    return pathname.startsWith('/upload/') ? upload(request, env) : notFound();
}

async function routeRead(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/album/')) {
        return getAlbum(request, env);
    }
    if (pathname === '/api/ryw') {
        return readYourWrites(env);
    }
    if (pathname === '/api/health') {
        return health(env);
    }
    if (pathname === '/api/search') {
        return search(request, env);
    }
    if (pathname.startsWith('/raw/')) {
        return raw(request, env);
    }
    if (pathname.startsWith('/v/')) {
        return media(request, env);
    }
    if (pathname.startsWith('/debug/image/')) {
        return debugImage(request, env);
    }
    if (pathname.startsWith('/i/')) {
        return derivedViaCacheApi(request, env, ctx);
    }
    return pathname.startsWith('/i2/') ? derivedViaCdn(request, env) : notFound();
}
