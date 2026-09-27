<!--
  @component

  A page that shows one message under the site's header, with a way home and no search or album navigation
-->
<script lang="ts">
    import FullPageMessage from '$lib/components/site/FullPageMessage.svelte';
    import Header from '$lib/components/site/Header.svelte';
    import ReturnIcon from '$lib/components/site/icons/ReturnIcon.svelte';
    import SiteLayout from '$lib/components/site/SiteLayout.svelte';
    import type { Snippet } from 'svelte';

    interface Props {
        /** The browser tab's title */
        title: string;
        children?: Snippet | undefined;
    }

    let { title, children }: Props = $props();
</script>

<svelte:head>
    <title>{title}</title>
</svelte:head>

<SiteLayout hideFooter>
    <Header hideSearch><a data-sveltekit-reload href="/"><ReturnIcon title="Home" /></a></Header>
    <FullPageMessage>
        {@render children?.()}
    </FullPageMessage>
</SiteLayout>

<style>
    a {
        color: var(--default-text-color);
    }
</style>
