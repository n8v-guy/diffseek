import type { LabelSource } from '../labels';

export const statusLabelSource: LabelSource = {
  prepare: () => ({ file }) => [
    { facet: 'statuses', value: file.status },
  ],
};
