import { browser } from 'wxt/browser';

import { isRecord, isUnknownArray } from './record';

const rememberedFilterFacets = ['viewed', 'generated'] as const;

export interface FilterDefaults {
  hidden: Set<RememberedFilterFacet>;
  viewed: Set<DefaultViewedFacet>;
}
export type FilterDefaultState = 'hidden' | 'shown';
export type RememberedFilterFacet =
  (typeof rememberedFilterFacets)[number];
type DefaultViewedFacet = 'generated';

const storageKey = 'diffseek:filter-defaults';

export async function readFilterDefaults(): Promise<FilterDefaults> {
  try {
    return await defaultsFromStorage();
  } catch {
    return emptyDefaults();
  }
}

export async function writeFilterDefaults(
  defaults: FilterDefaults,
): Promise<void> {
  const viewed = defaults.viewed.has('generated') ? ['generated'] : [];
  try {
    await browser.storage.local.set({
      [storageKey]: {
        hidden: [...defaults.hidden],
        viewed,
      },
    });
  } catch {
    return;
  }
}

async function defaultsFromStorage(): Promise<FilterDefaults> {
  const value = (await browser.storage.local.get(storageKey))[storageKey];
  // Unset means never configured. Chrome omits the key; the storage test
  // double returns it as undefined. A present value, even an empty record,
  // is an explicit preference and must not be rewritten here.
  if (value === undefined) return unconfiguredDefaults();
  return storedDefaults(value);
}

function emptyDefaults(): FilterDefaults {
  return { hidden: new Set(), viewed: new Set() };
}

function isRememberedFilterFacet(
  value: unknown,
): value is RememberedFilterFacet {
  return rememberedFilterFacets.some((facet) => facet === value);
}

function storedDefaults(value: unknown): FilterDefaults {
  if (!isRecord(value)) return emptyDefaults();
  const hiddenValue = value.hidden;
  const hidden = new Set(
    isUnknownArray(hiddenValue)
      ? hiddenValue.filter(isRememberedFilterFacet)
      : [],
  );
  // Older records stored mark-as-read only beside always-hide. `viewed`
  // is now the independent auto-view toggle, so that pair is read as
  // generated always-hide plus auto-view, without rewriting storage.
  const viewedValue = value.viewed;
  const viewed = new Set<DefaultViewedFacet>(
    isUnknownArray(viewedValue) && viewedValue.includes('generated')
      ? ['generated']
      : [],
  );
  return { hidden, viewed };
}

/** A fresh install hides viewed and generated files and auto-views generated ones. */
function unconfiguredDefaults(): FilterDefaults {
  return {
    hidden: new Set(rememberedFilterFacets),
    viewed: new Set(['generated']),
  };
}
