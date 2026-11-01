#!/usr/bin/env -S node --experimental-strip-types

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  buildNumber,
  buildNumberEnv,
  buildNumberFile,
  gitHeadCount,
  readBuildNumberFile,
} from '../config/manifest-version.ts';

function main(): void {
  // Git before the file: a checkout refreshes a stale build-number.
  const count = buildNumber([
    process.env[buildNumberEnv],
    gitHeadCount(),
    readBuildNumberFile(),
  ]);
  writeFileSync(buildNumberFile, `${count}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
