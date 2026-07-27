import type { LabelSource } from '../labels';

export const generatedLabelSource: LabelSource = {
  prepare: () => ({ attributes }) => [
    { facet: 'generated', value: String(attributes.generated) },
  ],
};
