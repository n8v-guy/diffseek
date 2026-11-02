import path from 'node:path';

const prUrl = 'https://github.com/sha-tm/diffseek-test-data/pull/2';
export const changesUrl = `${prUrl}/changes?new_files_changed=true`;
export const compareUrl =
  'https://github.com/sha-tm/diffseek-test-data/compare/7cf6ff089a...showcase/acme-base';
// Lines kept on GitHub's compare page; the rest of each file is folded away.
export const sourceLines: Record<string, number[]> = {
  '.gitattributes': [3, 4, 5, 6, 7, 19, 20, 21, 22, 23, 25, 26, 27],
  CODEOWNERS: [9, 10, 11],
};

export interface FilterDefaults { hidden: string[]; viewed: string[] }
// Filter defaults with auto-view off, so a fresh profile leaves the PR's
// viewed state alone. Shot 1 skips this and shows the real first run.
export const quietDefaults: FilterDefaults = {
  hidden: ['viewed', 'generated'],
  viewed: [],
};

export const scale = 1.5;
export const viewport = { height: 1000, width: 1080 };
export const outWidth = 1280;
export const outHeight = 800;
// Callout color for annotated shots.
export const accent = '#d9480f';
export const clipWidth = outWidth / scale;
export const clipHeight = outHeight / scale;
export const extensionPath = path.resolve(
  process.env['EXTENSION_PATH'] ?? '.output/chrome-mv3',
);
export const shotDir = path.resolve(process.env['SHOT_DIR'] ?? 'screenshots/store');
export const totalFiles = 82;
// The demo PR's resting state: exactly these files viewed, 12/82.
export const baseline = [
  'web/src/app/App.tsx',
  'web/src/app/routes.tsx',
  'web/src/checkout/CheckoutPage.tsx',
  'web/src/checkout/PaymentStep.tsx',
  'web/src/checkout/hooks/useCheckout.ts',
  'web/src/components/layout/CheckoutLayout.tsx',
  'web/src/components/ui/Modal.tsx',
  'web/src/lib/analytics.ts',
  'web/src/types/checkout.ts',
  'web/src/types/order.ts',
  'web/config/app.yaml',
  'web/config/routes.yaml',
];

export const shots: [string, string][] = [
  ['01-noise-cut.png', 'Hidden by default, and generated files viewed for you.'],
  ['02-only.png', 'Before and after “only”: the tree keeps what is left.'],
  ['03-viewed-badges.png', 'Tree badges and menu badges.'],
  ['04-sources.png', 'Categories come from CODEOWNERS and .gitattributes.'],
];

export const menuSelector = '[data-diffseek="filters"]';
export const snackbarSelector = '[data-diffseek="snackbar"]';
export const viewedActionSelector = '[data-diffseek-viewed-action]';
export const treeItemSelector = '[role="treeitem"]';

/** A box on the 1280x800 output canvas. */
export interface Box { h: number; w: number; x: number; y: number; }
/** A page region to keep. `zoom` overrides `scale` for this region. */
export type Clip = Rect & { zoom?: number };
/** A box in page CSS pixels, as Playwright reports it. */
export interface Rect { height: number; width: number; x: number; y: number; }
export interface Shot { clip: Clip; height: number; png: string; width: number; }
