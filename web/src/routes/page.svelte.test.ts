import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from '$lib/test-support/render';
import Page from './+page.svelte';

describe('home page', () => {
    it('greets the world', async () => {
        render(Page, {});

        await expect.element(page.getByRole('heading', { level: 1 })).toHaveTextContent('Hello, world');
    });

    it('counts clicks', async () => {
        render(Page, {});
        const button = page.getByRole('button');

        await button.click();
        await button.click();

        await expect.element(button).toHaveTextContent('Clicked 2 times');
    });
});
