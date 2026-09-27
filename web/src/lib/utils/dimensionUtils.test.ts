import { describe, expect, it } from 'vitest';
import { detailDimensions } from './dimensionUtils';

describe(detailDimensions, () => {
    it.each([
        // Media that already fits is shown at its own size, whichever side is longer
        { description: 'landscape below the limit', width: 800, height: 600, shown: { width: 800, height: 600 } },
        { description: 'portrait below the limit', width: 600, height: 800, shown: { width: 600, height: 800 } },
        {
            description: 'long side exactly at the limit',
            width: 1024,
            height: 768,
            shown: { width: 1024, height: 768 },
        },
        { description: 'square at the limit', width: 1024, height: 1024, shown: { width: 1024, height: 1024 } },

        // Oversized media scales so the long side lands on the limit
        { description: 'one pixel over the limit', width: 1025, height: 1000, shown: { width: 1024, height: 999 } },
        { description: 'landscape far over the limit', width: 4000, height: 3000, shown: { width: 1024, height: 768 } },
        { description: 'portrait far over the limit', width: 3000, height: 4000, shown: { width: 768, height: 1024 } },
        { description: 'square over the limit', width: 2048, height: 2048, shown: { width: 1024, height: 1024 } },

        // The short side is rounded rather than truncated or raised
        { description: 'landscape rounding down', width: 3000, height: 1999, shown: { width: 1024, height: 682 } },
        { description: 'landscape rounding up', width: 3000, height: 2015, shown: { width: 1024, height: 688 } },
        { description: 'portrait rounding down', width: 1999, height: 3000, shown: { width: 682, height: 1024 } },
        { description: 'portrait rounding up', width: 2015, height: 3000, shown: { width: 688, height: 1024 } },
    ])('$description: $width x $height is shown at $shown.width x $shown.height', ({ width, height, shown }) => {
        expect(detailDimensions({ width, height })).toStrictEqual(shown);
    });
});
