import { decompressGzipData } from '@/services/general/browserResourceCache';
import type { LciaFlowFactorMap, LciaUncharacterizedReason } from './data';
import {
  canonicalJson,
  computeLciaSha256,
  STATIC_LCIA_CACHE_MANIFEST,
  STATIC_LCIA_CACHE_MANIFEST_SHA256,
} from './evidence';

import {
  LCIA_APPLICABILITY_POLICY_VERSION,
  SUPPORTED_SOURCE_POLICY_MANIFEST_SHA256,
} from './supportedSourcePolicyConstants';
export {
  LCIA_APPLICABILITY_POLICY_VERSION,
  SUPPORTED_SOURCE_POLICY_MANIFEST_SHA256,
} from './supportedSourcePolicyConstants';
const SOURCE_POLICY_PATH = '/lcia-source-policy-v2';
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_METHOD_BYTES = 16 * 1024 * 1024;

type FactorLocation =
  { kind: 'missing' | 'blank' | 'unknown' | 'invalid' } | { kind: 'code'; value: string };

type PolicyBasis = { id: string; uri: string; locator: string; scope: string };

type GenericGeographicAdmission =
  | { kind: 'global'; source_geography_sha256: string }
  | { kind: 'exact_source_tokens'; source_geography_sha256: string; tokens: string[] };

type MethodManifest = {
  method_id: string;
  method_version: string;
  artifact_locator_id: string;
  source_path: string;
  source_xml_sha256: string;
  method_document_sha256: string;
  numeric_binding_sha256: string;
  metadata_sha256: string;
  generic_geographic_admission: GenericGeographicAdmission;
  basis: PolicyBasis[];
  regional_default_unresolved_family_count: number;
  asset: string;
  asset_sha256: string;
  decompressed_sha256: string;
  decompressed_byte_size: number;
  factor_count: number;
  generic_record_count: number;
  reviewed_comment_count: number;
};

type PolicyManifest = {
  schema_version: 'lcia.supported-source-policy.v2';
  policy_version: typeof LCIA_APPLICABILITY_POLICY_VERSION;
  source_repository: string;
  source_commit: string;
  static_bundle_manifest_sha256: string;
  static_factor_manifest_sha256: string;
  record_hash_kind: string;
  numeric_binding: string;
  methods: MethodManifest[];
};

type MethodCompanion = {
  method_id: string;
  method_version: string;
  artifact_locator_id: string;
  source_path: string;
  source_xml_sha256: string;
  method_document_sha256: string;
  numeric_binding_sha256: string;
  metadata_sha256: string;
  generic_geographic_admission: GenericGeographicAdmission;
  source_scope: Record<string, unknown>;
  basis: PolicyBasis[];
  regional_default_unresolved_family_count: number;
  locations: FactorLocation[];
  qualifiers: Record<string, unknown>[];
  // Original XML ordinal is the array position; the cache key/index retains source mapping.
  bindings: [string, number, string, number, number][];
  generic_records: number[];
  reviewed_comment_records: number[];
};

type BoundFactor = {
  recordIndex: number;
  recordSha256: string;
  flowVersion: string;
  direction: string;
  location: FactorLocation;
  value: string | number;
  unsupportedQualifiers: boolean;
};

export type SupportedFactorDecision =
  | {
      status: 'selected';
      reason: 'exact_source_location_token' | 'reviewed_source_generic_default';
      value: string | number;
      source_record_index: number;
      source_record_sha256: string;
      source_xml_sha256: string;
    }
  | {
      status: 'unmatched' | 'unsupported';
      reason: LciaUncharacterizedReason;
      value: null;
    };

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function failure(reason: LciaUncharacterizedReason): SupportedFactorDecision {
  return { status: 'unsupported', reason, value: null };
}

function exactLocation(value: FactorLocation): value is { kind: 'code'; value: string } {
  return value.kind === 'code' && value.value.trim() !== '' && value.value.length <= 256;
}

export function exchangeFactorLocation(value: unknown): FactorLocation {
  if (value === undefined) return { kind: 'missing' };
  if (typeof value !== 'string') return { kind: 'invalid' };
  if (value.trim() === '') return { kind: 'blank' };
  return value.length <= 256 ? { kind: 'code', value } : { kind: 'invalid' };
}

function floatBits(value: string | number): string {
  if (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))
    throw new Error('lcia_supported_policy_static_record_invalid');
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('lcia_supported_policy_static_record_invalid');
  const bytes = new DataView(new ArrayBuffer(8));
  bytes.setFloat64(0, number, false);
  return bytes.getBigUint64(0, false).toString(16).padStart(16, '0');
}

function sourceArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    if (!value.every(object)) throw new Error('lcia_supported_policy_static_record_invalid');
    return value;
  }
  return object(value) ? [value] : [];
}

