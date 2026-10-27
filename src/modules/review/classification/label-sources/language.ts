import type { LabelSource } from '../labels';

export const languageLabelSource: LabelSource = {
  prepare: () =>
    ({ file, attributes }) => [
      {
        facet: 'languages',
        value: attributes.language
          ?? (file.extension
            ? file.extension.slice(1).toLowerCase()
            : 'No extension'),
      },
    ],
};
