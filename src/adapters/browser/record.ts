export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/** A named field of a string-keyed record. The key stays a variable so both
 * index-signature access and dot-notation rules accept it.
 */
export function recordField(
  record: Record<string, unknown>,
  key: string,
): unknown {
  return record[key];
}
