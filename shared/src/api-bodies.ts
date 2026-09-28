import * as valibot from 'valibot';
import type { EndpointBodies } from './api.ts';
import {
    albumOrderSchema,
    albumThumbnailSchema,
    albumWriteSchema,
    cropPercentSchema,
    itemWriteSchema,
    mediaWriteSchema,
    presignRequestSchema,
    renameSchema,
} from './item.ts';

export const inviteSchema = valibot.object({ token: valibot.string() });

/** The passkey answers are typed by SimpleWebAuthn on both ends, and the Worker narrows them further. */
export const registerVerifySchema = valibot.object({ token: valibot.string(), response: valibot.unknown() });
export const loginVerifySchema = valibot.unknown();

export const uploadErrorsSchema = valibot.object({ paths: valibot.array(valibot.string()) });

/**
 * The schema of the body each endpoint in `API` takes, which the Worker parses with, by the endpoint's name. It must be
 * the schema the endpoint's entry names, which the type check holds it to. A guest's page never loads these schemas, which
 * `web/guest-bundle.ts` holds.
 */
export const API_BODIES = {
    checkInvite: inviteSchema,
    registerOptions: inviteSchema,
    registerVerify: registerVerifySchema,
    loginVerify: loginVerifySchema,
    putItem: itemWriteSchema,
    presign: presignRequestSchema,
    uploadErrors: uploadErrorsSchema,
    createAlbum: albumWriteSchema,
    updateAlbum: albumWriteSchema,
    renameAlbum: renameSchema,
    setAlbumThumbnail: albumThumbnailSchema,
    orderAlbum: albumOrderSchema,
    updateMedia: mediaWriteSchema,
    renameMedia: renameSchema,
    recutThumbnail: cropPercentSchema,
} as const satisfies EndpointBodies;
