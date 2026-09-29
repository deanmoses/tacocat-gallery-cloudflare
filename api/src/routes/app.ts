import { API, AUTH_PREFIX, AUTH_STATUS_HEADER, type Endpoint } from '@tacocat-gallery/shared';
import { type Handler, Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import {
    currentAdmin,
    currentSession,
    inviteStatus,
    loginOptions,
    loginVerify,
    logout,
    registerOptions,
    registerVerify,
    requestSite,
} from '../auth/passkeys';
import { MEDIA_HEADERS, SITE_HEADERS } from '../http/headers';
import { failure, json, notFound } from '../http/responses';
import { health } from '../ops/health';
import {
    createAlbumRoute,
    deleteAlbumRoute,
    getAlbum,
    orderAlbumRoute,
    renameAlbumRoute,
    resetAlbumOrderRoute,
    setAlbumThumbnail,
    updateAlbumRoute,
} from './albums';
import { deleteMediaRoute, headMedia, recutThumbnailRoute, renameMediaRoute, updateMediaRoute } from './media';
import { debugImage } from './debug';
import { uploadErrors } from './errors';
import { derivedViaCacheApi, raw } from './images';
import { putItem } from './items';
import { localUploadRoute } from './upload';
import { presignRoute } from './presigned';
import { search } from './search';
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
    const answer = (endpoint: Endpoint, handler: Handler<App>): void => {
        app.on(endpoint.method, route(endpoint), handler);
    };

    // Every response carries the site's headers, says where it ran and how long the Worker took, and under /api/,
    // which view it served.
    app.use(async (context, next) => {
        const started = performance.now();
        await next();
        for (const [name, value] of Object.entries(SITE_HEADERS)) {
            context.res.headers.set(name, value);
        }
        // Some answers differ for an admin, and a 404 or 401 changes once the album exists or the admin logs in.
        // no-cache rather than no-store, so a browser can still use a response the page preloaded.
        if (!context.res.headers.has('cache-control')) {
            context.res.headers.set('cache-control', 'private, no-cache');
        }
        context.res.headers.set('x-worker-colo', colo(context.req.raw));
        context.res.headers.append('server-timing', `worker;dur=${(performance.now() - started).toFixed(1)}`);
    });
    app.on('GET', ['/i/*', '/v/*', '/raw/*'], async (context, next) => {
        await next();
        for (const [name, value] of Object.entries(MEDIA_HEADERS)) {
            context.res.headers.set(name, value);
        }
    });
    app.use('/api/*', async (context, next) => {
        await next();
        const { status } = await currentSession(context.req.raw, context.env);
        context.res.headers.set(AUTH_STATUS_HEADER, status);
    });
    app.notFound(() => notFound());
    app.onError((error, context) => {
        if (error instanceof HTTPException) {
            return failure(error.status, error.message);
        }
        console.error({
            event: 'server_exception',
            path: context.req.path,
            error: String(error),
            stack: error.stack,
            cause: error.cause instanceof Error ? error.cause.stack : error.cause,
        });
        return failure(500, 'Server Error');
    });

    // Login and invites, open to anyone. The endpoints take a passkey bound to the site's own origin, so each needs the
    // request to come from it.
    answer(API.authStatus, async (context) => json({ admin: await currentAdmin(context.req.raw, context.env) }));
    app.post(`${AUTH_PREFIX}/*`, async (context, next) => {
        const site = requestSite(context.req.raw, context.env);
        if (site === null) {
            return failure(403, 'origin not allowed');
        }
        context.set('site', site);
        return next();
    });
    answer(API.checkInvite, async (context) => inviteStatus(context.req.raw, context.env));
    answer(API.registerOptions, async (context) => registerOptions(context.req.raw, context.env, context.get('site')));
    answer(API.registerVerify, async (context) => registerVerify(context.req.raw, context.env, context.get('site')));
    answer(API.loginOptions, async (context) => loginOptions(context.env, context.get('site')));
    answer(API.loginVerify, async (context) => loginVerify(context.req.raw, context.env, context.get('site')));
    answer(API.logout, async () => logout());

    // Reads never refuse: a guest gets the published view. A HEAD arrives at the GET handler with its own method.
    answer(API.readAlbum, async (context) => getAlbum(context.req.raw, context.env));
    answer(API.mediaExists, async (context) => headMedia(context.req.raw, context.env));
    answer(API.search, async (context) => search(context.req.raw, context.env));
    answer(API.health, async (context) => health(context.env));
    app.get('/raw/*', async (context) => raw(context.req.raw, context.env));
    app.get('/v/*', async (context) => media(context.req.raw, context.env));
    app.get('/i/*', async (context) => derivedViaCacheApi(context.req.raw, context.env, context.executionCtx));
    // What it reports about an object is for whoever can upload one.
    app.get('/debug/image/*', async (context) =>
        (await currentAdmin(context.req.raw, context.env)) === null
            ? failure(401, 'Unauthorized')
            : debugImage(context.req.raw, context.env),
    );

    // Every write needs a logged-in admin, and a browser's write has to come from the site's own pages: a browser
    // names the page in Origin, and a page on another host of the same site, staging say, sends the session cookie
    // whatever the cookie's SameSite says. A request with no Origin is a script's, whose cookie no page could have
    // attached. This comes after the login routes, which answer before it would run, and before every route it
    // guards, since Hono runs what matches in the order it was registered.
    app.on(['POST', 'PUT', 'PATCH', 'DELETE'], '/*', async (context, next) => {
        if (context.req.header('origin') !== undefined && requestSite(context.req.raw, context.env) === null) {
            return failure(403, 'origin not allowed');
        }
        return (await currentAdmin(context.req.raw, context.env)) === null ? failure(401, 'Unauthorized') : next();
    });
    answer(API.putItem, async (context) => putItem(context.req.raw, context.env));
    answer(API.presign, async (context) => presignRoute(context.req.raw, context.env));
    app.put('/upload/:versionId', async (context) =>
        localUploadRoute(context.req.raw, context.env, context.req.param('versionId')),
    );
    answer(API.uploadErrors, async (context) => uploadErrors(context.req.raw, context.env));
    answer(API.createAlbum, async (context) => createAlbumRoute(context.req.raw, context.env));
    answer(API.updateAlbum, async (context) => updateAlbumRoute(context.req.raw, context.env));
    answer(API.deleteAlbum, async (context) => deleteAlbumRoute(context.req.raw, context.env));
    answer(API.renameAlbum, async (context) => renameAlbumRoute(context.req.raw, context.env));
    answer(API.setAlbumThumbnail, async (context) => setAlbumThumbnail(context.req.raw, context.env));
    answer(API.orderAlbum, async (context) => orderAlbumRoute(context.req.raw, context.env));
    answer(API.resetAlbumOrder, async (context) => resetAlbumOrderRoute(context.req.raw, context.env));
    answer(API.updateMedia, async (context) => updateMediaRoute(context.req.raw, context.env));
    answer(API.deleteMedia, async (context) => deleteMediaRoute(context.req.raw, context.env));
    answer(API.renameMedia, async (context) => renameMediaRoute(context.req.raw, context.env));
    answer(API.recutThumbnail, async (context) => recutThumbnailRoute(context.req.raw, context.env));
    return app;
}

/** The endpoint's path as a Hono route: a prefixed endpoint matches whatever goes on after its prefix. */
export function route(endpoint: Endpoint): string {
    return 'path' in endpoint ? endpoint.path : `${endpoint.prefix}/*`;
}

/** Where the request came in, from what Cloudflare adds to a request at the edge; wrangler dev adds nothing. */
function colo(request: Request): string {
    const { cf } = request;
    return cf !== undefined && 'colo' in cf && typeof cf.colo === 'string' ? cf.colo : 'local';
}
