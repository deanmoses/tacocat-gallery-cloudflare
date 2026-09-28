/**
 * Logging in with a passkey, creating one from an invite, and logging out.
 *
 * The WebAuthn library is imported where it is used, so readers, who never log in, never download it.
 */
import type {
    PublicKeyCredentialCreationOptionsJSON,
    PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { callApi, failureMessage } from '$lib/utils/adminApi';
import { API } from '@tacocat-gallery/shared';

/** What an invite link can do, asked before offering to create a passkey with it. */
export type InviteCheck = { live: true; username: string } | { live: false; message: string };

export async function checkInvite(token: string): Promise<InviteCheck> {
    const response = await callApi(API.checkInvite, { token });
    if (!response.ok) return { live: false, message: await failureMessage(response) };
    const body: unknown = await response.json();
    if (!hasUsername(body)) throw new Error('Expected the invite to name an admin');
    return { live: true, username: body.username };
}

export async function createPasskey(token: string): Promise<void> {
    const { startRegistration } = await import('@simplewebauthn/browser');
    const optionsJSON = await okJson(await callApi(API.registerOptions, { token }));
    if (!isCreationOptions(optionsJSON)) throw new Error('Expected options for creating a passkey');
    const response = await ceremony(startRegistration({ optionsJSON }));
    await okJson(await callApi(API.registerVerify, { token, response }));
}

export async function logIn(): Promise<void> {
    const { startAuthentication } = await import('@simplewebauthn/browser');
    const optionsJSON = await okJson(await callApi(API.loginOptions));
    if (!isRequestOptions(optionsJSON)) throw new Error('Expected options for logging in with a passkey');
    const response = await ceremony(startAuthentication({ optionsJSON }));
    await okJson(await callApi(API.loginVerify, response));
}

export async function logOut(): Promise<void> {
    await okJson(await callApi(API.logout));
}

/**
 * The browser's answer to the passkey prompt. Dismissing the prompt and letting it time out are one error that the
 * browser words for developers, so it is reworded for the person who just did one of them.
 */
async function ceremony<T>(prompt: Promise<T>): Promise<T> {
    try {
        return await prompt;
    } catch (error) {
        if (error instanceof Error && error.name === 'NotAllowedError') {
            throw new Error('The passkey prompt was closed or timed out. Try again.', { cause: error });
        }
        throw error;
    }
}

async function okJson(response: Response): Promise<unknown> {
    if (!response.ok) throw new Error(await failureMessage(response));
    return response.json();
}

/** Only the fields each ceremony needs are checked here; the browser checks the rest of the options when it runs one. */
function isRequestOptions(body: unknown): body is PublicKeyCredentialRequestOptionsJSON {
    return typeof body === 'object' && body !== null && 'challenge' in body && typeof body.challenge === 'string';
}

function isCreationOptions(body: unknown): body is PublicKeyCredentialCreationOptionsJSON {
    return isRequestOptions(body) && 'rp' in body && 'user' in body && 'pubKeyCredParams' in body;
}

function hasUsername(body: unknown): body is { username: string } {
    return typeof body === 'object' && body !== null && 'username' in body && typeof body.username === 'string';
}
