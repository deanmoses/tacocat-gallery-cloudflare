<script lang="ts">
    import MediaPage from '$lib/components/MediaPage.svelte';
    import type { PageProps } from './$types';

    let { data }: PageProps = $props();
</script>

<MediaPage album={data.album} media={data.media} next={data.next} prev={data.prev} />
