import type { FacetExclusions, FileLabel } from '../classification/label';

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export type FileRecord = {
  path: string;
  anchor: `diff-${string}`;
  extension: string | null;
  owners: string[];
  generated: boolean;
  status: ChangeStatus;
  viewed: boolean;
  capabilities: {
    collapse: boolean;
    viewed: boolean;
  };
  labels: FileLabel[];
};

export type FilterState = FacetExclusions;
