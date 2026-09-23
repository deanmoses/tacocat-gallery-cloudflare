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

    it('links to the albums before, above and after', async () => {
        const prev = { path: '/2001/05-01/', title: null };
        const next = { path: '/2001/07-04/', title: 'Fourth' };
        render(AlbumPage, { album: album('/2001/06-15/', { prev, next }) });

        await expect
            .element(page.getByRole('link', { name: 'Previous: May 1, 2001' }))
            .toHaveAttribute('href', '/2001/05-01');
        await expect.element(page.getByRole('link', { name: 'Up: 2001' })).toHaveAttribute('href', '/2001');
        await expect.element(page.getByRole('link', { name: 'Next: Fourth' })).toHaveAttribute('href', '/2001/07-04');
    });
});
