import { selectNonregionalFactors } from '@/services/lciaMethods/nonregional';
import { calculateStaticLcia } from '@/services/lciaMethods/calculation';
import { STATIC_LCIA_CACHE_MANIFEST as manifest } from '@/services/lciaMethods/evidence';
import type { LciaFlowFactorMap } from '@/services/lciaMethods/data';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash, webcrypto } from 'node:crypto';
import defaults from '../../../../public/lciamethods/nonregional_defaults.json';

const ammonia = '08a91e70-3ddc-11dd-96ae-0050c2490048';
const acidification = 'b5c611c6-def3-11e6-bf01-fe55135034f3';
const climate = '6209b35f-9447-40b5-b68c-a1099e3674a0';
const co2 = '08a91e70-3ddc-11dd-9c14-0050c2490048';
const version = '03.00.004';
const factors: LciaFlowFactorMap = JSON.parse(
  gunzipSync(readFileSync('public/lciamethods/flow_factors.json.gz')).toString(),
);
const listData = JSON.parse(readFileSync('public/lciamethods/list.json', 'utf8'));
const proof = {
  observedListSha256: manifest.files.list.sha256,
  observedFactorSha256: manifest.files.factors.sha256,
};
const exchange = (id: string, amount: string, overrides = {}) =>
  ({
    referenceToFlowDataSet: { '@refObjectId': id, '@version': version },
    exchangeDirection: 'OUTPUT',
    meanAmount: amount,
    ...overrides,
  }) as any;

beforeAll(() =>
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto }),
);

it('uses the byte-identical Worker source mapping for every exact factor family', () => {
  expect(
    createHash('sha256')
      .update(readFileSync('public/lciamethods/nonregional_defaults.json'))
      .digest('hex'),
  ).toBe('d5ed7b76d96aa6640371fdba12076e129240e01f11e360d374b65fb89f9c3373');
  const counts = new Map<string, number>();
  for (const [key, group] of Object.entries(factors)) {
    const [flowId, direction] = key.split(':');
    const byMethod = new Map<string, NonNullable<typeof group.factor>>();
    for (const entry of group.factor!)
      byMethod.set(entry.key, [...(byMethod.get(entry.key) ?? []), entry]);
    for (const [method, entries] of byMethod) {
      const selected = selectNonregionalFactors(
        method,
        flowId,
        group['@version']!,
        direction,
        entries,
      );
      if (selected?.length !== 1) throw new Error(`Invalid default: ${method}:${key}`);
      counts.set(method, (counts.get(method) ?? 0) + 1);
    }
  }
  expect(Object.fromEntries(counts)).toEqual(
    Object.fromEntries(defaults.methods.map((method) => [method.method_id, method.default_count])),
  );
});

it.each([{}, { location: 'DE' }])(
  'calculates sparse NH3/CO2 methods without requiring location: %s',
  async (location) => {
    const result = await calculateStaticLcia({
      exchanges: [exchange(ammonia, '1', location), exchange(co2, '1')],
      listData,
      factors,
      ...proof,
    });
    expect(result.results.find((row) => row.key === acidification)?.meanAmount).toBe('3.02');
    expect(result.results.find((row) => row.key === climate)?.meanAmount).toBe('1');
  },
);

it.each(['02.00.000', '', undefined])(
  'does not borrow another exact Flow version: %s',
  async (otherVersion) => {
    const result = await calculateStaticLcia({
      exchanges: [
        exchange(ammonia, '1', {
          referenceToFlowDataSet: { '@refObjectId': ammonia, '@version': otherVersion },
        }),
        exchange(co2, '1'),
      ],
      listData,
      factors,
      ...proof,
    });
    expect(result.results.find((row) => row.key === acidification)).toBeUndefined();
    expect(result.results.find((row) => row.key === climate)?.meanAmount).toBe('1');
  },
);

it.each([
  ['0', '0'],
  ['-2', '-6.04'],
  ['1e-20', '3.02e-20'],
])('retains zero, negative and small amounts: %s', async (amount, expected) => {
  const result = await calculateStaticLcia({
    exchanges: [exchange(ammonia, amount)],
    listData,
    factors,
    ...proof,
  });
  expect(result.results.find((row) => row.key === acidification)?.meanAmount).toBe(expected);
});

it('rejects prepared-source count or value drift and retains unique/absent coefficients', () => {
  const entries = factors[`${ammonia}:OUTPUT`].factor!.filter(
    (entry) => entry.key === acidification,
  );
  expect(
    selectNonregionalFactors(acidification, ammonia, version, 'OUTPUT', entries.slice(1)),
  ).toBeNull();
  expect(
    selectNonregionalFactors(
      acidification,
      ammonia,
      version,
      'OUTPUT',
      entries.map((entry) => ({ ...entry, value: '999' })),
    ),
  ).toBeNull();
  expect(selectNonregionalFactors('other', ammonia, version, 'INPUT', entries)).toBeNull();
  expect(selectNonregionalFactors('other', ammonia, version, 'INPUT', entries.slice(0, 1))).toEqual(
    entries.slice(0, 1),
  );
  expect(selectNonregionalFactors(acidification, ammonia, version, 'OUTPUT', [])).toEqual([]);
});
