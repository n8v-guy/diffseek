import type { LabelSource } from '../labels';

export const languageLabelSource: LabelSource = {
  prepare: () =>
    ({ file, attributes }) => [
      attributes.language
        ? {
            facet: 'languages',
            value: attributes.language,
            mapped: true,
          }
        : {
            facet: 'languages',
            value: file.extension?.slice(1) ?? 'No extension',
          },
    ],
};
