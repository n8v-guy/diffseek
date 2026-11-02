import type { FileRecord, FilterState } from '@diffseek/review';

import { emptyFacetExclusions } from '@diffseek/review';
import { vi } from 'vitest';

import { replaceBody } from '../review-page/test-dom';
import { mountFilterMenu } from './filter-menu';

export const fallbackLabels: FileRecord['labels'] = [
  { facet: 'groups', value: 'No groups' },
  { facet: 'owners', value: 'Unmapped' },
  { facet: 'languages', value: 'No extension' },
  { facet: 'generated', value: 'false' },
  { facet: 'statuses', value: 'modified' },
];

export const files: FileRecord[] = [
  {
    anchor: 'diff-app',
    capabilities: { collapse: true, viewed: true },
    extension: '.ts',
    generated: false,
    labels: [
      { facet: 'groups', value: 'Tests' },
      { facet: 'owners', value: '@owner' },
      { facet: 'languages', value: 'ts' },
      { facet: 'generated', value: 'false' },
      { facet: 'statuses', value: 'modified' },
    ],
    owners: ['@owner'],
    path: 'src/app.test.ts',
    status: 'modified',
    viewed: false,
  },
  {
    anchor: 'diff-docs',
    capabilities: { collapse: true, viewed: true },
    extension: '.md',
    generated: true,
    labels: [
      { facet: 'viewed', value: 'true' },
      { facet: 'groups', value: 'Docs' },
      { facet: 'owners', value: '@docs' },
      { facet: 'languages', value: 'md' },
      { facet: 'generated', value: 'true' },
      { facet: 'statuses', value: 'added' },
    ],
    owners: ['@docs'],
    path: 'docs/guide.md',
    status: 'added',
    viewed: true,
  },
  {
    anchor: 'diff-unmapped',
    capabilities: { collapse: true, viewed: true },
    extension: '.txt',
    generated: false,
    labels: [
      { facet: 'owners', value: 'Unmapped' },
      { facet: 'generated', value: 'false' },
      { facet: 'statuses', value: 'modified' },
    ],
    owners: [],
    path: 'unmapped.txt',
    status: 'modified',
    viewed: false,
  },
];

const sharedOwner = '@team/backend';

export function changeHandler(): ReturnType<typeof vi.fn<() => void>> {
  return vi.fn<() => void>();
}

export function fileAt(index: number): FileRecord {
  const file = files[index];
  if (!file) throw new Error(`Missing fixture ${index}`);
  return file;
}

export function filters(): FilterState {
  return emptyFacetExclusions();
}

export function menu(): HTMLElement {
  replaceBody(`
    <ul role="menu" aria-label="Filter options">
      <li role="menuitemcheckbox" aria-label=".ts">native extension</li>
      <li role="separator">native separator</li>
    </ul>
  `);
  const element = document.querySelector<HTMLElement>('[role="menu"]');
  if (!element) throw new Error('Missing menu fixture');
  return element;
}

export function menuExcludingGroup(value: string): HTMLElement {
  const element = menu();
  const state = filters();
  state.get('groups')?.add(value);
  mountFilterMenu(element, { files, filters: state, onChange: changeHandler() });
  return element;
}

export function viewedHandler(): ReturnType<
  typeof vi.fn<(viewed: boolean, paths: string[]) => void>
> {
  return vi.fn<(viewed: boolean, paths: string[]) => void>();
}

export function withoutGenerated(records: readonly FileRecord[]): FileRecord[] {
  return records.map((file) => ({
    ...file,
    generated: false,
    labels: file.labels.filter(
      (label) => label.facet !== 'generated' || label.value === 'false',
    ),
  }));
}

export function withSecondOwner(second: string): FileRecord[] {
  return files.map((file, index) => ({
    ...file,
    labels: file.labels.map((label) =>
      label.facet === 'owners' && label.value !== 'Unmapped'
        ? { ...label, value: index === 0 ? sharedOwner : second }
        : label,
    ),
  }));
}
