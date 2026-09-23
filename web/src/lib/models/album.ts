import type { Album } from './GalleryItemInterfaces';

/**
 * Types of albums
 */
export const AlbumType = {
    ROOT: 'ROOT',
    YEAR: 'YEAR',
    DAY: 'DAY',
} as const;
export type AlbumType = (typeof AlbumType)[keyof typeof AlbumType];

/**
 * An entry in the album store
 */
export interface AlbumEntry {
    loadStatus: AlbumLoadStatus;
    renameEntry?: RenameEntry;
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

/**
 * Input data for uploading a media item (before upload starts)
 */
export interface MediaItemToUpload {
    file: File;
    /** Path used for S3 upload (e.g., /2024/01-01/photo.heic) */
    uploadPath: string;
    /** For replacements: the S3 versionId of the media item being replaced */
    previousVersionId?: string;
}

/**
 * Represents a single media item being uploaded
 */
export interface UploadEntry {
    file: File;
    /** Path used for S3 upload (e.g., /2024/01-01/photo.heic) */
    uploadPath: string;
    /** Expected mediaPath in album after server processing (e.g., /2024/01-01/photo.jpg for HEIC) */
    mediaPath: string;
    status: UploadState;
    /** S3 versionId of newly uploaded media item.
     * For file formats that get converted to a different format on the server (like HEIC -> JPG),
     * this will be the versionId of the pre-conversion media item, which is not useful */
    versionId?: string;
    /** S3 versionId of media item being replaced.
     * For file formats that get converted to a different format on the server (like HEIC -> JPG),
     * detecting when the versionId is no longer this is how we determine the new media item has been converted and is ready to use */
    previousVersionId?: string;
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
