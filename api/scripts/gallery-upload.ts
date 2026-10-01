// What a script that adds photos to the gallery shares: the writes an admin's browser makes, through the Worker's own
// routes. An album is made with its words, each file is presigned and PUT to R2 as a browser upload is, so the
// pipeline sizes it and makes its derived images, and the wait reads the album until it lists every upload. A write
// the Worker refuses throws with its reason.
//
// The session cookie is signed with the target Worker's SESSION_SECRET, which api/.dev.vars holds for each: as
// SESSION_SECRET for local, and as SESSION_SECRET_STAGING and SESSION_SECRET_PRODUCTION the values `wrangler secret
// put` gave the deployed Workers.
import { setTimeout as sleep } from 'node:timers/promises';
import * as valibot from 'valibot';
import { adminCookie } from './admin-cookie.ts';
import { devVars } from './dev-vars.ts';

export const SITES = {
    local: 'http://localhost:8787',
    staging: 'https://staging-pix.deanmoses.com',
    production: 'https://pix.deanmoses.com',
};

/** A gallery to write to, as the admin whose cookie it is. */
export interface Gallery {
    site: string;
    cookie: string;
}

const PROCESSING_TIMEOUT_MS = 5 * 60_000;
// R2 answers the odd PUT with a 503 that a second try does not see.
const PUT_ATTEMPTS = 3;
const PUT_RETRY_MS = 2000;

const TEXT = valibot.string();
// This Worker's album, as far as the wait for the uploads reads it: an upload is done when the album lists its name
// under the version presign minted for it.
const LISTED = valibot.object({
    children: valibot.optional(valibot.array(valibot.object({ itemName: TEXT, versionId: valibot.optional(TEXT) }))),
});
const PRESIGNED = valibot.record(TEXT, valibot.object({ url: TEXT, versionId: TEXT }));
const ERRORS = valibot.object({ errors: valibot.record(TEXT, TEXT) });

/** The gallery at `target`, written to as `user`, who has to be one of the Worker's users: it records who uploaded. */
export async function galleryAt(target: keyof typeof SITES, user: string): Promise<Gallery> {
    const name = target === 'local' ? 'SESSION_SECRET' : `SESSION_SECRET_${target.toUpperCase()}`;
    const secret = (await devVars())[name] ?? '';
    if (secret === '') {
        throw new Error(`${name} is not set in api/.dev.vars`);
    }
    return { site: SITES[target], cookie: await adminCookie(secret, user) };
}

/** Makes the album with `fields`, and says whether it did: false leaves an album that was already there untouched. */
export async function createAlbum(gallery: Gallery, path: string, fields: Record<string, unknown>): Promise<boolean> {
    const created = await fetch(`${gallery.site}/api/album${path}`, {
        method: 'PUT',
        headers: { cookie: gallery.cookie, 'content-type': 'application/json' },
        body: JSON.stringify(fields),
    });
    await created.body?.cancel();
    if (!created.ok && created.status !== 400) {
        throw new Error(`creating ${path} failed: ${String(created.status)}`);
    }
    return created.ok;
}