function unsupportedQualifiers(
  qualifier: Record<string, unknown>,
  reviewedComment: boolean,
): boolean {
  const metadata = new Set([
    'minimumValue',
    'maximumValue',
    'uncertaintyDistributionType',
    'relativeStandardDeviation95In',
    'dataDerivationTypeStatus',
    'deviatingRecommendation',
    'referencesToDataSource',
  ]);
  return Object.entries(qualifier).some(([key, value]) => {
    if (metadata.has(key)) return false;
    if (key !== 'generalComment') return true;
    return !reviewedComment && !(typeof value === 'string' && value.trim() === '');
  });
}

async function geographicBindingMatchesSource(
  admission: GenericGeographicAdmission,
  sourceScope: Record<string, unknown>,
): Promise<boolean> {
  const information = sourceScope?.information;
  const geography = object(information) ? information.geography : undefined;
  if (
    !object(admission) ||
    !object(geography) ||
    !/^[0-9a-f]{64}$/.test(admission.source_geography_sha256) ||
    (admission.kind === 'global'
      ? Object.keys(admission).length !== 2
      : admission.kind !== 'exact_source_tokens' || Object.keys(admission).length !== 3)
  )
    return false;
  const sourceHash = await computeLciaSha256(canonicalJson(geography));
  if (admission.source_geography_sha256 !== sourceHash) return false;
  if (admission.kind === 'global') return geography.interventionLocation === 'GLO';
  return (
    admission.kind === 'exact_source_tokens' &&
    Array.isArray(admission.tokens) &&
    admission.tokens.length === 1 &&
    typeof admission.tokens[0] === 'string' &&
    admission.tokens[0].trim() !== '' &&
    admission.tokens[0].length <= 256 &&
    admission.tokens[0] === geography.interventionLocation
  );
}

function geographicAdmissionAllows(
  admission: GenericGeographicAdmission,
  location: FactorLocation,
): boolean {
  if (admission.kind === 'global')
    return (
      location.kind === 'missing' ||
      location.kind === 'blank' ||
      location.kind === 'unknown' ||
      exactLocation(location)
    );
  return location.kind === 'code' && admission.tokens.includes(location.value);
}

/** A validated source-bound selector; receipt JSON cannot construct one. */
class SupportedMethodFactors {
  private constructor(
    private readonly byFlow: Map<string, BoundFactor[]>,
    private readonly generic: ReadonlySet<number>,
    private readonly sourceXmlSha256: string,
    private readonly genericGeographicAdmission: GenericGeographicAdmission,
  ) {}

  static async fromCompanion(
    entry: MethodManifest,
    companion: MethodCompanion,
    factors: LciaFlowFactorMap,
  ): Promise<SupportedMethodFactors> {
    let sourceFactorCount = 0;
    for (const group of Object.values(factors)) {
      sourceFactorCount += sourceArray(group.factor).filter(
        (factor) => factor.key === entry.method_id,
      ).length;
    }
    if (sourceFactorCount !== entry.factor_count)
      throw new Error('lcia_supported_policy_static_factor_count_mismatch');
    const byFlow = new Map<string, BoundFactor[]>();
    const used = new Set<string>();
    const reviewedComments = new Set(companion.reviewed_comment_records);
    let numeric = 'lcia.source-numeric-binding.v1\n';
    companion.bindings.forEach((binding, recordIndex) => {
      const [key, factorIndex, recordSha256, locationIndex, qualifierIndex] = binding;
      const group = factors[key];
      const factor = sourceArray(group?.factor)[factorIndex];
      const identity = `${key}:${factorIndex}`;
      if (
        !object(group) ||
        !factor ||
        factor.key !== entry.method_id ||
        typeof group['@refObjectId'] !== 'string' ||
        typeof group['@version'] !== 'string' ||
        typeof group.exchangeDirection !== 'string' ||
        !['INPUT', 'OUTPUT'].includes(group.exchangeDirection) ||
        key !== `${group['@refObjectId']}:${group.exchangeDirection}` ||
        !/^\d{2}\.\d{2}\.\d{3}$/.test(group['@version']) ||
        (typeof factor.value !== 'string' && typeof factor.value !== 'number') ||
        used.has(identity)
      )
        throw new Error('lcia_supported_policy_static_record_invalid');
      used.add(identity);
      numeric += `${group['@refObjectId']}|${group['@version']}|${group.exchangeDirection}|${floatBits(factor.value)}\n`;
      const record: BoundFactor = {
        recordIndex,
        recordSha256,
        flowVersion: group['@version'],
        direction: group.exchangeDirection,
        location: companion.locations[locationIndex],
        value: factor.value,
        unsupportedQualifiers: unsupportedQualifiers(
          companion.qualifiers[qualifierIndex],
          reviewedComments.has(recordIndex),
        ),
      };
      const flow = group['@refObjectId'];
      const existing = byFlow.get(flow);
      if (existing) existing.push(record);
      else byFlow.set(flow, [record]);
    });
    if ((await computeLciaSha256(numeric)) !== entry.numeric_binding_sha256)
      throw new Error('lcia_supported_policy_static_numeric_binding_mismatch');
    return new SupportedMethodFactors(
      byFlow,
      new Set(companion.generic_records),
      entry.source_xml_sha256,
      companion.generic_geographic_admission,
    );
  }

