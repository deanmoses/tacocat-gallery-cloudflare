import { checkAuthenticationUrl } from '$lib/utils/config';
import { get as getFromIdb, set as setToIdb } from 'idb-keyval';

const HasBeenLoggedInIDBKey = 'HasBeenLoggedIn';
/**
 * Store of the current user / session
 */
class SessionStore {
    #isAdmin: boolean = $state(false);
    isAdmin: boolean = $derived(this.#isAdmin);
    #isCheckingAuth: boolean = $state(true);
    isCheckingAuth: boolean = $derived(this.#isCheckingAuth);
    #hasBeenLoggedIn: boolean = $state(false);
    hasBeenLoggedIn: boolean = $derived(this.#hasBeenLoggedIn);

    //
    // STATE TRANSITION METHODS
    // These mutate the store's state.
    //
    // Characteristics:
    //  - These are the ONLY way to update this store's state.
    //    These should be the only public methods on this store.
    //  - These ONLY update state.
    //    If they have to do any work, like making a server call, they invoke it in an
    //    event-like fire-and-forget fashion, meaning invoke async methods *without* await.
    //  - These are synchronous.
    //    They expectation is that they return near-instantly.
    //  - These return void.
    //    To read this store's state, use one of the public $derived() fields
    //

    fetchUserStatus(): void {
        void this.#fetchUserStatus(); // invoke async service in fire-and-forget fashion
    }

    fetchHasBeenLoggedIn(): void {
        void this.#fetchHasBeenLoggedIn(); // invoke async service in fire-and-forget fashion
    }

    #authenticationSuccess(): void {
        this.#isAdmin = true;
        this.#isCheckingAuth = false;
    }

    #authenticationFailure(): void {
        this.#isAdmin = false;
        this.#isCheckingAuth = false;
    }

    #hasBeenLoggedInSuccess(): void {
        console.log('User has been logged in before');
        this.#hasBeenLoggedIn = true;
    }

    //
    // SERVICE METHODS
    // These 'do work', like making a server call.
    //
    // Characteristics:
    //  - These are private, meant to only be called by STATE TRANSITION METHODS
    //  - These don't mutate state directly; rather, they call STATE TRANSITION METHODS to do it
    //  - These are generally async.
    //  - These don't return values; they return void or Promise<void>
    //

    /**
     * Fetch current user's status from server
     */
    async #fetchUserStatus(): Promise<void> {
        try {
            const response = await fetch(checkAuthenticationUrl(), {
                // no-store: the browser fetches from the remote server without first looking in the cache,
                // and will not update the cache with the downloaded resource
                cache: 'no-store',
            });
            this.#handleErrors(response);
            const json: unknown = await response.json();
            if (!isAuthStatus(json)) throw new Error('Expected authentication status to name an admin or null');
            const isAdmin = json.admin !== null;
            if (isAdmin) {
                console.log('User is an admin');
                this.#authenticationSuccess();
                await setToIdb(HasBeenLoggedInIDBKey, true);
            } else {
                // User is not logged in,
                // check to see whether they have
                // EVER been logged in
                if (!this.hasBeenLoggedIn) {
                    await this.#fetchHasBeenLoggedIn();
                }
                this.#authenticationFailure();
            }
        } catch (error) {
            console.error('Error checking authentication status:', error);
            this.#authenticationFailure();
        }
    }

    #handleErrors(response: Response): void {
        if (!response.ok) {
            const msg = `Response not OK fetching authentication status: ${response.statusText}`;
            throw new Error(msg);
        }
        if (response.status !== 200) {
            const msg = `Non-200 response (${response.status}) fetching authentication status`;
            throw new Error(msg);
        }
        const contentType = response.headers.get('content-type');
        if (contentType?.startsWith('application/json') !== true) {
            throw new Error(
                `Expected response to be in JSON.  Instead got ${String(contentType)}. ${response.statusText}`,
            );
        }
    }

    async #fetchHasBeenLoggedIn(): Promise<void> {
        const hasBeenLoggedIn: unknown = await getFromIdb(HasBeenLoggedInIDBKey);
        if (hasBeenLoggedIn === true) this.#hasBeenLoggedInSuccess();
        else {
            console.log(`user has never been logged in before:`, hasBeenLoggedIn);
        }
    }
}

export const sessionStore = new SessionStore();

/** The admin's name, or null for a guest */
function isAuthStatus(value: unknown): value is { admin: string | null } {
    return (
        typeof value === 'object' &&
        value !== null &&
        'admin' in value &&
        (typeof value.admin === 'string' || value.admin === null)
    );
}
