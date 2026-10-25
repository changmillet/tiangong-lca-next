import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import BigNumber from 'bignumber.js';
import { classifyLciaInventory } from '@/services/lciaMethods/inventory';
import { LCIAResultCalculationWithEvidence } from '@/services/lciaMethods/util';
import { genLifeCycleModelProcesses } from '@/services/lifeCycleModels/util_calculate';
import {
  parseStaticLciaReport,
  serializeStaticLciaReport,
  STATIC_LCIA_CACHE_MANIFEST,
} from '@/services/lciaMethods/evidence';
import {
  calculateStaticLcia,
  persistableStaticLciaResults,
} from '@/services/lciaMethods/calculation';
import {
  exchangeFactorLocation,
  loadSupportedMethodFactors,
  SUPPORTED_SOURCE_POLICY_MANIFEST_SHA256,
} from '@/services/lciaMethods/supportedSourcePolicy';

const mockCacheEntries = new Map<string, unknown>();
const mockGetFlowProperties = jest.fn();
const mockReadProcesses = jest.fn();
jest.mock('@/services/flows/api', () => ({
  getFlowProperties: (...args: unknown[]) => mockGetFlowProperties(...args),
}));
jest.mock('@/services/supabase/public', () => ({
  publicEntity: () => ({
    select: () => ({ or: (...args: unknown[]) => mockReadProcesses(...args) }),
  }),
}));
jest.mock('@/services/general/browserResourceCache', () => ({
  initIndexedDbStore: async () => ({}),
  getCachedJsonEntry: async (_db: unknown, _store: string, filename: string) =>
    mockCacheEntries.get(filename) ?? null,
  decompressGzipData: async (bytes: ArrayBuffer) =>
    jest.requireActual('node:zlib').gunzipSync(Buffer.from(bytes)).toString('utf8'),
}));

const root = path.resolve(__dirname, '../../../../public');
const originalFactors = JSON.parse(
  gunzipSync(readFileSync(path.join(root, 'lciamethods/flow_factors.json.gz'))).toString('utf8'),
);
const listData = JSON.parse(readFileSync(path.join(root, 'lciamethods/list.json'), 'utf8'));
const climate = '7fce5b3a-66b8-4ce1-91e8-a925aee1f186';
const acidification = 'b5c611c6-def3-11e6-bf01-fe55135034f3';
const co2 = '08a91e70-3ddc-11dd-923d-0050c2490048';
const ammonia = '08a91e70-3ddc-11dd-a2a9-0050c2490048';
const sourceProof = {
  observedListSha256: STATIC_LCIA_CACHE_MANIFEST.files.list.sha256,
  observedFactorSha256: STATIC_LCIA_CACHE_MANIFEST.files.factors.sha256,
};
let tamperedAsset: string | null = null;

function exchange(flow = co2, location?: string, amount = '1', version = '03.00.004') {
  return {
    '@dataSetInternalID': 'source-backed-observation',
    referenceToFlowDataSet: { '@refObjectId': flow, '@version': version },
    exchangeDirection: 'Output',
    meanAmount: amount,
    ...(location !== undefined ? { location } : {}),
  };
}

