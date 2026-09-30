// What the copy decides about the AWS gallery's media as a whole, before anything is written: every item's new name,
// decided per day album, and the order of each album whose new names would sort differently from its AWS ones.
// Minting the ids and importing the rows both read it, so the two agree. An item whose name sanitizes to nothing gets
// no new name, so it gets no id and its row is refused, where the refusal is the finding. A day album moved to a real
// date has to land where no album is, since two albums merged would put two items under one name.
import { mediaPath } from '@tacocat-gallery/shared';
import { type AwsItem, awsPath } from './aws-scan.ts';
import { type Renamed, awsOrder, copiedAlbumPath, renamedMedia } from './aws-names.ts';

export interface CopyPlan {
    /** Each media item's new name, by its AWS path. */
    renames: Map<string, Renamed>;
    /** The new names of each album that keeps AWS's order, by the album's new path. */
    orders: Map<string, string[]>;
}

export function copyPlan(rows: readonly AwsItem[]): CopyPlan {
    const albums = new Set(rows.filter((row) => row.itemType === 'album').map((row) => awsPath(row)));
    for (const album of albums) {
        const moved = copiedAlbumPath(album);
        if (moved !== album && albums.has(moved)) {
            throw new Error(`${album} moves to ${moved}, which is an album already`);
        }
    }
    const renames = new Map<string, Renamed>();
    const orders = new Map<string, string[]>();
    for (const [parentPath, media] of Map.groupBy(
        rows.filter((row) => row.itemType === 'image' && row.parentPath !== undefined && row.itemName !== undefined),
        (row) => row.parentPath ?? '',
    )) {
        const renamed = renamedMedia(media.map((row) => ({ itemName: row.itemName ?? '', mediaType: row.mediaType })));
        for (const item of renamed.filter(({ to }) => to !== '')) {
            renames.set(mediaPath(parentPath, item.from), item);
        }
        const order = awsOrder(renamed);
        if (order !== null) {
            orders.set(copiedAlbumPath(parentPath), order);
        }
    }
    return { renames, orders };
}

/** Where the copy puts an AWS media item, or null for a path the plan has no item at. */
export function copiedMediaPath(plan: CopyPlan, path: string): string | null {
    const renamed = plan.renames.get(path);
    return renamed === undefined ? null : mediaPath(copiedAlbumPath(albumOf(path)), renamed.to);
}

function albumOf(path: string): string {
    return path.slice(0, path.lastIndexOf('/') + 1);
}
