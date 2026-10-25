import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

const root = path.resolve(__dirname, '../../../../public');
const originalManifest = JSON.parse(
  readFileSync(path.join(root, 'lcia-source-policy-v2/manifest.json'), 'utf8'),
);
const originalFactors = JSON.parse(
  gunzipSync(readFileSync(path.join(root, 'lciamethods/flow_factors.json.gz'))).toString('utf8'),
);
const climate = '7fce5b3a-66b8-4ce1-91e8-a925aee1f186';
const acidification = 'b5c611c6-def3-11e6-bf01-fe55135034f3';
const mockAssets = new Map<string, Buffer>();
let mockCandidatePin = '';
let mockTransport: 'ok' | 'network' | 'http' = 'ok';

// A separate, internally consistent compiled candidate pin models an authoring
// error. This does not bypass production hash verification: the real reader
// still authenticates bytes, then must reject their inconsistent source claims.
jest.mock('@/services/lciaMethods/supportedSourcePolicyConstants', () => ({
  LCIA_APPLICABILITY_POLICY_VERSION: 'lcia.applicability.source-bound.v3',
  get SUPPORTED_SOURCE_POLICY_MANIFEST_SHA256() {
    return mockCandidatePin;
  },
}));
jest.mock('@/services/general/browserResourceCache', () => ({
  decompressGzipData: async (bytes: ArrayBuffer) =>
    jest.requireActual('node:zlib').gunzipSync(Buffer.from(bytes)).toString('utf8'),
}));