describe('shipped source policy matches the Worker source selector', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
    global.fetch = jest.fn(async (url: string | URL | Request) => {
      const requested = typeof url === 'string' ? url : String(url);
      const relative = requested.split('?')[0].replace(/^\//, '');
      const original = readFileSync(path.join(root, relative));
      const bytes =
        tamperedAsset && relative.endsWith(tamperedAsset)
          ? Buffer.concat([original, Buffer.from('\nchanged')])
          : original;
      return {
        ok: true,
        arrayBuffer: async () =>
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      } as Response;
    });
  });

  beforeEach(() => {
    mockGetFlowProperties.mockReset();
    mockReadProcesses.mockReset();
    mockCacheEntries.set('list.json', { data: listData, sha256: sourceProof.observedListSha256 });
    mockCacheEntries.set('flow_factors.json.gz', {
      data: originalFactors,
      sha256: sourceProof.observedFactorSha256,
    });
  });

  afterEach(() => {
    tamperedAsset = null;
  });

  it('refuses a manifest changed before it can authorize any default', async () => {
    tamperedAsset = 'manifest.json';
    await expect(loadSupportedMethodFactors(climate, originalFactors)).rejects.toThrow(
      'lcia_supported_policy_asset_hash_mismatch',
    );
  });

  it('selects the original climate factor for absent and named exchange locations without proof', async () => {
    const factors = await loadSupportedMethodFactors(climate, originalFactors);
    for (const location of [undefined, '', 'CN']) {
      expect(
        factors.select(co2, '03.00.004', 'OUTPUT', exchangeFactorLocation(location)),
      ).toMatchObject({
        status: 'selected',
        reason: 'reviewed_source_generic_default',
        value: '1.0',
        source_record_index: 954,
        source_xml_sha256: '7925c8ad33f804723fee7a808d8bf98c8ecdca9b47a5d6f732e415137ac58991',
      });
    }
    expect(SUPPORTED_SOURCE_POLICY_MANIFEST_SHA256).toBe(
      '2ddb0fe715a2b6647246dd443f4fe417868683ca67bbea29c1a81ee7b955142d',
    );
  });

  it('retains globally qualified original CO2 N2O and fossil methane defaults without a location', async () => {
    const factors = await loadSupportedMethodFactors(climate, originalFactors);
    for (const [flow, value] of [
      [co2, '1.0'],
      ['08a91e70-3ddc-11dd-94c3-0050c2490048', '273.0'],
      ['08a91e70-3ddc-11dd-9610-0050c2490048', '29.8'],
    ] as const) {
      for (const location of [undefined, '', 'CN']) {
        expect(
          factors.select(flow, '03.00.004', 'OUTPUT', exchangeFactorLocation(location)),
        ).toMatchObject({
          status: 'selected',
          value,
        });
      }
    }
  });

  it('matches Worker NH3 generic 3.02, DE 4.0 and exact version refusal', async () => {
    const factors = await loadSupportedMethodFactors(acidification, originalFactors);
    for (const [location, value, index] of [
      ['RER', '3.02', 211],
      ['DE', '4.0', 574],
    ] as const) {
      expect(
        factors.select(ammonia, '03.00.004', 'OUTPUT', exchangeFactorLocation(location)),
      ).toMatchObject({
        status: 'selected',
        value,
        source_record_index: index,
      });
    }
    for (const location of [
      { kind: 'missing' },
      { kind: 'blank' },
      { kind: 'unknown' },
      { kind: 'code', value: 'BR' },
      { kind: 'code', value: 'CN' },
      { kind: 'code', value: 'unrecognized-region' },
      { kind: 'code', value: 'DE-unreviewed-alias' },
    ] as const) {
      expect(factors.select(ammonia, '03.00.004', 'OUTPUT', location)).toEqual({
        status: 'unsupported',
        reason: 'lcia_generic_location_not_admitted',
        value: null,
      });
    }
    expect(
      factors.select(ammonia, '03.00.003', 'OUTPUT', exchangeFactorLocation(undefined)),
    ).toEqual({
      status: 'unsupported',
      reason: 'lcia_factor_flow_version_mismatch',
      value: null,
    });
    expect(
      factors.select(ammonia, '03.00.004', 'INPUT', exchangeFactorLocation(undefined)).status,
    ).not.toBe('selected');
  });

  it('preserves an explicitly selected original zero factor', async () => {
    const factors = await loadSupportedMethodFactors(climate, originalFactors);
    expect(
      factors.select(
        'e99843b7-e598-447a-ab73-d01f179f0f8c',
        '01.00.002',
        'INPUT',
        exchangeFactorLocation(undefined),
      ),
    ).toMatchObject({
      status: 'selected',
      value: '0.0',
    });
  });

  it('verifies every one of the 319575 original numeric bindings across all supported methods', async () => {
    let factorCount = 0;
    for (const method of STATIC_LCIA_CACHE_MANIFEST.methods) {
      await expect(
        loadSupportedMethodFactors(method.method_id, originalFactors),
      ).resolves.toBeDefined();
      factorCount += method.factor_entry_count;
    }
    expect(factorCount).toBe(319575);
  });

  it('refuses changed companion bytes and numeric/version drift in an allegedly verified map', async () => {
    tamperedAsset = `${climate}.json.gz`;
    await expect(loadSupportedMethodFactors(climate, { ...originalFactors })).rejects.toThrow(
      'lcia_supported_policy_asset_hash_mismatch',
    );
    tamperedAsset = null;
    for (const change of ['version', 'value']) {
      const key = `${co2}:OUTPUT`;
      const group = originalFactors[key];
      const changed = {
        ...originalFactors,
        [key]: {
          ...group,
          ...(change === 'version' ? { '@version': '03.00.003' } : {}),
          factor: group.factor!.map((factor: { key: string; value: string | number }) =>
            factor.key === climate && change === 'value' ? { ...factor, value: '999' } : factor,
          ),
        },
      };
      await expect(loadSupportedMethodFactors(climate, changed)).rejects.toThrow(
        'lcia_supported_policy_static_numeric_binding_mismatch',
      );
    }
  });

  it('retains independent categories and never emits a partial category as zero or a stale subtotal', async () => {
    const calculated = await calculateStaticLcia({
      exchanges: [exchange(ammonia, 'DE')],
      listData,
      factors: originalFactors,
      ...sourceProof,
    });
    const acid = calculated.results.find((row) => row.key === acidification)!;
    expect(acid).toMatchObject({ meanAmount: '4', status: 'available', reasons: [] });
    const missing = calculated.results.filter((row) => row.status === 'unavailable');
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.every((row) => row.meanAmount === null && row.reasons!.length > 0)).toBe(true);
    expect(calculated.report.lcia_availability?.completeness).toBe('partial');
    expect(
      parseStaticLciaReport(serializeStaticLciaReport(calculated.report))?.lcia_availability,
    ).toEqual(calculated.report.lcia_availability);
    expect(calculated.report.source.source_policy_manifest_sha256).toBe(
      SUPPORTED_SOURCE_POLICY_MANIFEST_SHA256,
    );
    const scientific = persistableStaticLciaResults(calculated);
    expect(scientific.some((row) => row.key === acidification && row.meanAmount === '4')).toBe(
      true,
    );
    expect(
      scientific.every(
        (row) => row.meanAmount !== null && row.status === undefined && row.reasons === undefined,
      ),
    ).toBe(true);
    expect(
      scientific.some((row) => missing.some((unavailable) => unavailable.key === row.key)),
    ).toBe(false);
  });

  it('propagates restricted generic geographic refusal as unavailable, while literal RER remains qualified', async () => {
    for (const location of [undefined, '', 'BR', 'CN', 'unrecognized-region']) {
      const calculated = await calculateStaticLcia({
        exchanges: [exchange(ammonia, location)],
        listData,
        factors: originalFactors,
        ...sourceProof,
      });
      expect(calculated.results.find((row) => row.key === acidification)).toMatchObject({
        meanAmount: null,
        status: 'unavailable',
        reasons: ['lcia_generic_location_not_admitted'],
      });
      expect(
        parseStaticLciaReport(
          serializeStaticLciaReport(calculated.report),
        )?.lcia_availability?.categories.find((row) => row.method_id === acidification)?.status,
      ).toBe('unavailable');
    }
    const scoped = await calculateStaticLcia({
      exchanges: [exchange(ammonia, 'RER')],
      listData,
      factors: originalFactors,
      ...sourceProof,
    });
    expect(scoped.results.find((row) => row.key === acidification)).toMatchObject({
      meanAmount: '3.02',
      status: 'available',
    });
  });

  it('does not double the C coefficient for one generic source record shared across contexts', async () => {
    const calculated = await calculateStaticLcia({
      exchanges: [exchange(co2), exchange(co2, 'CN')],
      listData,
      factors: originalFactors,
      ...sourceProof,
    });
    expect(calculated.results.find((row) => row.key === climate)).toMatchObject({
      meanAmount: '2',
      status: 'available',
    });
    const mixedRegions = await calculateStaticLcia({
      exchanges: [exchange(ammonia, 'RER'), exchange(ammonia, 'DE')],
      listData,
      factors: originalFactors,
      ...sourceProof,
    });
    expect(mixedRegions.results.find((row) => row.key === acidification)).toMatchObject({
      meanAmount: null,
      status: 'unavailable',
      reasons: ['lcia_mixed_location_axis_unsupported'],
    });
  });
  it('classifies the actual generated Process inventory before selecting source-bound CFs', async () => {
    const product = '00000000-0000-0000-0000-000000000001';
    const productInput = '00000000-0000-0000-0000-000000000002';
    const wasteInput = '00000000-0000-0000-0000-000000000003';
    const wasteOutput = '00000000-0000-0000-0000-000000000004';
    const processId = '00000000-0000-0000-0000-000000000009';
    const raw = [
      { ...exchange(product), '@dataSetInternalID': 'p' },
      { ...exchange(co2), '@dataSetInternalID': 'co2' },
      {
        ...exchange(productInput),
        '@dataSetInternalID': 'product-input',
        exchangeDirection: 'Input',
      },
      { ...exchange(wasteInput), '@dataSetInternalID': 'waste-input', exchangeDirection: 'Input' },
      { ...exchange(wasteOutput), '@dataSetInternalID': 'waste-output' },
    ];
    const original = JSON.stringify(raw);
    mockReadProcesses.mockResolvedValue({
      data: [
        {
          id: processId,
          version: '01.00.000',
          exchange: raw,
          quantitativeReference: { referenceToReferenceFlow: 'p' },
        },
      ],
    });
    mockGetFlowProperties.mockImplementation(async (refs: { id: string; version: string }[]) => ({
      success: true,
      data: refs.map((ref) => ({
        ...ref,
        typeOfDataSet:
          ref.id === co2
            ? 'Elementary flow'
            : ref.id === product || ref.id === productInput
              ? 'Product flow'
              : 'Waste flow',
      })),
    }));
    const model = {
      lifeCycleModelDataSet: {
        lifeCycleModelInformation: {
          quantitativeReference: { referenceToReferenceProcess: 'node0' },
          dataSetInformation: {
            name: { baseName: [{ '@xml:lang': 'en', '#text': 'Synthetic source-backed process' }] },
          },
          technology: {
            processes: {
              processInstance: [
                {
                  '@dataSetInternalID': 'node0',
                  referenceToProcess: { '@refObjectId': processId, '@version': '01.00.000' },
                },
              ],
            },
          },
        },
      },
    };
    const generated = await genLifeCycleModelProcesses(
      'synthetic-model',
      [
        {
          id: 'node0',
          data: {
            index: 'node0',
            quantitativeReference: '1',
            targetAmount: 1,
          },
        },
      ],
      model,
      [],
    );
    const primary = generated.lifeCycleModelProcesses.find(
      (row) => row.modelInfo.type === 'primary',
    )!;
    const persisted = primary.data.processDataSet.LCIAResults;
    expect(
      persisted.LCIAResult.find(
        (row: any) => row.referenceToLCIAMethodDataSet['@refObjectId'] === climate,
      ),
    ).toMatchObject({ meanAmount: '1' });
    const report = parseStaticLciaReport(persisted['common:other'])!;
    expect(report.inventory_classification).toMatchObject({
      exchange_count: 5,
      elementary_exchange_count: 1,
      non_elementary_exchange_count: 4,
      unresolved_exchange_count: 0,
    });
    expect(
      report.lcia_availability?.categories.find((row) => row.method_id === climate)?.status,
    ).toBe('available');
    expect(primary.data.processDataSet.exchanges.exchange).toHaveLength(5);
    expect(JSON.stringify(raw)).toBe(original);
    expect(mockGetFlowProperties).toHaveBeenCalledTimes(1);
    expect(mockGetFlowProperties.mock.calls[0][0]).toHaveLength(5);
  });

  it('returns known zero for a classified inventory with only product/waste and round-trips the report', async () => {
    const product = '00000000-0000-0000-0000-000000000001';
    const waste = '00000000-0000-0000-0000-000000000002';
    const calculated = await LCIAResultCalculationWithEvidence(
      [exchange(product), exchange(waste)],
      {
        flowMetadata: [
          { id: product, version: '03.00.004', typeOfDataSet: 'Product flow' },
          { id: waste, version: '03.00.004', typeOfDataSet: 'Waste flow' },
        ],
      },
    );
    expect(calculated.results).toHaveLength(25);
    expect(
      calculated.results.every((row) => row.meanAmount === '0' && row.status === 'available'),
    ).toBe(true);
    expect(calculated.report.calculation_status).toBe('complete');
    const parsed = parseStaticLciaReport(serializeStaticLciaReport(calculated.report));
    expect(parsed?.lcia_availability?.completeness).toBe('complete');
    expect(parsed?.inventory_classification).toMatchObject({
      elementary_exchange_count: 0,
      unresolved_exchange_count: 0,
    });
    expect(mockGetFlowProperties).not.toHaveBeenCalled();
    const withoutReceipt = JSON.parse(JSON.stringify(calculated.report));
    delete withoutReceipt.inventory_classification;
    expect(parseStaticLciaReport(serializeStaticLciaReport(withoutReceipt))).toBeNull();
    const unknownEmpty = await calculateStaticLcia({
      exchanges: [],
      listData,
      factors: originalFactors,
      ...sourceProof,
    });
    expect(unknownEmpty.results).toEqual([]);
    expect(unknownEmpty.report.calculation_status).toBe('calculation_failure');
    expect(
      parseStaticLciaReport(serializeStaticLciaReport(unknownEmpty.report))?.calculation_status,
    ).toBe('calculation_failure');
  });

  it('does not drop a possibly elementary exchange when exact Flow classification cannot be established', async () => {
    mockGetFlowProperties.mockResolvedValue({
      success: true,
      data: [{ id: co2, version: '03.00.005', typeOfDataSet: 'Product flow' }],
    });
    const calculated = await LCIAResultCalculationWithEvidence([exchange(co2)]);
    expect(calculated.results).toEqual([]);
    expect(calculated.report.calculation_status).toBe('calculation_failure');
    expect(calculated.report.failure_reason).toBe('lcia_inventory_flow_classification_unresolved');
    expect(calculated.report.inventory_classification?.unresolved_exchange_count).toBe(1);
    expect(
      parseStaticLciaReport(serializeStaticLciaReport(calculated.report))?.calculation_status,
    ).toBe('calculation_failure');
  });
  it('keeps invalid reference/direction/version inputs out of numeric characterization', async () => {
    const ambiguous = {
      ...exchange(),
      referenceToFlowDataSet: [
        exchange().referenceToFlowDataSet,
        exchange(ammonia).referenceToFlowDataSet,
      ],
    };
    const invalidVersion = {
      ...exchange(),
      referenceToFlowDataSet: { '@refObjectId': co2, '@version': 'latest' },
    };
    for (const rows of [
      [ambiguous],
      [invalidVersion],
      [exchange(), { ...exchange(), exchangeDirection: 'Input' }],
    ]) {
      const calculated = await calculateStaticLcia({
        exchanges: rows,
        listData,
        factors: originalFactors,
        ...sourceProof,
      });
      expect(
        calculated.results.every((row) => row.meanAmount === null && row.status === 'unavailable'),
      ).toBe(true);
      expect(parseStaticLciaReport(serializeStaticLciaReport(calculated.report))).not.toBeNull();
    }
    const source = await loadSupportedMethodFactors(climate, originalFactors);
    expect(source.select(co2, 'latest', 'OUTPUT', { kind: 'missing' }).reason).toBe(
      'lcia_inventory_flow_version_invalid',
    );
    expect(
      source.select('00000000-0000-0000-0000-000000009999', '03.00.004', 'OUTPUT', {
        kind: 'missing',
      }).reason,
    ).toBe('no_lcia_factor_for_flow_direction');
    for (const value of [null, 42, 'x'.repeat(257)]) {
      expect(exchangeFactorLocation(value)).toEqual({ kind: 'invalid' });
      expect(
        source.select(co2, '03.00.004', 'OUTPUT', exchangeFactorLocation(value)).value,
      ).toBeNull();
    }
    expect(
      source.select(co2, '03.00.004', 'OUTPUT', { kind: 'code', value: ' ' }).value,
    ).toBeNull();
  });

  it('does not let zero observations poison a category or duplicate its accumulated burden', async () => {
    const zeros = await calculateStaticLcia({
      exchanges: [exchange(co2, undefined, '0'), exchange(co2, 'CN', '0')],
      listData,
      factors: originalFactors,
      ...sourceProof,
    });
    expect(zeros.results.every((row) => row.meanAmount === '0' && row.status === 'available')).toBe(
      true,
    );
    const combined = await calculateStaticLcia({
      exchanges: [exchange(co2), exchange(co2, undefined, '0')],
      listData,
      factors: originalFactors,
      ...sourceProof,
    });
    expect(combined.results.find((row) => row.key === climate)).toMatchObject({
      meanAmount: '1',
      status: 'available',
    });
    expect(parseStaticLciaReport(serializeStaticLciaReport(combined.report))).not.toBeNull();
  });

  it('refuses numerical dependency overflow instead of retaining partial category subtotals', async () => {
    const previous = BigNumber.config();
    try {
      BigNumber.config({ RANGE: 1 });
      const calculated = await calculateStaticLcia({
        exchanges: [exchange('08a91e70-3ddc-11dd-94c3-0050c2490048')],
        listData,
        factors: originalFactors,
        ...sourceProof,
      });
      expect(calculated.results).toEqual([]);
      expect(calculated.report.failure_reason).toBe('lcia_supported_policy_static_record_invalid');
    } finally {
      BigNumber.config(previous);
    }
  });

  it('rejects policy/axis/classification replay before a stored report can confer current availability', async () => {
    const calculated = await calculateStaticLcia({
      exchanges: [exchange()],
      listData,
      factors: originalFactors,
      ...sourceProof,
    });
    for (const mutate of [
      (report: any) => {
        report.source.applicability_policy_version = 'lcia.applicability.source-bound.v2';
      },
      (report: any) => {
        delete report.source.applicability_policy_version;
      },
      (report: any) => {
        report.source.source_policy_manifest_sha256 = '0'.repeat(64);
      },
      (report: any) => {
        report.lcia_availability.categories[0].method_version = '99.99.999';
      },
      (report: any) => {
        report.lcia_availability.categories.pop();
      },
      (report: any) => {
        report.inventory_classification = { schema_version: 'unsupported' };
      },
    ]) {
      const report = JSON.parse(JSON.stringify(calculated.report));
      mutate(report);
      expect(parseStaticLciaReport(serializeStaticLciaReport(report))).toBeNull();
    }
    const other = await classifyLciaInventory(
      [exchange(), exchange()],
      [{ id: co2, version: '03.00.004', typeOfDataSet: 'Elementary flow' }],
    );
    expect(
      parseStaticLciaReport(
        serializeStaticLciaReport({
          ...calculated.report,
          inventory_classification: other.receipt,
        }),
      ),
    ).toBeNull();
  });
  it('retains singleton container semantics and identifier fallback without using labels as applicability', async () => {
    const key = Object.keys(originalFactors).find(
      (key) => originalFactors[key].factor.length === 1,
    )!;
    const group = originalFactors[key];
    const observations = [
      {
        ...exchange(group['@refObjectId'], undefined, '1', group['@version']),
        exchangeDirection: group.exchangeDirection,
      },
    ];
    const baseline = await calculateStaticLcia({
      exchanges: observations,
      listData,
      factors: originalFactors,
      ...sourceProof,
    });
    const singleton = await calculateStaticLcia({
      exchanges: observations,
      listData,
      factors: { ...originalFactors, [key]: { ...group, factor: group.factor[0] } },
      ...sourceProof,
    });
    expect(singleton.results).toEqual(baseline.results);
    const metadataMissing = {
      ...listData,
      files: listData.files.map((entry: any) =>
        entry.id === climate ? { ...entry, description: undefined } : entry,
      ),
    };
    const labelled = await calculateStaticLcia({
      exchanges: [exchange()],
      listData: metadataMissing,
      factors: originalFactors,
      ...sourceProof,
    });
    expect(labelled.results.find((row) => row.key === climate)).toMatchObject({
      meanAmount: '1',
      referenceToLCIAMethodDataSet: {
        'common:shortDescription': [{ '@xml:lang': 'en', '#text': climate }],
      },
    });
  });

  it('preserves a primitive source-read failure instead of publishing an earlier subtotal', async () => {
    const key = co2 + ':OUTPUT';
    const broken = {
      ...originalFactors,
      [key]: new Proxy(originalFactors[key], {
        get(target, property) {
          if (property === 'factor') throw 'source-read-failed';
          return target[property];
        },
      }),
    };
    const calculated = await calculateStaticLcia({
      exchanges: [exchange()],
      listData,
      factors: broken,
      ...sourceProof,
    });
    expect(calculated.results).toEqual([]);
    expect(calculated.report.failure_reason).toBe('source-read-failed');
  });
});
