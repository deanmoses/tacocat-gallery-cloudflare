import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { album, albumChild, mediaChild } from '$lib/test-support/fixtures';
import { render } from '$lib/test-support/render';
import AlbumPage from './AlbumPage.svelte';

describe('an album page', () => {
    it('titles a day album by its date and shows each media item as a thumbnail', async () => {
        const felix = mediaChild('/2001/06-15/felix.jpg', { title: 'Felix', versionId: 'v1' });
        render(AlbumPage, { album: album('/2001/06-15/', { children: [felix] }) });

        await expect.element(page.getByRole('heading', { level: 1 })).toHaveTextContent('June 15, 2001');
        await expect
            .element(page.getByRole('img', { name: 'Felix' }))
            .toHaveAttribute('src', '/i/2001/06-15/felix.jpg/v1?size=200x200');
        await expect
            .element(page.getByRole('link', { name: 'Felix' }))
            .toHaveAttribute('href', '/2001/06-15/felix.jpg');
    });

    it('links a year album to its days and marks the unpublished ones', async () => {
        const days = [albumChild('/2001/06-15/'), albumChild('/2001/07-04/', { published: false })];
        render(AlbumPage, { album: album('/2001/', { children: days }) });

        await expect.element(page.getByRole('link', { name: 'June 15, 2001' })).toHaveAttribute('href', '/2001/06-15');
        await expect.element(page.getByText('unpublished')).toBeVisible();
    });

    it('links to the albums before, above and after, from its parent', async () => {
        const days = [
            albumChild('/2001/05-01/'),
            albumChild('/2001/06-15/'),
            albumChild('/2001/07-04/', { title: 'Fourth' }),
        ];
        const parent = Promise.resolve(album('/2001/', { children: days }));
        render(AlbumPage, { album: album('/2001/06-15/'), parent });

        await expect
            .element(page.getByRole('link', { name: 'Previous: May 1, 2001' }))
            .toHaveAttribute('href', '/2001/05-01');
        await expect.element(page.getByRole('link', { name: 'Up: 2001' })).toHaveAttribute('href', '/2001');
        await expect.element(page.getByRole('link', { name: 'Next: Fourth' })).toHaveAttribute('href', '/2001/07-04');
    });

    it('shows before its parent arrives', async () => {
        const felix = mediaChild('/2001/06-15/felix.jpg', { title: 'Felix' });
        const parent = Promise.withResolvers<null>().promise;
        render(AlbumPage, { album: album('/2001/06-15/', { children: [felix] }), parent });

        await expect.element(page.getByRole('link', { name: 'Felix' })).toBeVisible();
        await expect.element(page.getByRole('link', { name: 'Up: 2001' })).toBeVisible();
    });
});

describe('thumbnails on an album page', () => {
    it('shows a day by its chosen photo, cut to its crop', async () => {
        const crop = { x: 10, y: 20, width: 300, height: 300 };
        const thumbnail = { path: '/2001/06-15/felix.jpg', versionId: 'v2', crop };
        render(AlbumPage, { album: album('/2001/', { children: [albumChild('/2001/06-15/', { thumbnail })] }) });
        const link = page.getByRole('link', { name: 'June 15, 2001' });

        await expect.element(link).toHaveAttribute('href', '/2001/06-15');
        await expect
            .element(link.getByRole('presentation'))
            .toHaveAttribute('src', '/i/2001/06-15/felix.jpg/v2?size=200x200&crop=10,20,300,300');
    });

    it('cuts a media thumbnail to its own crop', async () => {
        const thumbnailCrop = { x: 0, y: 0, width: 100, height: 100 };
        const felix = mediaChild('/2001/06-15/felix.jpg', { title: 'Felix', thumbnailCrop });
        render(AlbumPage, { album: album('/2001/06-15/', { children: [felix] }) });

        await expect
            .element(page.getByRole('img', { name: 'Felix' }))
            .toHaveAttribute('src', '/i/2001/06-15/felix.jpg/v1?size=200x200&crop=0,0,100,100');
    });
});
