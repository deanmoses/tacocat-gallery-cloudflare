<!--
  @component

  Logs the admin in with a passkey, or out
-->
<script lang="ts">
    import LinkButton from '$lib/components/site/admin/LinkButton.svelte';
    import AuthPageLayout from '$lib/components/pages/auth/AuthPageLayout.svelte';
    import LoginIcon from '$lib/components/site/icons/LoginIcon.svelte';
    import LogoutIcon from '$lib/components/site/icons/LogoutIcon.svelte';
    import { sessionStore } from '$lib/stores/SessionStore.svelte';
    import { loadDocument } from '$lib/utils/documentLoad';
    import { logIn, logOut } from '$lib/utils/passkeys';

    interface Props {
        /** Where to go once logged in or out */
        returnPath: string;
    }

    let { returnPath }: Props = $props();
    let working = $state(false);
    let message = $state('');

    let title = $derived(titleFor(sessionStore.isCheckingAuth, sessionStore.isAdmin));

    function titleFor(checking: boolean, admin: boolean): string {
        if (checking) return '';
        return admin ? 'Logout' : 'Login';
    }

    /** Leaves for `returnPath` once the session has changed; stays, saying why, when it could not. */
    async function changeSession(change: () => Promise<void>): Promise<void> {
        working = true;
        message = '';
        try {
            await change();
            loadDocument(returnPath);
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
            working = false;
        }
    }

    function onLogIn(): void {
        void changeSession(logIn);
    }

    function onLogOut(): void {
        void changeSession(logOut);
    }
</script>

<AuthPageLayout {title}>
    {#if sessionStore.isCheckingAuth}
        <p>Checking authentication...</p>
    {:else if sessionStore.isAdmin}
        <p>You're logged in</p>
        <p>
            <LinkButton disabled={working} onclick={onLogOut}
                ><LogoutIcon height="1.3em" width="1.4em" /> Logout</LinkButton
            >
        </p>
    {:else}
        <p>
            <LinkButton disabled={working} onclick={onLogIn}
                ><LoginIcon height="1.3em" width="1.3em" /> Login with passkey</LinkButton
            >
        </p>
    {/if}
    {#if message !== ''}
        <p role="alert">{message}</p>
    {/if}
</AuthPageLayout>
