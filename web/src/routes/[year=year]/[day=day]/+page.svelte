<script lang="ts">
    import AlbumPage from '$lib/components/AlbumPage.svelte';
    import type { PageProps } from './$types';

    let { data }: PageProps = $props();
</script>

<AlbumPage album={data.album} parent={data.parent} />
