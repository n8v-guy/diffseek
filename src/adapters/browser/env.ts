/** Reads one environment variable. The name stays a variable so index-signature
 * access and dot notation both accept it.
 */
export function envValue(
  env: Record<string, string | undefined>,
  name: string,
): string | undefined {
  return env[name];
}
