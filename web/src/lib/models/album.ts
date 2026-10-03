import type { Album } from './GalleryItemInterfaces';

/**
 * Types of albums
 */
/**
 * An entry in the album store
 */
export interface AlbumEntry {
    loadStatus: AlbumLoadStatus;
    album?: Album;
}

/**
 * Status of the initial load of the album
 */
export const AlbumLoadStatus = {
    /** The album has never been loaded and nobody's asked for it */
    NOT_LOADED: 'NOT_LOADED',
    /** The album has never been loaded but it's being retrieved */
    LOADING: 'LOADING',
    /** The album has never been loaded because there was an error loading the album. */
    ERROR_LOADING: 'ERROR_LOADING',
    /** The album definitely does not exist */
    DOES_NOT_EXIST: 'DOES_NOT_EXIST',
    /** The album has been loaded */
    LOADED: 'LOADED',
} as const;
export type AlbumLoadStatus = (typeof AlbumLoadStatus)[keyof typeof AlbumLoadStatus];

/**
 * Status of subsequent reload to the album
 *
 * Reload status is different than load status:
 * reloads are AFTER the initial album has loaded.
 */
export const ReloadStatus = {
    NOT_RELOADING: 'NOT_RELOADING',
    RELOADING: 'RELOADING',
    ERROR_RELOADING: 'ERROR_RELOADING',
} as const;
export type ReloadStatus = (typeof ReloadStatus)[keyof typeof ReloadStatus];

/**
 * Represents an album being created
 */
export interface CreateEntry {
    status: CreateStatus;
}

export const CreateStatus = {
    IN_PROGRESS: 'In Progress',
} as const;
export type CreateStatus = (typeof CreateStatus)[keyof typeof CreateStatus];

/** A file about to be uploaded, and the media path it will have */
export interface MediaItemToUpload {
    file: File;
    /** The sanitized file name in the album, or for a replacement, the path of the item it replaces */
    path: string;
    /** Whether the item at the path is being replaced: the server refuses an upload under a taken name unless told so */
    replace?: boolean;
}

/** An upload in flight */
export interface UploadEntry {
    file: File;
    path: string;
    status: UploadState;
    /** The version id the server minted for this upload, which the media item carries once the pipeline has made it */
    versionId?: string;
}

/**
 * Status of of the upload of a single media item
 */
export const UploadState = {
    UPLOAD_NOT_STARTED: 'Not Started',
    UPLOADING: 'Uploading',
    PROCESSING: 'Processing',
} as const;
export type UploadState = (typeof UploadState)[keyof typeof UploadState];

/**
 * Represents a single album or media item being renamed
 */
export interface RenameEntry {
    oldPath: string;
    newPath: string;
    status: RenameStatus;
}

export const RenameStatus = {
    IN_PROGRESS: 'In Progress',
    /** The server has renamed it; the album has not been re-read yet, so the page at the old path can move to the new */
    RENAMED: 'Renamed',
} as const;
export type RenameStatus = (typeof RenameStatus)[keyof typeof RenameStatus];

/**
 * Represents a single album or media item being deleted
 */
export interface DeleteEntry {
    status: DeleteStatus;
}

export const DeleteStatus = {
    IN_PROGRESS: 'In Progress',
} as const;
export type DeleteStatus = (typeof DeleteStatus)[keyof typeof DeleteStatus];

/**
 * Represents the state of a thumbnail being cropped
 */
export interface CropEntry {
    mediaPath: string;
    crop: Crop;
    status: CropStatus;
}

export interface Crop {
    x: number;
    y: number;
    height: number;
    width: number;
}

export const CropStatus = {
    IN_PROGRESS: 'In Progress',
} as const;
export type CropStatus = (typeof CropStatus)[keyof typeof CropStatus];

/**
 * An album whose media an admin is dragging into an order of their own
 */
export interface ReorderEntry {
    status: ReorderStatus;
}

export const ReorderStatus = {
    REORDERING: 'Reordering',
    SAVING: 'Saving',
} as const;
export type ReorderStatus = (typeof ReorderStatus)[keyof typeof ReorderStatus];

/** What an admin is doing to an album right now, for its thumbnail to show. */
export interface AlbumActivity {
    creating: boolean;
    deleting: boolean;
    renaming: boolean;
}

/** What an admin is doing to a media item right now, for its thumbnail to show. */
export interface MediaActivity {
    deleting: boolean;
    renaming: boolean;
    cropping: boolean;
}
