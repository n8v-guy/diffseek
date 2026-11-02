import { isUnknownArray } from '@diffseek/browser/record';

export interface CookieLike {
  domain: string;
  expires?: number;
  httpOnly?: boolean;
  name: string;
  path?: string;
  sameSite?: 'Lax' | 'None' | 'Strict';
  secure?: boolean;
  value: string;
}

/** Cursor/GitHub secrets inject JSON; local runs usually pass a file path. */
export function isInlineStorageState(source: string): boolean {
  return source.trimStart().startsWith('{');
}

export function parseInlineStorageState(source: string): unknown {
  return JSON.parse(source);
}

export function parseStorageCookies(raw: unknown): CookieLike[] {
  const cookies = isRecord(raw) ? raw['cookies'] : undefined;
  if (!isUnknownArray(cookies)) {
    throw new Error('storageState JSON must include a cookies array');
  }
  return cookies.map((cookie, index) => readCookie(cookie, index));
}

const sameSites = ['Lax', 'None', 'Strict'] as const;

function cookieIdentity(
  cookie: Record<string, unknown>,
  index: number,
): { name: string; value: string } {
  const name = cookie['name'];
  const value = cookie['value'];
  if (typeof name !== 'string' || typeof value !== 'string') {
    throw new TypeError(`storageState cookies[${String(index)}] is missing name/value`);
  }
  return { name, value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function optionalSameSite(value: unknown): CookieLike['sameSite'] {
  if (typeof value !== 'string') return undefined;
  return sameSites.find((site) => site === value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readCookie(cookie: unknown, index: number): CookieLike {
  if (!isRecord(cookie)) {
    throw new Error(`storageState cookies[${String(index)}] is invalid`);
  }
  const identity = cookieIdentity(cookie, index);
  const domain = cookie['domain'];
  if (typeof domain !== 'string') {
    throw new TypeError(`storageState cookies[${String(index)}] is missing domain`);
  }
  const expires = optionalNumber(cookie['expires']);
  const httpOnly = optionalBoolean(cookie['httpOnly']);
  const path = optionalString(cookie['path']);
  const sameSite = optionalSameSite(cookie['sameSite']);
  const secure = optionalBoolean(cookie['secure']);
  return {
    domain,
    name: identity.name,
    value: identity.value,
    ...(expires !== undefined && { expires }),
    ...(httpOnly !== undefined && { httpOnly }),
    ...(path !== undefined && { path }),
    ...(sameSite !== undefined && { sameSite }),
    ...(secure !== undefined && { secure }),
  };
}
