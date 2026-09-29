import type * as valibot from 'valibot';
import type { inviteSchema, loginVerifySchema, registerVerifySchema, uploadErrorsSchema } from './api-bodies.ts';
import type {
    albumOrderSchema,
    albumThumbnailSchema,
    albumWriteSchema,
    cropPercentSchema,
    itemWriteSchema,
    mediaWriteSchema,
    presignRequestSchema,
    renameSchema,
} from './item.ts';

type Method = 'GET' | 'PUT' | 'POST' | 'PATCH' | 'DELETE';

/** An endpoint at one URL path. `admin` marks one that answers only a logged-in admin. */
interface FixedEndpoint {
    readonly method: Method;
    readonly path: string;
    readonly admin?: true;
}

/** An endpoint whose URL path goes on after `prefix` with a gallery path, or with a slash and search terms. */
interface PrefixedEndpoint {
    readonly method: Method;
    readonly prefix: string;
    readonly admin?: true;
}

export type Endpoint = FixedEndpoint | PrefixedEndpoint;

declare const BODY: unique symbol;

/** The schema of the JSON body an endpoint takes, carried in its type alone, so an entry costs no schema at runtime. */
interface Takes<Schema extends valibot.GenericSchema> {
    readonly method: Method;
    readonly [BODY]?: Schema;
}

/** Marks the endpoint as taking a body `Schema` parses. */
function takes<Schema extends valibot.GenericSchema>() {
    return <E extends Endpoint>(endpoint: E): E & Takes<Schema> => endpoint;
}

/** Where login, passkey creation and logout live, which the Worker admits only from the site's own origin. */
export const AUTH_PREFIX = '/api/auth';

/** Every endpoint of the Worker's API. A GET endpoint answers HEAD too. */
export const API = {
    authStatus: { method: 'GET', path: `${AUTH_PREFIX}/status` },
    checkInvite: takes<typeof inviteSchema>()({ method: 'POST', path: `${AUTH_PREFIX}/invite` }),
    registerOptions: takes<typeof inviteSchema>()({ method: 'POST', path: `${AUTH_PREFIX}/register/options` }),
    registerVerify: takes<typeof registerVerifySchema>()({ method: 'POST', path: `${AUTH_PREFIX}/register/verify` }),
    loginOptions: { method: 'POST', path: `${AUTH_PREFIX}/login/options` },
    loginVerify: takes<typeof loginVerifySchema>()({ method: 'POST', path: `${AUTH_PREFIX}/login/verify` }),
    logout: { method: 'POST', path: `${AUTH_PREFIX}/logout` },

    readAlbum: { method: 'GET', prefix: '/api/album' },
    mediaExists: { method: 'GET', prefix: '/api/media' },
    search: { method: 'GET', prefix: '/api/search' },
    health: { method: 'GET', path: '/api/health' },

    putItem: takes<typeof itemWriteSchema>()({ method: 'PUT', path: '/api/item', admin: true }),
    presign: takes<typeof presignRequestSchema>()({ method: 'POST', prefix: '/api/presigned', admin: true }),
    uploadErrors: takes<typeof uploadErrorsSchema>()({ method: 'POST', path: '/api/errors', admin: true }),
    createAlbum: takes<typeof albumWriteSchema>()({ method: 'PUT', prefix: '/api/album', admin: true }),
    updateAlbum: takes<typeof albumWriteSchema>()({ method: 'PATCH', prefix: '/api/album', admin: true }),
    deleteAlbum: { method: 'DELETE', prefix: '/api/album', admin: true },
    renameAlbum: takes<typeof renameSchema>()({ method: 'POST', prefix: '/api/album-rename', admin: true }),
    setAlbumThumbnail: takes<typeof albumThumbnailSchema>()({
        method: 'PATCH',
        prefix: '/api/album-thumb',
        admin: true,
    }),
    orderAlbum: takes<typeof albumOrderSchema>()({ method: 'PUT', prefix: '/api/album-order', admin: true }),
    resetAlbumOrder: { method: 'DELETE', prefix: '/api/album-order', admin: true },
    updateMedia: takes<typeof mediaWriteSchema>()({ method: 'PATCH', prefix: '/api/media', admin: true }),
    deleteMedia: { method: 'DELETE', prefix: '/api/media', admin: true },
    renameMedia: takes<typeof renameSchema>()({ method: 'POST', prefix: '/api/media-rename', admin: true }),
    recutThumbnail: takes<typeof cropPercentSchema>()({ method: 'PATCH', prefix: '/api/thumb', admin: true }),
} as const satisfies Record<string, Endpoint>;

type Api = typeof API;

type SchemaOf<E> = E extends { readonly [BODY]?: infer Schema extends valibot.GenericSchema } ? Schema : never;

/** Each endpoint that takes a body, with the schema its entry names. */
export type EndpointBodies = {
    [Name in keyof Api as [SchemaOf<Api[Name]>] extends [never] ? never : Name]: SchemaOf<Api[Name]>;
};

type PathArg<E extends Endpoint> = E extends PrefixedEndpoint ? [path: string] : [];

/** What a request to `E` gives after the endpoint: the path it goes on with, then the body it takes. */
export type EndpointArgs<E extends Endpoint> = [
    ...PathArg<E>,
    ...([SchemaOf<E>] extends [never] ? [] : [body: valibot.InferInput<SchemaOf<E>>]),
];

/**
 * The URL of `endpoint`. The API is on the site's own origin, so this is a path: a host would make every call
 * cross-origin, with CORS and credentials to get right, and would bypass the edge cache in front of /api/.
 */
export function apiUrl<E extends Endpoint>(endpoint: E, ...path: PathArg<E>): string {
    return 'path' in endpoint ? endpoint.path : `${endpoint.prefix}${path[0] ?? ''}`;
}
