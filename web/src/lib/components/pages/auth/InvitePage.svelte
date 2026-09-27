<!--
  @component

  Creates a passkey from an invite link, once the Worker says the link is still good
-->
<script lang="ts">
    import LinkButton from '$lib/components/site/admin/LinkButton.svelte';
    import AuthPageLayout from '$lib/components/pages/auth/AuthPageLayout.svelte';
    import HomeIcon from '$lib/components/site/icons/HomeIcon.svelte';
    import LoginIcon from '$lib/components/site/icons/LoginIcon.svelte';
    import { checkInvite, createPasskey } from '$lib/utils/passkeys';

    interface Props {
        /** The secret the invite link carries */
        token: string;
    }

    let { token }: Props = $props();
    let invite = $derived(checkInvite(token));
    let working = $state(false);
    let created = $state(false);
    let message = $state('');

    async function create(): Promise<void> {
        working = true;
        message = '';
        try {
            await createPasskey(token);
            created = true;
        } catch (error) {
            message = errorText(error);
        } finally {
            working = false;
        }
    }

    function onCreate(): void {
        void create();
    }

    function errorText(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
</script>

<AuthPageLayout title="Create passkey">
    {#await invite}
        <p>Checking invite...</p>
    {:then check}
        {#if created && check.live}
            <p>Passkey created. You're logged in as <b>{check.username}</b>.</p>
            <p><a data-sveltekit-reload href="/"><HomeIcon /> Go to the home page</a></p>
        {:else if check.live}
            <p>
                <LinkButton disabled={working} onclick={onCreate}
                    ><LoginIcon height="1.3em" width="1.3em" /> Create passkey</LinkButton
                > to login as <b>{check.username}</b>.
            </p>
            {#if message !== ''}
                <p role="alert">{message}</p>
            {/if}
        {:else}
            <p role="alert">{check.message}</p>
            <p>If you've already created a passkey, <a href="/login">log in with it</a>.</p>
        {/if}
    {:catch error}
        <p role="alert">Couldn't check this invite: {errorText(error)}</p>
    {/await}
</AuthPageLayout>
