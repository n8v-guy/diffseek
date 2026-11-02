import type { FileLabel } from '../classification/label';
import type { FacetExclusions } from '../filtering/exclusions';

export type ChangeStatus = 'added' | 'deleted' | 'modified' | 'renamed';

export interface FileRecord {
  anchor: `diff-${string}`;
  capabilities: {
    collapse: boolean;
    viewed: boolean;
  };
  extension: null | string;
  generated: boolean;
  labels: FileLabel[];
  owners: string[];
  path: string;
  status: ChangeStatus;
  viewed: boolean;
}

export type FilterState = FacetExclusions;
