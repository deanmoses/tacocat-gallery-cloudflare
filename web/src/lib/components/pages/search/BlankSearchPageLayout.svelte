<!--
  @component 
  
  Layout for search pages that don't have results, but display one big thing
-->
<script lang="ts">
    import SearchPage from '$lib/components/pages/search/SearchPage.svelte';
    import FullPageMessage from '$lib/components/site/FullPageMessage.svelte';
    import type { Snippet } from 'svelte';

    interface Props {
        title?: string | undefined;
        searchTerms: string;
        returnPath?: string | undefined;
        children?: Snippet | undefined;
    }

    let { title, searchTerms, returnPath, children }: Props = $props();
</script>

<SearchPage {returnPath} {searchTerms} {title}>
    <FullPageMessage>
        {@render children?.()}
    </FullPageMessage>
</SearchPage>
