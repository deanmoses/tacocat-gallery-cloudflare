import { describe, expect, it } from 'vitest';
import { copiedMediaPath, copyPlan } from '../../scripts/aws-copy-plan.ts';
import type { AwsItem } from '../../scripts/aws-scan.ts';

const album = (parentPath: string, itemName: string): AwsItem => ({ parentPath, itemName, itemType: 'album' });
const photo = (parentPath: string, itemName: string): AwsItem => ({ parentPath, itemName, itemType: 'image' });

describe(copyPlan, () => {
    it('puts each item under its new name, in the day its album moves to', () => {
        const plan = copyPlan([album('/1991/', '11-31'), photo('/1991/11-31/', '1991_Nov1.jpg')]);

        expect(copiedMediaPath(plan, '/1991/11-31/1991_Nov1.jpg')).toBe('/1991/11-30/1991_nov1');
    });

    // Two albums merged would put two items under one name, one row overwriting the other
    it('refuses an album that moves to a day that is an album already', () => {
        expect(() => copyPlan([album('/1991/', '11-31'), album('/1991/', '11-30')])).toThrow(
            '/1991/11-31/ moves to /1991/11-30/, which is an album already',
        );
    });

    it('gives no name to an item whose name sanitizes to nothing', () => {
        const plan = copyPlan([photo('/2019/07-15/', '.jpg'), photo('/2019/07-15/', 'lake.jpg')]);

        expect(copiedMediaPath(plan, '/2019/07-15/.jpg')).toBeNull();
        expect(copiedMediaPath(plan, '/2019/07-15/lake.jpg')).toBe('/2019/07-15/lake');
    });
});
