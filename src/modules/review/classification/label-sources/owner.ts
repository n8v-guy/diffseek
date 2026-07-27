import { ownersForPathOrNull } from '@diffseek/repository-metadata';

import type { LabelSource } from '../labels';

export const ownerLabelSource: LabelSource = {
  prepare: (_files, context) => ({ file }) => {
    const owners =
      ownersForPathOrNull(file.path, context.codeowners) ?? file.owners;
    return (owners.length > 0 ? owners : ['Unmapped']).map((value) => ({
      facet: 'owners',
      value,
    }));
  },
};