const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const canonical = (value: any): string =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : value && typeof value === 'object'
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
          .join(',')}}`
      : JSON.stringify(value);

function candidate(
  options: {
    method?: string;
    companion?: (body: any) => void;
    entry?: (entry: any, body: any) => void;
    manifest?: (manifest: any) => void;
    decoded?: (body: string) => string;
    compressed?: (body: Buffer) => Buffer;
  } = {},
) {
  const manifest = clone(originalManifest);
  const method = options.method ?? climate;
  const entry = manifest.methods.find((item: any) => item.method_id === method);
  const body = JSON.parse(
    gunzipSync(readFileSync(path.join(root, 'lcia-source-policy-v2', entry.asset))).toString(
      'utf8',
    ),
  );
  options.companion?.(body);
  let decoded = JSON.stringify(body) + '\n';
  if (options.decoded) decoded = options.decoded(decoded);
  let compressed: Buffer = gzipSync(decoded);
  if (options.compressed) compressed = options.compressed(compressed);
  entry.asset_sha256 = hash(compressed);
  entry.decompressed_sha256 = hash(decoded);
  entry.decompressed_byte_size = Buffer.byteLength(decoded);
  options.entry?.(entry, body);
  options.manifest?.(manifest);
  const bytes = Buffer.from(JSON.stringify(manifest));
  mockCandidatePin = hash(bytes);
  mockAssets.set('manifest.json', bytes);
  mockAssets.set(entry.asset, compressed);
  return method;
}

function reader() {
  let module: typeof import('@/services/lciaMethods/supportedSourcePolicy');
  jest.isolateModules(() => {
    module = require('@/services/lciaMethods/supportedSourcePolicy');
  });
  return module!;
}

beforeAll(() =>
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto }),
);
beforeEach(() => {
  mockAssets.clear();
  mockTransport = 'ok';
  global.fetch = jest.fn(async (url: string | URL | Request) => {
    if (mockTransport === 'network') throw new Error('offline');
    const name = String(url).split('?')[0].split('/').pop()!;
    const bytes = mockAssets.get(name);
    return {
      ok: mockTransport !== 'http' && Boolean(bytes),
      arrayBuffer: async () =>
        bytes!.buffer.slice(bytes!.byteOffset, bytes!.byteOffset + bytes!.byteLength),
    } as Response;
  });
});

it('keeps a coherent compiled candidate readable and rejects unavailable transports without cached authority', async () => {
  const method = candidate();
  const source = reader();
  for (const transport of ['network', 'http'] as const) {
    mockTransport = transport;
    await expect(source.loadSupportedMethodFactors(method, originalFactors)).rejects.toThrow(
      'lcia_supported_policy_asset_unavailable',
    );
  }
  mockTransport = 'ok';
  await expect(source.loadSupportedMethodFactors(method, originalFactors)).resolves.toBeDefined();
});

it.each([
  'old-policy',
  'old-schema',
  'wrong-bundle',
  'wrong-method',
  'wrong-method-count',
  'duplicate-method',
  'wrong-filename',
])('refuses an authored manifest that breaks the fixed source contract: %s', async (failure) => {
  const method = candidate({
    manifest: (manifest) => {
      if (failure === 'old-policy') manifest.policy_version = 'lcia.applicability.source-bound.v2';
      if (failure === 'old-schema') manifest.schema_version = 'lcia.supported-source-policy.v1';
      if (failure === 'wrong-bundle') manifest.static_factor_manifest_sha256 = '0'.repeat(64);
      if (failure === 'wrong-method') manifest.methods[0].method_version = '99.99.999';
      if (failure === 'wrong-method-count') manifest.methods.pop();
      if (failure === 'duplicate-method') manifest.methods[1] = clone(manifest.methods[0]);
      if (failure === 'wrong-filename') manifest.methods[0].asset = '../other.json.gz';
    },
  });
  await expect(reader().loadSupportedMethodFactors(method, originalFactors)).rejects.toThrow(
    'lcia_supported_policy_manifest_binding_mismatch',
  );
});

it.each([
  'method_id',
  'method_version',
  'artifact_locator_id',
  'source_path',
  'source_xml_sha256',
  'method_document_sha256',
  'numeric_binding_sha256',
  'metadata_sha256',
  'basis',
  'regional_default_unresolved_family_count',
])('refuses a companion disagreeing with its authenticated manifest: %s', async (field) => {
  const method = candidate({
    companion: (body) => {
      body[field] =
        field === 'basis'
          ? []
          : field === 'regional_default_unresolved_family_count'
            ? 123
            : 'different';
    },
  });
  await expect(reader().loadSupportedMethodFactors(method, originalFactors)).rejects.toThrow(
    'lcia_supported_policy_method_binding_mismatch',
  );
});

it.each([
  'missing-geography',
  'invalid-information',
  'wrong-geography-hash',
  'europe-as-global',
  'extra-country',
  'different-token',
  'missing-admission',
])(
  'refuses a source-geography declaration even when the candidate owner pinned those bytes: %s',
  async (failure) => {
    const method = candidate({
      method: acidification,
      companion: (body) => {
        if (failure === 'missing-geography') {
          delete body.source_scope.information.geography;
          body.metadata_sha256 = hash(canonical(body.source_scope));
        }
        if (failure === 'invalid-information') {
          body.source_scope.information = null;
          body.metadata_sha256 = hash(canonical(body.source_scope));
        }
        if (failure === 'wrong-geography-hash')
          body.generic_geographic_admission.source_geography_sha256 = '0'.repeat(64);
        if (failure === 'europe-as-global')
          body.generic_geographic_admission = {
            kind: 'global',
            source_geography_sha256: body.generic_geographic_admission.source_geography_sha256,
          };
        if (failure === 'extra-country') body.generic_geographic_admission.tokens.push('DE');
        if (failure === 'different-token') body.generic_geographic_admission.tokens = ['CN'];
        if (failure === 'missing-admission') delete body.generic_geographic_admission;
      },
      entry: (entry, body) => {
        entry.generic_geographic_admission = body.generic_geographic_admission;
        entry.metadata_sha256 = body.metadata_sha256;
      },
    });
    await expect(reader().loadSupportedMethodFactors(method, originalFactors)).rejects.toThrow(
      'lcia_supported_policy_method_binding_mismatch',
    );
  },
);

it.each([
  'missing-binding',
  'wrong-location-index',
  'wrong-qualifier-index',
  'bad-original-hash',
  'duplicate-default',
  'out-of-range-default',
  'out-of-range-comment',
])('refuses incomplete or invalid source record references: %s', async (failure) => {
  const method = candidate({
    companion: (body) => {
      if (failure === 'missing-binding') body.bindings.pop();
      if (failure === 'wrong-location-index') body.bindings[0][3] = body.locations.length;
      if (failure === 'wrong-qualifier-index') body.bindings[0][4] = -1;
      if (failure === 'bad-original-hash') body.bindings[0][2] = 'invalid';
      if (failure === 'duplicate-default') body.generic_records.push(body.generic_records[0]);
      if (failure === 'out-of-range-default') body.generic_records[0] = body.bindings.length;
      if (failure === 'out-of-range-comment')
        body.reviewed_comment_records.push(body.bindings.length);
    },
    entry: (entry, body) => {
      if (failure === 'duplicate-default') entry.generic_record_count = body.generic_records.length;
      if (failure === 'out-of-range-comment')
        entry.reviewed_comment_count = body.reviewed_comment_records.length;
    },
  });
  await expect(reader().loadSupportedMethodFactors(method, originalFactors)).rejects.toThrow(
    'lcia_supported_policy_method_binding_mismatch',
  );
});

it.each(['wrong-size', 'wrong-decoded-hash', 'invalid-json', 'invalid-gzip', 'decoded-oversize'])(
  'refuses malformed or oversized authenticated transport payloads: %s',
  async (failure) => {
    const method = candidate({
      decoded: (text) =>
        failure === 'invalid-json'
          ? '{not-json}'
          : failure === 'decoded-oversize'
            ? text + ' '.repeat(16 * 1024 * 1024)
            : text,
      compressed: (bytes) => (failure === 'invalid-gzip' ? Buffer.from('not-gzip') : bytes),
      entry: (entry) => {
        if (failure === 'wrong-size') entry.decompressed_byte_size++;
        if (failure === 'wrong-decoded-hash') entry.decompressed_sha256 = '0'.repeat(64);
      },
    });
    await expect(reader().loadSupportedMethodFactors(method, originalFactors)).rejects.toThrow();
  },
);

it.each(['', ' ', '0x0', 'NaN', 'Infinity', null, false])(
  'does not turn an invalid original-zero cache value into a selected source zero: %s',
  async (value) => {
    const method = candidate();
    const key = 'e99843b7-e598-447a-ab73-d01f179f0f8c:INPUT';
    const group = originalFactors[key];
    const changed = {
      ...originalFactors,
      [key]: {
        ...group,
        factor: group.factor.map((factor: any) =>
          factor.key === climate ? { ...factor, value } : factor,
        ),
      },
    };
    await expect(reader().loadSupportedMethodFactors(method, changed)).rejects.toThrow(
      'lcia_supported_policy_static_record_invalid',
    );
  },
);

it('rejects unavailable fetch and oversized authenticated manifests before parsing source claims', async () => {
  const method = candidate();
  const fetcher = global.fetch;
  (globalThis as any).fetch = undefined;
  await expect(reader().loadSupportedMethodFactors(method, originalFactors)).rejects.toThrow(
    'lcia_supported_policy_asset_unavailable',
  );
  global.fetch = fetcher;
  const bytes = Buffer.concat([
    mockAssets.get('manifest.json')!,
    Buffer.alloc(4 * 1024 * 1024, 32),
  ]);
  mockCandidatePin = hash(bytes);
  mockAssets.set('manifest.json', bytes);
  await expect(reader().loadSupportedMethodFactors(method, originalFactors)).rejects.toThrow(
    'lcia_supported_policy_asset_size_limit',
  );
});

it.each([
  'missing-row',
  'non-object-row',
  'duplicate-binding',
  'bad-flow-id',
  'bad-version',
  'bad-direction',
  'non-finite-number',
])('rejects incomplete/corrupt loaded source maps: %s', async (failure) => {
  const method = candidate({
    companion: (body) => {
      if (failure === 'duplicate-binding') body.bindings[1] = clone(body.bindings[0]);
    },
  });
  const key = 'e99843b7-e598-447a-ab73-d01f179f0f8c:INPUT';
  const group = clone(originalFactors[key]);
  if (failure === 'missing-row') group.factor = undefined;
  if (failure === 'non-object-row') group.factor = [null];
  if (failure === 'bad-flow-id') group['@refObjectId'] = 'other';
  if (failure === 'bad-version') group['@version'] = 'latest';
  if (failure === 'bad-direction') group.exchangeDirection = 'output';
  if (failure === 'non-finite-number')
    group.factor.forEach((factor: any) => {
      if (factor.key === climate) factor.value = Infinity;
    });
  const changed = { ...originalFactors, [key]: group };
  await expect(reader().loadSupportedMethodFactors(method, changed)).rejects.toThrow(
    'lcia_supported_policy_static_',
  );
});

it('normalizes a genuine singleton factor container while retaining the complete scientific binding', async () => {
  const key = Object.keys(originalFactors).find((key) => originalFactors[key].factor.length === 1)!;
  expect(key).toBeDefined();
  const method = candidate({ method: originalFactors[key].factor[0].key });
  const factors = {
    ...originalFactors,
    [key]: { ...originalFactors[key], factor: originalFactors[key].factor[0] },
  };
  await expect(reader().loadSupportedMethodFactors(method, factors)).resolves.toBeDefined();
});

it('keeps absent requested methods unavailable rather than borrowing a named method', async () => {
  candidate();
  await expect(
    reader().loadSupportedMethodFactors('unreviewed-climate-method', originalFactors),
  ).rejects.toThrow('lcia_supported_policy_method_missing');
});

it('retains ambiguity after a producer loses the distinction between regional alternatives', async () => {
  const method = candidate({
    method: acidification,
    companion: (body) => {
      const blank = body.bindings[211][3];
      body.locations[blank] = { kind: 'code', value: 'DE' };
    },
  });
  const source = await reader().loadSupportedMethodFactors(method, originalFactors);
  expect(
    source.select('08a91e70-3ddc-11dd-a2a9-0050c2490048', '03.00.004', 'OUTPUT', {
      kind: 'code',
      value: 'DE',
    }),
  ).toMatchObject({
    status: 'unsupported',
    reason: 'lcia_factor_applicability_ambiguous',
    value: null,
  });
});

it.each(['comment', 'condition'])(
  'never interprets an unreviewed factor qualification: %s',
  async (kind) => {
    const method = candidate({
      companion: (body) => {
        for (const qualifier of body.qualifiers) {
          if (kind === 'comment') qualifier.generalComment = 'unreviewed applicability restriction';
          else qualifier.conditionalApplicability = 'requires scientific review';
        }
      },
    });
    const source = await reader().loadSupportedMethodFactors(method, originalFactors);
    expect(
      source.select('08a91e70-3ddc-11dd-923d-0050c2490048', '03.00.004', 'OUTPUT', {
        kind: 'missing',
      }),
    ).toMatchObject({
      status: 'unsupported',
      reason: 'lcia_factor_qualifier_unsupported',
      value: null,
    });
  },
);

it('retains unapproved default applicability as unknown even when a source record is unique', async () => {
  const method = candidate({
    companion: (body) => {
      body.generic_records = [];
    },
    entry: (entry) => {
      entry.generic_record_count = 0;
    },
  });
  const source = await reader().loadSupportedMethodFactors(method, originalFactors);
  expect(
    source.select('08a91e70-3ddc-11dd-923d-0050c2490048', '03.00.004', 'OUTPUT', {
      kind: 'missing',
    }),
  ).toMatchObject({
    status: 'unsupported',
    reason: 'lcia_factor_location_semantics_unresolved',
    value: null,
  });
});
