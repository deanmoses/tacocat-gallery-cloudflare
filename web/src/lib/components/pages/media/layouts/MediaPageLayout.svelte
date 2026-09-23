<!-- 
    @component 
    
    Layout of an image page 
-->
<script lang="ts">
    import SiteLayout from '$lib/components/site/SiteLayout.svelte';
    import Header from '$lib/components/site/Header.svelte';
    import PageContent from '$lib/components/site/PageContent.svelte';
    import Nav from '$lib/components/site/nav/Nav.svelte';
    import type { Snippet } from 'svelte';

    interface Props {
        title: string;
        titleEditor?: Snippet | undefined;
        caption?: Snippet | undefined;
        imageHtml?: Snippet | undefined;
        nav?: Snippet | undefined;
        editControls?: Snippet | undefined;
    }

    let { title, titleEditor, caption, imageHtml, nav, editControls }: Props = $props();
</script>

<svelte:head>
    <title>{title}</title>
</svelte:head>

<SiteLayout>
    {@render editControls?.()}
    {#if titleEditor}
        <Header hideSearch hideSiteTitle hideWhenSmall>
            {@render titleEditor?.()}
        </Header>
    {:else if title}
        <Header hideSearch hideSiteTitle hideWhenSmall>
            {title}
        </Header>
    {/if}
    <PageContent>
        <main>
            {#if caption}
                <section class="caption" aria-label="Caption">
                    {@render caption?.()}
                </section>
            {/if}
            <div class="navAndMedia">
                {#if nav}
                    <Nav>
                        {@render nav?.()}
                    </Nav>
                {/if}
                <section aria-label="Media">
                    {@render imageHtml?.()}
                </section>
            </div>
        </main>
    </PageContent>
</SiteLayout>

<style>
    main {
        flex: 3;
        display: flex;
        gap: calc(var(--default-padding) * 2);
        padding: calc(var(--default-padding) * 2);
        background-color: white;
    }

    @media screen and (max-width: 975px) {
        main {
            flex-direction: column;
        }
    }

    .caption {
        flex: 1;
    }

    .navAndMedia {
        flex: 3;
    }
</style>
