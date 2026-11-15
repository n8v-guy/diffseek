import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { manifestIcons, renderIcons } from './icons';

describe('extension icons', () => {
  it('renders every manifest icon at its size', async () => {
    const files = await renderIcons(await mkdtemp(join(tmpdir(), 'icons-')));
    expect(files.map(({ relativeDest }) => relativeDest)).toEqual(
      Object.values(manifestIcons),
    );
    for (const [size, path] of Object.entries(manifestIcons)) {
      const file = files.find(({ relativeDest }) => relativeDest === path);
      const png = await readFile(file?.absoluteSrc ?? '');
      // A PNG's IHDR chunk holds the width and height at bytes 16 and 20.
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([
        Number(size),
        Number(size),
      ]);
    }
  });
});
