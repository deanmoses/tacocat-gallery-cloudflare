import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { INVITE_PAGE, LOGIN_PAGE } from '../auth/pages';
import {
    currentAdmin,
    loginOptions,
    loginVerify,
    logout,
    registerOptions,
    registerVerify,
    requestSite,
} from '../auth/passkeys';
import { MEDIA_HEADERS, SITE_HEADERS } from '../http/headers';
import { failure, html, json, notFound } from '../http/responses';
import { backupDatabase } from '../ops/backup';
import { health } from '../ops/health';
import { seed } from '../ops/seed';
import {
    createAlbumRoute,
    deleteAlbumRoute,
    getAlbum,
    renameAlbumRoute,
    setAlbumThumbnail,
    updateAlbumRoute,
} from './albums';
import { deleteMediaRoute, headMedia, recutThumbnailRoute, renameMediaRoute, updateMediaRoute } from './media';
import { debugImage } from './debug';
import { uploadErrors } from './errors';
import { derivedViaCacheApi, derivedViaCdn, raw } from './images';
import { putItem } from './items';
import { search } from './search';
import { uploadUrl } from './upload';
import { media } from './video';

/** The bindings, and the site a passkey request comes from, which the origin check below leaves for its handlers. */
interface App {
    Bindings: Env;
    Variables: { site: URL };
}

/**
 * Every route the Worker answers. A request that matches none gets a 404 with the error body; a handler that throws
 * gets a 500 with the error body and its detail in the log. Hono answers a HEAD by running the GET handler and
 * dropping the body, so a handler that should answer HEAD more cheaply reads the raw request's method.
 */
export function createApp(): Hono<App> {
    const app = new Hono<App>();

    // Every response carries the site's headers, says where it ran and how long the Worker took, and under /api/,
    // which view it served.
    app.use(async (context, next) => {
        const started = performance.now();
        await next();
        for (const [name, value] of Object.entries(SITE_HEADERS)) {
            context.res.headers.set(name, value);
        }
        context.res.headers.set('x-worker-colo', colo(context.req.raw));
        context.res.headers.append('server-timing', `worker;dur=${(performance.now() - started).toFixed(1)}`);
    });
    app.on('GET', ['/i/*', '/i2/*', '/v/*', '/raw/*'], async (context, next) => {
        await next();
        for (const [name, value] of Object.entries(MEDIA_HEADERS)) {
            context.res.headers.set(name, value);
        }
    });
    app.use('/api/*', async (context, next) => {
        await next();
        const admin = await currentAdmin(context.req.raw, context.env);
        context.res.headers.set('x-auth-status', admin === null ? 'guest' : 'admin');
    });
    app.notFound(() => notFound());
    app.onError((error, context) => {
        if (error instanceof HTTPException) {
            return failure(error.status, error.message);
        }
        console.error({ event: 'server_exception', path: context.req.path, error: String(error) });
        return failure(500, 'Server Error');
    });

    // Login and invites, open to anyone. The JSON endpoints behind them take a passkey bound to the site's own origin, so
    // each needs the request to come from it.
    app.get('/login', async () => html(LOGIN_PAGE));
    app.get('/invite/*', async () => html(INVITE_PAGE));
    app.get('/api/auth/status', async (context) => json({ admin: await currentAdmin(context.req.raw, context.env) }));
    app.post('/api/auth/*', async (context, next) => {
        const site = requestSite(context.req.raw, context.env);
        if (site === null) {
            return failure(403, 'origin not allowed');
        }
        context.set('site', site);
        return next();
    });
    app.post('/api/auth/register/options', async (context) =>
        registerOptions(context.req.raw, context.env, context.get('site')),
    );
    app.post('/api/auth/register/verify', async (context) =>
        registerVerify(context.req.raw, context.env, context.get('site')),
    );
    app.post('/api/auth/login/options', async (context) => loginOptions(context.env, context.get('site')));
    app.post('/api/auth/login/verify', async (context) =>
        loginVerify(context.req.raw, context.env, context.get('site')),
    );
    app.post('/api/auth/logout', async () => logout());

    // Reads never refuse: a guest gets the published view. A HEAD arrives at the GET handler with its own method.
    app.get('/api/album/*', async (context) => getAlbum(context.req.raw, context.env));
    app.get('/api/media/*', async (context) => headMedia(context.req.raw, context.env));
    app.get('/api/search/*', async (context) => search(context.req.raw, context.env));
    app.get('/api/health', async (context) => health(context.env));
    app.get('/raw/*', async (context) => raw(context.req.raw, context.env));
    app.get('/v/*', async (context) => media(context.req.raw, context.env));
    app.get('/i/*', async (context) => derivedViaCacheApi(context.req.raw, context.env, context.executionCtx));
    app.get('/i2/*', async (context) => derivedViaCdn(context.req.raw, context.env));
    // What it reports about an object is for whoever can upload one.
    app.get('/debug/image/*', async (context) =>
        (await currentAdmin(context.req.raw, context.env)) === null
            ? failure(401, 'Unauthorized')
            : debugImage(context.req.raw, context.env),
    );

    // Every write needs a logged-in admin. This comes after the login routes, which answer before it would run, and
    // before every route it guards, since Hono runs what matches in the order it was registered.
    app.on(['POST', 'PUT', 'PATCH', 'DELETE'], '/*', async (context, next) =>
        (await currentAdmin(context.req.raw, context.env)) === null ? failure(401, 'Unauthorized') : next(),
    );
    app.put('/api/item', async (context) => putItem(context.req.raw, context.env));
    app.post('/api/seed', async (context) => seed(context.req.raw, context.env));
    app.post('/api/backup', async (context) => json(await backupDatabase(context.env)));
    app.post('/api/upload-url', async (context) => uploadUrl(context.req.raw, context.env));
    app.post('/api/errors', async (context) => uploadErrors(context.req.raw, context.env));
    app.put('/api/album/*', async (context) => createAlbumRoute(context.req.raw, context.env));
    app.patch('/api/album/*', async (context) => updateAlbumRoute(context.req.raw, context.env));
    app.delete('/api/album/*', async (context) => deleteAlbumRoute(context.req.raw, context.env));
    app.post('/api/album-rename/*', async (context) => renameAlbumRoute(context.req.raw, context.env));
    app.patch('/api/album-thumb/*', async (context) => setAlbumThumbnail(context.req.raw, context.env));
    app.patch('/api/media/*', async (context) => updateMediaRoute(context.req.raw, context.env));
    app.delete('/api/media/*', async (context) => deleteMediaRoute(context.req.raw, context.env));
    app.post('/api/media-rename/*', async (context) => renameMediaRoute(context.req.raw, context.env));
    app.patch('/api/thumb/*', async (context) => recutThumbnailRoute(context.req.raw, context.env));
    return app;
}

/** Where the request came in, from what Cloudflare adds to a request at the edge; wrangler dev adds nothing. */
function colo(request: Request): string {
    const { cf } = request;
    return cf !== undefined && 'colo' in cf && typeof cf.colo === 'string' ? cf.colo : 'local';
}
