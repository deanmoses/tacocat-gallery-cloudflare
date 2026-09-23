<!--
  @component

  A year album's thumbnails by month
-->
<script lang="ts">
    import Thumbnails from '$lib/components/site/Thumbnails.svelte';
    import AlbumThumbnail from '$lib/components/site/AlbumThumbnail.svelte';
    import { shortDate } from '$lib/utils/date-utils';
    import { albumPathToDate } from '$lib/utils/galleryPathUtils';
    import type { Album, Thumbable } from '$lib/models/GalleryItemInterfaces';

    interface Props {
        album: Album;
    }
    let { album }: Props = $props();

    type AlbumsByMonth = {
        monthName: string;
        albums: Thumbable[];
    }[];

    /**
     * Group the albums by month
     */
    function albumsByMonth(albums: Thumbable[]): AlbumsByMonth {
        // Sparse, indexed by month number, so the months come out in calendar order
        const months: AlbumsByMonth = [];

        for (const childAlbum of albums) {
            const albumDate = albumPathToDate(childAlbum.path);
            const month: number = albumDate.getMonth();
            let entry = months[month];
            if (entry === undefined) {
                let monthName = albumDate.toLocaleString('default', { month: 'long' });
                // capitalize the first letter
                monthName = monthName.charAt(0).toUpperCase() + monthName.slice(1);
                entry = { monthName, albums: [] };
                months[month] = entry;
            }
            entry.albums.unshift(childAlbum);
        }

        // remove empty months
        return months.filter(Boolean).toReversed();
    }

    function getTitle(albumPath: string): string {
        const albumDate = albumPathToDate(albumPath);
        return shortDate(albumDate);
    }
    import { albumActivity } from '$lib/stores/AlbumState.svelte';
</script>

{#each albumsByMonth(album.albums) as month (month.monthName)}
    <section class="month">
        <h2>{month.monthName}</h2>
        <Thumbnails>
            {#each month.albums as childAlbum (childAlbum.path)}
                <AlbumThumbnail
                    activity={albumActivity(childAlbum.path)}
                    href={childAlbum.href}
                    published={childAlbum.published}
                    summary={childAlbum.summary}
                    thumbnailUrlInfo={childAlbum.thumbnailUrlInfo}
                    title={getTitle(childAlbum.path)}
                />
            {/each}
        </Thumbnails>
    </section>
{/each}

<style>
    h2 {
        background-color: var(--month-color, var(--header-color));
        font-weight: 700;
        font-size: 1.3em;
        line-height: 1.1;
        padding: 0.3em 0.4em;
        width: 100%;
    }

    .month {
        display: flex;
        flex-direction: column;
        gap: calc(var(--default-padding) * 2);
    }
</style>