  select(
    flowId: string,
    flowVersion: string,
    direction: string,
    location: FactorLocation,
  ): SupportedFactorDecision {
    if (!/^\d{2}\.\d{2}\.\d{3}$/.test(flowVersion))
      return failure('lcia_inventory_flow_version_invalid');
    if (location.kind === 'invalid') return failure('lcia_factor_location_semantics_unresolved');
    const candidates = this.byFlow.get(flowId) ?? [];
    if (candidates.length === 0)
      return { status: 'unmatched', reason: 'no_lcia_factor_for_flow_direction', value: null };
    const versioned = candidates.filter((factor) => factor.flowVersion === flowVersion);
    if (versioned.length === 0) return failure('lcia_factor_flow_version_mismatch');
    const directional = versioned.filter((factor) => factor.direction === direction);
    const regional = directional.filter(
      (factor) =>
        exactLocation(factor.location) &&
        exactLocation(location) &&
        factor.location.value === location.value,
    );
    const generic = directional.filter((factor) => this.generic.has(factor.recordIndex));
    if (
      regional.length === 0 &&
      generic.length > 0 &&
      !geographicAdmissionAllows(this.genericGeographicAdmission, location)
    )
      return failure('lcia_generic_location_not_admitted');
    const chosen = regional.length > 0 ? regional : generic;
    if (chosen.length > 1) return failure('lcia_factor_applicability_ambiguous');
    if (chosen.length === 0) {
      if (directional.some((factor) => !exactLocation(factor.location)))
        return failure('lcia_factor_location_semantics_unresolved');
      return {
        status: 'unmatched',
        reason: 'no_lcia_factor_for_exact_location_direction',
        value: null,
      };
    }
    const selected = chosen[0];
    if (selected.unsupportedQualifiers) return failure('lcia_factor_qualifier_unsupported');
    return {
      status: 'selected',
      reason:
        regional.length > 0 ? 'exact_source_location_token' : 'reviewed_source_generic_default',
      value: selected.value,
      source_record_index: selected.recordIndex,
      source_record_sha256: selected.recordSha256,
      source_xml_sha256: this.sourceXmlSha256,
    };
  }
}

async function readBoundAsset(
  path: string,
  expectedHash: string,
  maxBytes: number,
): Promise<ArrayBuffer> {
  if (typeof fetch !== 'function') throw new Error('lcia_supported_policy_asset_unavailable');
  let response: Response;
  try {
    response = await fetch(`${SOURCE_POLICY_PATH}/${path}?sha256=${expectedHash}`);
  } catch {
    throw new Error('lcia_supported_policy_asset_unavailable');
  }
  if (!response.ok) throw new Error('lcia_supported_policy_asset_unavailable');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > maxBytes) throw new Error('lcia_supported_policy_asset_size_limit');
  if ((await computeLciaSha256(bytes)) !== expectedHash)
    throw new Error('lcia_supported_policy_asset_hash_mismatch');
  return bytes;
}

let manifestPromise: Promise<PolicyManifest> | null = null;

async function loadManifest(): Promise<PolicyManifest> {
  if (!manifestPromise) {
    manifestPromise = (async () => {
      const bytes = await readBoundAsset(
        'manifest.json',
        SUPPORTED_SOURCE_POLICY_MANIFEST_SHA256,
        MAX_MANIFEST_BYTES,
      );
      const manifest = JSON.parse(new TextDecoder().decode(bytes)) as PolicyManifest;
      if (
        manifest.schema_version !== 'lcia.supported-source-policy.v2' ||
        manifest.policy_version !== LCIA_APPLICABILITY_POLICY_VERSION ||
        manifest.static_bundle_manifest_sha256 !== STATIC_LCIA_CACHE_MANIFEST_SHA256 ||
        manifest.static_factor_manifest_sha256 !==
          STATIC_LCIA_CACHE_MANIFEST.factor_manifest_sha256 ||
        !Array.isArray(manifest.methods) ||
        manifest.methods.length !== STATIC_LCIA_CACHE_MANIFEST.methods.length ||
        new Set(manifest.methods.map((method) => method.method_id)).size !==
          manifest.methods.length ||
        !manifest.methods.every((method) =>
          STATIC_LCIA_CACHE_MANIFEST.methods.some(
            (expected) =>
              method.method_id === expected.method_id &&
              method.method_version === expected.method_version &&
              method.artifact_locator_id === expected.artifact_locator_id &&
              method.factor_count === expected.factor_entry_count &&
              method.asset === `${expected.artifact_locator_id}.json.gz`,
          ),
        )
      )
        throw new Error('lcia_supported_policy_manifest_binding_mismatch');
      return manifest;
    })().catch((error: unknown) => {
      manifestPromise = null;
      throw error;
    });
  }
  return manifestPromise;
}