/** One admin write, which the Worker answers 204 or with the reason it refused. */
export async function write(gallery: Gallery, method: string, path: string, body: unknown): Promise<void> {
    const response = await fetch(`${gallery.site}${path}`, {
        method,
        headers: { cookie: gallery.cookie, 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        throw new Error(`${method} ${path} failed: ${String(response.status)} ${await response.text()}`);
    }
    await response.body?.cancel();
}

/** The version each media item of the album is listed under, by name, or null when there is no such album. */
export async function listedVersions(gallery: Gallery, albumPath: string): Promise<Map<string, string> | null> {
    const response = await fetch(`${gallery.site}/api/album${albumPath}?consistency=primary`, {
        headers: { cookie: gallery.cookie },
    });
    if (!response.ok) {
        await response.body?.cancel();
        return null;
    }
    const listed = valibot.parse(LISTED, await response.json());
    return new Map((listed.children ?? []).map((child) => [child.itemName, child.versionId ?? '']));
}

/**
 * Sends the file to R2's inbox as the browser does: asks the Worker for a presigned URL under the item's path, as a
 * replacement when `replace` says the album already lists the name, and PUTs the file to it. Returns the version id
 * the item will carry once the Worker has processed the upload.
 */
export async function upload(
    gallery: Gallery,
    albumPath: string,
    galleryPath: string,
    file: { body: ArrayBuffer; contentType: string },
    replace: boolean,
): Promise<string> {
    const presigned = await fetch(`${gallery.site}/api/presigned${albumPath}`, {
        method: 'POST',
        headers: { cookie: gallery.cookie, 'content-type': 'application/json' },
        body: JSON.stringify([replace ? { path: galleryPath, replace: true } : { path: galleryPath }]),
    });
    if (!presigned.ok) {
        throw new Error(`presigning ${galleryPath} failed: ${String(presigned.status)} ${await presigned.text()}`);
    }
    const target = valibot.parse(PRESIGNED, await presigned.json())[galleryPath];
    if (target === undefined) {
        throw new Error(`presigning ${galleryPath} answered without it`);
    }
    // Under wrangler dev the URL is a path on the Worker, which a browser resolves against the site and sends its
    // cookie to; a presigned URL is R2's and gets no cookie.
    const url = new URL(target.url, gallery.site);
    for (let attempt = 1; ; attempt++) {
        const put = await fetch(url, {
            method: 'PUT',
            headers: {
                'content-type': file.contentType,
                ...(url.origin === gallery.site && { cookie: gallery.cookie }),
            },
            body: file.body,
        });
        if (put.ok) {
            await put.body?.cancel();
            return target.versionId;
        }
        const reason = `${String(put.status)} ${await put.text()}`;
        if (put.status < 500 || attempt === PUT_ATTEMPTS) {
            throw new Error(`uploading ${galleryPath} failed: ${reason}`);
        }
        console.log(`retrying ${galleryPath} after ${reason.slice(0, 40)}`);
        await sleep(PUT_RETRY_MS);
    }
}

/**
 * Waits until the album lists every name under the version its upload was presigned with, which is the upload
 * processed, and gives up as soon as the Worker reports an upload failed.
 */
export async function untilProcessed(
    gallery: Gallery,
    albumPath: string,
    expected: Map<string, string>,
): Promise<void> {
    const deadline = Date.now() + PROCESSING_TIMEOUT_MS;
    let missing = [...expected.keys()];
    while (missing.length > 0) {
        const done = await listedVersions(gallery, albumPath);
        missing = missing.filter((name) => done?.get(name) !== expected.get(name));
        if (missing.length === 0) {
            return;
        }
        const failed = await uploadErrors(gallery, albumPath, missing);
        if (Object.keys(failed).length > 0) {
            throw new Error(`the Worker refused: ${JSON.stringify(failed)}`);
        }
        if (Date.now() >= deadline) {
            throw new Error(`not processed in time: ${missing.join(', ')}`);
        }
        console.log(`waiting for ${String(missing.length)} uploads to be processed`);
        await sleep(3000);
    }
}

/** The last day's upload errors for `names` in the album, by path. */
async function uploadErrors(gallery: Gallery, albumPath: string, names: string[]): Promise<Record<string, string>> {
    const response = await fetch(`${gallery.site}/api/errors`, {
        method: 'POST',
        headers: { cookie: gallery.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ paths: names.map((name) => `${albumPath}${name}`) }),
    });
    if (!response.ok) {
        await response.body?.cancel();
        return {};
    }
    return valibot.parse(ERRORS, await response.json()).errors;
}

/** A crop in pixels of an image as the recut route takes it, in percent of the image. */
export function percentOf(
    crop: { x: number; y: number; width: number; height: number },
    size: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
    return {
        x: (crop.x / size.width) * 100,
        y: (crop.y / size.height) * 100,
        width: (crop.width / size.width) * 100,
        height: (crop.height / size.height) * 100,
    };
}

export async function inParallel<T>(items: T[], atOnce: number, work: (item: T) => Promise<void>): Promise<void> {
    const queue = [...items];
    const lanes = Array.from({ length: atOnce }, async () => {
        for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
            await work(next);
        }
    });
    await Promise.all(lanes);
}
