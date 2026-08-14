import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { enCatalog } from '../catalogs/en';
import { zhCatalog } from '../catalogs/zh';

type CatalogEntry = readonly [key: string, value: string];

const PRE_CHANGE_CATALOG_BASELINE = {
  en: { entryCount: 2629, sha256: '60e7c1cfdd1be516174f8029470f84fd04d7acbe843d5ef950107e218cac6d30' },
  zh: { entryCount: 2629, sha256: '9f70fa9d174311028704caa7b93d53bdf7ba922415abdd04a899134e2b72ac92' },
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