async function loadCompanion(entry: MethodManifest): Promise<MethodCompanion> {
  const compressed = await readBoundAsset(entry.asset, entry.asset_sha256, MAX_METHOD_BYTES);
  const decoded = await decompressGzipData(compressed);
  if (
    new TextEncoder().encode(decoded).byteLength !== entry.decompressed_byte_size ||
    entry.decompressed_byte_size > MAX_METHOD_BYTES ||
    (await computeLciaSha256(decoded)) !== entry.decompressed_sha256
  )
    throw new Error('lcia_supported_policy_decoded_hash_mismatch');
  const companion = JSON.parse(decoded) as MethodCompanion;
  if (
    companion.method_id !== entry.method_id ||
    companion.method_version !== entry.method_version ||
    companion.artifact_locator_id !== entry.artifact_locator_id ||
    companion.source_path !== entry.source_path ||
    companion.source_xml_sha256 !== entry.source_xml_sha256 ||
    companion.method_document_sha256 !== entry.method_document_sha256 ||
    companion.numeric_binding_sha256 !== entry.numeric_binding_sha256 ||
    companion.metadata_sha256 !== entry.metadata_sha256 ||
    (await computeLciaSha256(canonicalJson(companion.source_scope))) !== entry.metadata_sha256 ||
    !object(companion.generic_geographic_admission) ||
    !object(entry.generic_geographic_admission) ||
    canonicalJson(companion.generic_geographic_admission) !==
      canonicalJson(entry.generic_geographic_admission) ||
    !(await geographicBindingMatchesSource(
      companion.generic_geographic_admission,
      companion.source_scope,
    )) ||
    canonicalJson(companion.basis) !== canonicalJson(entry.basis) ||
    companion.regional_default_unresolved_family_count !==
      entry.regional_default_unresolved_family_count ||
    !Array.isArray(companion.bindings) ||
    companion.bindings.length !== entry.factor_count ||
    !Array.isArray(companion.generic_records) ||
    companion.generic_records.length !== entry.generic_record_count ||
    new Set(companion.generic_records).size !== entry.generic_record_count ||
    !Array.isArray(companion.reviewed_comment_records) ||
    companion.reviewed_comment_records.length !== entry.reviewed_comment_count ||
    new Set(companion.reviewed_comment_records).size !== entry.reviewed_comment_count ||
    !Array.isArray(companion.locations) ||
    !Array.isArray(companion.qualifiers) ||
    !companion.generic_records
      .concat(companion.reviewed_comment_records)
      .every((index) => Number.isSafeInteger(index) && index >= 0 && index < entry.factor_count) ||
    !companion.bindings.every(
      (binding) =>
        Array.isArray(binding) &&
        binding.length === 5 &&
        typeof binding[0] === 'string' &&
        Number.isSafeInteger(binding[1]) &&
        binding[1] >= 0 &&
        /^[0-9a-f]{64}$/.test(binding[2]) &&
        Number.isSafeInteger(binding[3]) &&
        binding[3] >= 0 &&
        binding[3] < companion.locations.length &&
        Number.isSafeInteger(binding[4]) &&
        binding[4] >= 0 &&
        binding[4] < companion.qualifiers.length,
    )
  )
    throw new Error('lcia_supported_policy_method_binding_mismatch');
  return companion;
}

const methodsBySource = new WeakMap<
  LciaFlowFactorMap,
  Map<string, Promise<SupportedMethodFactors>>
>();

export async function loadSupportedMethodFactors(
  methodId: string,
  factors: LciaFlowFactorMap,
): Promise<SupportedMethodFactors> {
  let methods = methodsBySource.get(factors);
  if (!methods) {
    methods = new Map();
    methodsBySource.set(factors, methods);
  }
  const cached = methods.get(methodId);
  if (cached) return cached;
  const pending = (async () => {
    const manifest = await loadManifest();
    const entry = manifest.methods.find((method) => method.method_id === methodId);
    if (!entry) throw new Error('lcia_supported_policy_method_missing');
    const companion = await loadCompanion(entry);
    return await SupportedMethodFactors.fromCompanion(entry, companion, factors);
  })().catch((error: unknown) => {
    methods.delete(methodId);
    throw error;
  });
  methods.set(methodId, pending);
  return pending;
}
