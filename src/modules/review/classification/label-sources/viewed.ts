import type { LabelSource } from '../labels';

export const viewedLabelSource: LabelSource = {
  prepare: () => ({ file }) =>
    file.viewed ? [{ facet: 'viewed', value: 'true' }] : [],
};
