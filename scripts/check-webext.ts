#!/usr/bin/env -S node --experimental-strip-types

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { isUnknownArray } from '../src/adapters/browser/record.ts';

const androidMinVersionWarning = 'KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION';
const sourceDirectory = '.output/firefox-mv3';
const webExt = fileURLToPath(
  new URL('../node_modules/web-ext/bin/web-ext.js', import.meta.url),
);

interface LintMessage {
  code: string;
  description: string;
  message: string;
}

function desktopOnlyManifest(): boolean {
  const manifest = parseJson(readFileSync(`${sourceDirectory}/manifest.json`, 'utf8'));
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    !('browser_specific_settings' in manifest)
  ) {
    return false;
  }
  const settings = manifest.browser_specific_settings;
  return (
    typeof settings === 'object' &&
    settings !== null &&
    !('gecko_android' in settings)
  );
}

function fail(stderr: string, heading?: string): void {
  if (heading !== undefined) console.error(heading);
  if (stderr !== '') console.error(stderr);
  process.exitCode = 1;
}

function isLintMessage(value: unknown): value is LintMessage {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'code' in value &&
    typeof value.code === 'string' &&
    'description' in value &&
    typeof value.description === 'string' &&
    'message' in value &&
    typeof value.message === 'string'
  );
}

function lintProblems(report: object): LintMessage[] {
  const errors = 'errors' in report ? messages(report.errors) : [];
  const warnings = 'warnings' in report ? messages(report.warnings) : [];
  const desktopOnly = desktopOnlyManifest();
  return [
    ...errors,
    ...warnings.filter((message) => !toleratedAndroidWarning(message, desktopOnly)),
  ];
}

function main(): void {
  const result = spawnSync(
    process.execPath,
    [webExt, 'lint', '--source-dir', sourceDirectory, '--output', 'json'],
    { cwd: process.cwd(), encoding: 'utf8' },
  );
  const report = parseJson(result.stdout);
  if (typeof report !== 'object' || report === null) {
    fail(result.stderr, 'web-ext lint did not return a report.');
    return;
  }
  const problems = lintProblems(report);
  if (problems.length === 0 && (result.status ?? 1) === 0) return;
  for (const message of problems) {
    console.error(`${message.code}: ${message.message}`);
    console.error(message.description);
  }
  fail(result.stderr);
}

function messages(items: unknown): LintMessage[] {
  if (!isUnknownArray(items)) return [];
  return items.filter((item): item is LintMessage => isLintMessage(item));
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function toleratedAndroidWarning(message: LintMessage, desktopOnly: boolean): boolean {
  // The linter applies gecko.strict_min_version to Android even when
  // gecko_android is omitted. Omission is the desktop-only manifest, and
  // data_collection_permissions is desktop-140 / Android-142.
  return (
    desktopOnly &&
    message.code === androidMinVersionWarning &&
    message.description.includes('data_collection_permissions')
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
