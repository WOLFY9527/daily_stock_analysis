import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { enCatalog } from '../catalogs/en';
import { zhCatalog } from '../catalogs/zh';

type CatalogEntry = readonly [key: string, value: string];

const CATALOG_FINGERPRINT = {
  en: { entryCount: 2729, sha256: 'df599e0f4e343904fb8d5dc7695cf7ebf25ddcf9ad51899fc3a076c0cf0987ab' },
  zh: { entryCount: 2729, sha256: '356b18ce02363b6fd3ffeed5fd448d9b8590d48237852895aa33070e83296745' },
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
    }).toEqual(CATALOG_FINGERPRINT);
  });
});
