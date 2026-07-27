import type { LabelSource } from '../labels';

export const languageLabelSource: LabelSource = {
  prepare: (files) => {
    const extensionsByLanguage = new Map<string, Set<string>>();
    for (const { file, attributes } of files) {
      if (!attributes.language || !file.extension) continue;
      const extensions =
        extensionsByLanguage.get(attributes.language) ?? new Set<string>();
      extensions.add(file.extension.slice(1));
      extensionsByLanguage.set(attributes.language, extensions);
    }

    return ({ file, attributes }) => {
      if (!attributes.language) {
        return [
          {
            facet: 'languages',
            value: file.extension?.slice(1) ?? 'No extension',
          },
        ];
      }
      const labels = [
        { facet: 'languages' as const, value: attributes.language },
      ];
      if (
        file.extension &&
        (extensionsByLanguage.get(attributes.language)?.size ?? 0) > 1
      ) {
        labels.push({
          facet: 'languages',
          value: `${attributes.language} (${file.extension.slice(1)})`,
        });
      }
      return labels;
    };
  },
};
