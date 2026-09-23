import { currentAdmin, routeAuth } from './auth';
import { debugImage, derivedViaCacheApi, derivedViaCdn, raw } from './images';
import { backupDatabase, getAlbum, putItem, readYourWrites, search, seed } from './items';
import { html, json, notFound } from './http';
import { UPLOAD_TEST_PAGE } from './pages/upload-test';
import { probeIdleLatency } from './probes';
import { inSequence } from './sequence';
import { type R2EventMessage, processUploadEvent, upload, uploadUrl } from './upload';
import { media } from './video';

export { Transcoder } from './video';

const BACKUP_CRON = '17 9 * * *';

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
        response.headers.set('server-timing', `worker;dur=${(performance.now() - started).toFixed(1)}`);
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
        await (controller.cron === BACKUP_CRON ? backupDatabase(env) : probeIdleLatency(env));
    },
} satisfies ExportedHandler<Env, R2EventMessage>;

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const auth = await routeAuth(request, env);
    if (auth) {
        return auth;
    }
    const { pathname } = new URL(request.url);
    const { method } = request;
    if (method === 'POST' || method === 'PUT') {
        return routeWrite(request, env);
    }
    if (pathname === '/') {
        return json({ colo: request.cf?.colo, country: request.cf?.country });
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
    if (pathname === '/api/search') {
        return search(request, env);
    }
    if (pathname === '/upload-test') {
        return html(UPLOAD_TEST_PAGE);
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
