<!--
  @component 
  
  Page that displays an error instead of an album
-->
<script lang="ts">
    import BlankAlbumPageLayout from './BlankAlbumPageLayout.svelte';
    import type { Snippet } from 'svelte';

    interface Props {
        title?: string | undefined;
        children?: Snippet | undefined;
    }

    let { title = 'Error', children }: Props = $props();
</script>

<BlankAlbumPageLayout hideFooter {title}>
    {@render children?.()}
</BlankAlbumPageLayout>
