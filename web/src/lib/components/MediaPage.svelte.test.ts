import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { album, mediaChild } from '$lib/test-support/fixtures';
import { render } from '$lib/test-support/render';
import MediaPage from './MediaPage.svelte';

const DAY = album('/2001/06-15/');

describe('a media page', () => {
    it('shows a landscape photo at 1024 wide, titled and captioned', async () => {
        const felix = mediaChild('/2001/06-15/felix.jpg', { title: 'Felix', description: 'Asleep again' });
        render(MediaPage, { album: DAY, media: felix, prev: null, next: null });

        await expect.element(page.getByRole('heading', { level: 1 })).toHaveTextContent('Felix');
        await expect
            .element(page.getByRole('img', { name: 'Felix' }))
            .toHaveAttribute('src', '/i/2001/06-15/felix.jpg/v1?size=1024');
        await expect.element(page.getByText('Asleep again')).toBeVisible();
    });

    it('shows a portrait photo at 1024 tall', async () => {
        const tall = mediaChild('/2001/06-15/tall.jpg', { width: 3024, height: 4032 });
        render(MediaPage, { album: DAY, media: tall, prev: null, next: null });

        await expect
            .element(page.getByRole('img', { name: 'tall.jpg' }))
            .toHaveAttribute('src', '/i/2001/06-15/tall.jpg/v1?size=x1024');
    });

    it('plays a video from its MP4 with its poster', async () => {
        const clip = mediaChild('/2001/06-15/clip.mov', { itemType: 'video', durationSeconds: 9.6 });
        render(MediaPage, { album: DAY, media: clip, prev: null, next: null });
        const video = document.querySelector('video');

        expect(video).toHaveAttribute('src', '/v/derived/2001/06-15/clip.mov/v1/video.mp4');
        expect(video).toHaveAttribute('poster', '/i/2001/06-15/clip.mov/v1?size=1024');
    });

    it('links to the media before and after, and up to the day', async () => {
        const media = mediaChild('/2001/06-15/b.jpg');
        const prev = mediaChild('/2001/06-15/a.jpg', { title: 'First' });
        const next = mediaChild('/2001/06-15/c.jpg');
        render(MediaPage, { album: DAY, media, prev, next });

        await expect
            .element(page.getByRole('link', { name: 'Previous: First' }))
            .toHaveAttribute('href', '/2001/06-15/a.jpg');
        await expect
            .element(page.getByRole('link', { name: 'Up: June 15, 2001' }))
            .toHaveAttribute('href', '/2001/06-15');
        await expect
            .element(page.getByRole('link', { name: 'Next: c.jpg' }))
            .toHaveAttribute('href', '/2001/06-15/c.jpg');
    });
});
