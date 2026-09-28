import { API } from '@tacocat-gallery/shared';
import { describe, expect, it } from 'vitest';
import { createApp, route } from '../../src/routes/app';

describe(createApp, () => {
    const routes = createApp().routes.map(({ method, path }) => `${method} ${path}`);

    it.each(Object.entries(API))('answers %s', (_name, endpoint) => {
        expect(routes).toContain(`${endpoint.method} ${route(endpoint)}`);
    });
});
