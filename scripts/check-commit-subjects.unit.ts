import { describe, expect, it } from 'vitest';

import { findSubjectViolation } from './check-commit-subjects';

describe('commit subjects', () => {
  it('accepts one line and ignores the trailing newline', () => {
    expect(findSubjectViolation('Add mechanical quality gates\n')).toBeUndefined();
  });

  it('rejects an empty subject', () => {
    expect(findSubjectViolation('\n')).toBe('empty subject');
  });

  it('rejects a body or a trailer', () => {
    expect(findSubjectViolation('Add gates\n\nMore detail\n')).toBe(
      'subject must be a single line',
    );
  });
});
