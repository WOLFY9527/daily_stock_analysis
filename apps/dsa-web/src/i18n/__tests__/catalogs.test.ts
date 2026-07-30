import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { enCatalog } from '../catalogs/en';
import { zhCatalog } from '../catalogs/zh';

type CatalogEntry = readonly [key: string, value: string];

const PRE_CHANGE_CATALOG_BASELINE = {
  en: { entryCount: 2628, sha256: '2ed54c8fbcb70f316558bfa4f7b49028b5d5f728ce7a261734cd401afd7cabee' },
  zh: { entryCount: 2628, sha256: '9ca44e2abe5760ae6cb82de34dfcc7bc221041aef4b418249a92115473d8e2d7' },
} as const;

function collectCatalogEntries(value: unknown, prefix = ''): CatalogEntry[] {
  if (typeof value === 'string') {
    return [[prefix, value]];
  }
  if (!value || typeof value !== 'object') {
    return [];
  }

  return Object.entries(value)
    .flatMap(([key, child]) => collectCatalogEntries(child, prefix ? `${prefix}.${key}` : key));
}

function catalogFingerprint(catalog: unknown) {
  const entries = collectCatalogEntries(catalog).sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  ));
  return {
    entryCount: entries.length,
    sha256: createHash('sha256').update(JSON.stringify(entries)).digest('hex'),
  };
}

describe('locale catalogs', () => {
  it('has the same complete translation key set in Chinese and English', () => {
    expect(collectCatalogEntries(enCatalog).map(([key]) => key).sort())
      .toEqual(collectCatalogEntries(zhCatalog).map(([key]) => key).sort());
  });

  it('preserves every current-main catalog key and value exactly', () => {
    expect({
      en: catalogFingerprint(enCatalog),
      zh: catalogFingerprint(zhCatalog),
    }).toEqual(PRE_CHANGE_CATALOG_BASELINE);
  });
});
