import { AUTH_STATUS_HEADER } from '@tacocat-gallery/shared';

let refused: (() => void) | undefined;

/**
 * Names who to tell when the Worker refuses the session cookie: the session store, which owns who is logged in and
 * sits above this layer, so it registers itself rather than being imported here.
 */
export function onSessionRefused(listener: () => void): void {
    refused = listener;
}

/**
 * Acts on what an API response said about the session cookie. A read never refuses a cookie the Worker will not
 * accept, usually an expired one: it answers with the guest view, so without this an admin whose session lapsed
 * mid-visit would see a guest's album under the admin's controls, and a write would fail with no word of why.
 */
export function noteAuthStatus(response: Response): void {
    if (response.headers.get(AUTH_STATUS_HEADER) === 'invalid') refused?.();
}
