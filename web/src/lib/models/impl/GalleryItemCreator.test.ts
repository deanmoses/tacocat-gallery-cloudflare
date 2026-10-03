import { describe, expect, it } from 'vitest';
import { toMedia } from './GalleryItemCreator';
import { imageRecord, videoRecord } from '$lib/test-support/records';

describe(toMedia, () => {
    it.each([
        { record: imageRecord({ itemName: 'felix_at_the_beach_1' }), title: 'Felix At The Beach' },
        { record: videoRecord({ itemName: 'milo_runs_2b' }), title: 'Milo Runs' },
    ])('titles $record.mediaType with no saved title by its file name', ({ record, title }) => {
        expect(toMedia(record).title).toBe(title);
    });

    // An empty title is one an admin saved, so it is kept rather than replaced by the file name
    it.each(['A Saved Title', ''])('keeps a saved title of "%s"', (title) => {
        expect(toMedia(imageRecord({ itemName: 'felix_at_the_beach_1', title })).title).toBe(title);
    });

    it('gives a media item with nothing saved an empty description and summary', () => {
        const media = toMedia(imageRecord());

        expect({ description: media.description, summary: media.summary }).toStrictEqual({
            description: '',
            summary: '',
        });
    });
});
