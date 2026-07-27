import type { LabelSource } from '../labels';

export const groupLabelSource: LabelSource = {
  prepare: () => ({ attributes }) =>
    [{
      facet: 'groups',
      value: attributes.group ?? 'No type',
    }],
};
