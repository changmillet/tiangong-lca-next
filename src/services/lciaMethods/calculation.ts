import { toBigNumberOrNaN, toBigNumberOrZero } from '@/services/general/bignumber';
import { CANONICAL_CONTENT_LANGUAGE } from '@/services/general/contentLanguageRegistry';
import type { ProcessExchangeData } from '@/services/processes/data';
import type BigNumber from 'bignumber.js';
import type {
  LciaCoverageCounts,
  LciaFlowFactorMap,
  LciaMethodFactorCoverageMatrix,
  LciaMethodListData,
  LCIAResultTable,
  LciaStaticCacheMethod,
  LciaStaticCalculationReport,
  LciaStaticCalculationResult,
  LciaUncharacterizedExchange,
  LciaUncharacterizedReason,
} from './data';
import { parseLciaAvailability, type LciaAvailability } from '@/services/lca/categoryAvailability';
import { computeLciaSha256, STATIC_LCIA_CACHE_MANIFEST } from './evidence';
import {
  isKnownEmptyLciaInventory,
  type LciaInventoryClassification,
} from './inventoryClassification';
import {
  exchangeFactorLocation,
  LCIA_APPLICABILITY_POLICY_VERSION,
  loadSupportedMethodFactors,
  SUPPORTED_SOURCE_POLICY_MANIFEST_SHA256,
} from './supportedSourcePolicy';

type StaticCalculationInput = {
  exchanges: ProcessExchangeData[];
  listData: LciaMethodListData;
  factors: LciaFlowFactorMap;
  observedListSha256?: string;
  observedFactorSha256?: string;
  inventoryClassification?: LciaInventoryClassification;
};

const emptyCounts = (): LciaCoverageCounts => ({
  matched: 0,
  unmatched: 0,
  invalid: 0,
  unsupported_direction: 0,
});

const normalizeExchangeFlowRef = (exchange: ProcessExchangeData) => {
  const reference = exchange.referenceToFlowDataSet;
  if (!Array.isArray(reference)) return reference;
  return reference.length === 1 ? reference[0] : undefined;
};

function buildGap(
  method: LciaStaticCacheMethod,
  exchange: ProcessExchangeData,
  exchangeIndex: number,
  reason: LciaUncharacterizedReason,
): LciaUncharacterizedExchange {
  const flowRef = normalizeExchangeFlowRef(exchange);
  return {
    method_id: method.method_id,
    method_version: method.method_version,
    artifact_locator_id: method.artifact_locator_id,
    flow_uuid: String(flowRef?.['@refObjectId'] ?? ''),
    flow_version: String(flowRef?.['@version'] ?? ''),
    direction: String(exchange.exchangeDirection ?? '').toUpperCase(),
    exchange_id: String(exchange['@dataSetInternalID'] ?? `exchange-${exchangeIndex + 1}`),
    amount: String(exchange.meanAmount ?? ''),
    amount_source: 'meanAmount',
    resulting_amount:
      exchange.resultingAmount === undefined || exchange.resultingAmount === null
        ? null
        : String(exchange.resultingAmount),
    reason,
  };
}

function buildMethodRows() {
  return STATIC_LCIA_CACHE_MANIFEST.methods.map((method) => ({
    method_id: method.method_id,
    method_version: method.method_version,
    artifact_locator_id: method.artifact_locator_id,
    counts: emptyCounts(),
  }));
}

async function buildMatrix(
  counts: LciaCoverageCounts,
  byMethod: ReturnType<typeof buildMethodRows>,
  gaps: LciaUncharacterizedExchange[],
): Promise<LciaMethodFactorCoverageMatrix> {
  const incomplete = counts.unmatched + counts.invalid + counts.unsupported_direction > 0;
  const jsonl = gaps.length > 0 ? `${gaps.map((gap) => JSON.stringify(gap)).join('\n')}\n` : '';
  let artifact: LciaMethodFactorCoverageMatrix['uncharacterized_evidence'] = null;
  if (jsonl) {
    artifact = {
      artifact_url: 'inline:lcia-calculation-evidence',
      artifact_format: 'lcia-uncharacterized-jsonl:v1',
      artifact_sha256: await computeLciaSha256(jsonl),
      record_count: gaps.length,
    };
  }

  return {
    schema_version: 'lcia.method_factor_coverage.matrix.v1',
    source_snapshot_sha256: STATIC_LCIA_CACHE_MANIFEST.source_snapshot_sha256,
    method_manifest_sha256: STATIC_LCIA_CACHE_MANIFEST.method_manifest_sha256,
    method_identity_manifest_sha256: STATIC_LCIA_CACHE_MANIFEST.method_identity_manifest_sha256,
    factor_manifest_sha256: STATIC_LCIA_CACHE_MANIFEST.factor_manifest_sha256,
    count_unit: 'exchange_method_pair',
    key_dimensions: ['method_id', 'method_version', 'flow_uuid', 'direction'],
    coverage_status: incomplete ? 'incomplete_coverage' : 'complete',
    missing_factor_semantics: 'incomplete_coverage_not_zero',
    counts,
    by_method: byMethod,
    uncharacterized_evidence: artifact,
    ...(gaps.length > 0 ? { uncharacterized_exchanges: gaps } : {}),
  };
}

function listMatchesManifest(listData: LciaMethodListData): boolean {
  if (
    !Array.isArray(listData.files) ||
    listData.files.length !== STATIC_LCIA_CACHE_MANIFEST.methods.length
  ) {
    return false;
  }
  const listed = new Map(listData.files.map((method) => [method.id, method]));
  return STATIC_LCIA_CACHE_MANIFEST.methods.every((method) => {
    const entry = listed.get(method.artifact_locator_id);
    return entry?.version === method.method_version && entry?.filename === method.artifact_filename;
  });
}

function buildSource(
  observedListSha256?: string,
  observedFactorSha256?: string,
): LciaStaticCalculationReport['source'] {
  return {
    schema_version: 'lcia.method_factor_source.static_cache_bundle.v1',
    source_kind: 'static_cache_bundle',
    bundle_version: STATIC_LCIA_CACHE_MANIFEST.bundle_version,
    source_snapshot_sha256: STATIC_LCIA_CACHE_MANIFEST.source_snapshot_sha256,
    method_manifest_sha256: STATIC_LCIA_CACHE_MANIFEST.method_manifest_sha256,
    method_identity_manifest_sha256: STATIC_LCIA_CACHE_MANIFEST.method_identity_manifest_sha256,
    factor_manifest_sha256: STATIC_LCIA_CACHE_MANIFEST.factor_manifest_sha256,
    observed_list_sha256: observedListSha256 ?? null,
    observed_factor_sha256: observedFactorSha256 ?? null,
    applicability_policy_version: LCIA_APPLICABILITY_POLICY_VERSION,
    source_policy_manifest_sha256: SUPPORTED_SOURCE_POLICY_MANIFEST_SHA256,
  };
}

async function buildStaticNoResult(
  exchanges: ProcessExchangeData[],
  status: 'calculation_failure' | 'method_source_drift',
  failureReason: string,
  observed?: { listSha256?: string; factorSha256?: string },
): Promise<LciaStaticCalculationResult> {
  const byMethod = buildMethodRows();
  const gaps: LciaUncharacterizedExchange[] = [];
  for (const [exchangeIndex, exchange] of exchanges.entries()) {
    for (const [methodIndex, method] of STATIC_LCIA_CACHE_MANIFEST.methods.entries()) {
      byMethod[methodIndex].counts.invalid += 1;
      gaps.push(buildGap(method, exchange, exchangeIndex, status));
    }
  }
  const counts = {
    matched: 0,
    unmatched: 0,
    invalid: gaps.length,
    unsupported_direction: 0,
  };
  let matrix: LciaMethodFactorCoverageMatrix;
  try {
    matrix = await buildMatrix(counts, byMethod, gaps);
  } catch {
    matrix = {
      schema_version: 'lcia.method_factor_coverage.matrix.v1',
      source_snapshot_sha256: STATIC_LCIA_CACHE_MANIFEST.source_snapshot_sha256,
      method_manifest_sha256: STATIC_LCIA_CACHE_MANIFEST.method_manifest_sha256,
      method_identity_manifest_sha256: STATIC_LCIA_CACHE_MANIFEST.method_identity_manifest_sha256,
      factor_manifest_sha256: STATIC_LCIA_CACHE_MANIFEST.factor_manifest_sha256,
      count_unit: 'exchange_method_pair',
      key_dimensions: ['method_id', 'method_version', 'flow_uuid', 'direction'],
      coverage_status: 'incomplete_coverage',
      missing_factor_semantics: 'incomplete_coverage_not_zero',
      counts,
      by_method: byMethod,
      uncharacterized_evidence: null,
      // buildMatrix can throw only while hashing a non-empty gap list.
      uncharacterized_exchanges: gaps,
    };
  }
  return {
    results: [],
    report: {
      schema_version: 'lcia.frontend_calculation_report.v1',
      calculation_status: status,
      source: buildSource(observed?.listSha256, observed?.factorSha256),
      method_factor_coverage: matrix,
      failure_reason: failureReason,
    },
  };
}

export async function buildStaticCalculationFailure(
  exchanges: ProcessExchangeData[],
  failureReason: string,
  observed?: { listSha256?: string; factorSha256?: string },
): Promise<LciaStaticCalculationResult> {
  return await buildStaticNoResult(exchanges, 'calculation_failure', failureReason, observed);
}

export async function calculateStaticLcia(
  input: StaticCalculationInput,
): Promise<LciaStaticCalculationResult> {
  const {
    exchanges,
    listData,
    factors,
    observedListSha256,
    observedFactorSha256,
    inventoryClassification,
  } = input;
  const byMethod = buildMethodRows();
  const methodRowById = new Map(byMethod.map((row) => [row.method_id, row]));
  const methodById = new Map(
    STATIC_LCIA_CACHE_MANIFEST.methods.map((method) => [method.method_id, method]),
  );
  const listedByLocator = new Map(
    (Array.isArray(listData.files) ? listData.files : []).map((method) => [method.id, method]),
  );
  const totals = new Map<string, BigNumber>();
  const gaps: LciaUncharacterizedExchange[] = [];
  const sourceDriftReasons: string[] = [];

  if (!listMatchesManifest(listData)) {
    sourceDriftReasons.push('method_list_manifest_mismatch');
  }
  if (observedListSha256 !== STATIC_LCIA_CACHE_MANIFEST.files.list.sha256) {
    sourceDriftReasons.push('method_list_sha256_mismatch');
  }
  if (observedFactorSha256 !== STATIC_LCIA_CACHE_MANIFEST.files.factors.sha256) {
    sourceDriftReasons.push('factor_map_sha256_mismatch');
  }
  if (sourceDriftReasons.length > 0) {
    return await buildStaticNoResult(
      exchanges,
      'method_source_drift',
      sourceDriftReasons.join(','),
      { listSha256: observedListSha256, factorSha256: observedFactorSha256 },
    );
  }

  if (exchanges.length === 0 && !isKnownEmptyLciaInventory(inventoryClassification)) {
    return await buildStaticNoResult(
      exchanges,
      'calculation_failure',
      'lcia_inventory_classification_missing',
      {
        listSha256: observedListSha256,
        factorSha256: observedFactorSha256,
      },
    );
  }
  if (exchanges.length === 0) {
    for (const method of STATIC_LCIA_CACHE_MANIFEST.methods) {
      totals.set(method.method_id, toBigNumberOrZero(0));
    }
  }

  const reasonsByMethod = new Map<string, Set<LciaUncharacterizedReason>>(
    STATIC_LCIA_CACHE_MANIFEST.methods.map((method) => [method.method_id, new Set()]),
  );
  const selectedByAxis = new Map<string, string>();
  const directionByFlow = new Map<string, Set<string>>();
  for (const exchange of exchanges) {
    const flowId = normalizeExchangeFlowRef(exchange)?.['@refObjectId'];
    const amount = toBigNumberOrNaN(exchange.meanAmount);
    if (typeof flowId !== 'string' || amount.isZero()) continue;
    const direction = String(exchange.exchangeDirection ?? '')
      .trim()
      .toUpperCase();
    const directions = directionByFlow.get(flowId) ?? new Set();
    directions.add(direction);
    directionByFlow.set(flowId, directions);
  }

  try {
    for (const [exchangeIndex, exchange] of exchanges.entries()) {
      const flowRef = normalizeExchangeFlowRef(exchange);
      const flowId = String(flowRef?.['@refObjectId'] ?? '').trim();
      const flowVersion = String(flowRef?.['@version'] ?? '');
      const direction = String(exchange.exchangeDirection ?? '')
        .trim()
        .toUpperCase();
      const amount = toBigNumberOrNaN(exchange.meanAmount);
      let sharedReason: LciaUncharacterizedReason | null = null;
      let countKey: keyof LciaCoverageCounts = 'invalid';
      if (
        Array.isArray(exchange.referenceToFlowDataSet) &&
        exchange.referenceToFlowDataSet.length !== 1
      ) {
        sharedReason = 'ambiguous_flow_reference';
      } else if (!flowId) {
        sharedReason = 'missing_flow_uuid';
      } else if (direction !== 'INPUT' && direction !== 'OUTPUT') {
        sharedReason = 'unsupported_direction';
        countKey = 'unsupported_direction';
      } else if (amount.isNaN() || !amount.isFinite()) {
        sharedReason = 'invalid_exchange_amount';
      } else if (!amount.isZero() && directionByFlow.get(flowId)?.size !== 1) {
        sharedReason = 'ambiguous_elementary_flow_direction_axis';
        countKey = 'unsupported_direction';
      }
      if (sharedReason) {
        for (const method of STATIC_LCIA_CACHE_MANIFEST.methods) {
          methodRowById.get(method.method_id)!.counts[countKey] += 1;
          reasonsByMethod.get(method.method_id)!.add(sharedReason);
          gaps.push(buildGap(method, exchange, exchangeIndex, sharedReason));
        }
        continue;
      }
      // Finite zero observations carry no burden and need no factor/location inference.
      if (amount.isZero()) {
        for (const method of STATIC_LCIA_CACHE_MANIFEST.methods) {
          methodRowById.get(method.method_id)!.counts.matched += 1;
          if (!totals.has(method.method_id)) totals.set(method.method_id, toBigNumberOrZero(0));
        }
        continue;
      }
      const group = factors[`${flowId}:${direction}`];
      const rawEntries: unknown = group?.factor;
      const entries = Array.isArray(rawEntries)
        ? rawEntries
        : rawEntries && typeof rawEntries === 'object'
          ? [rawEntries]
          : [];
      const entriesByMethod = new Set<string>();
      for (const factor of entries) {
        const methodId = String(factor?.key ?? '').trim();
        if (!methodById.has(methodId))
          sourceDriftReasons.push(`unknown_factor_method_id:${methodId || '<empty>'}`);
        else entriesByMethod.add(methodId);
      }
      if (sourceDriftReasons.length > 0) break;
      for (const method of STATIC_LCIA_CACHE_MANIFEST.methods) {
        const row = methodRowById.get(method.method_id)!;
        let reason: LciaUncharacterizedReason | null = null;
        let bucket: keyof LciaCoverageCounts = 'invalid';
        if (!/^\d{2}\.\d{2}\.\d{3}$/.test(flowVersion)) {
          reason = 'lcia_inventory_flow_version_invalid';
        } else if (!entriesByMethod.has(method.method_id)) {
          reason = 'missing_factor';
          bucket = 'unmatched';
        } else {
          const policy = await loadSupportedMethodFactors(method.method_id, factors);
          const decision = policy.select(
            flowId,
            flowVersion,
            direction,
            exchangeFactorLocation(exchange.location),
          );
          if (decision.status !== 'selected') {
            reason = decision.reason;
            // This fixed producer retains one unnamed source record per exact family.
            // Missing method/Flow/direction membership is already counted above; a
            // present source can reject applicability but cannot imply a zero/gap.
          } else {
            const axis = `${method.method_id}:${flowId}:${flowVersion}`;
            const record = `${decision.source_record_index}:${decision.source_record_sha256}`;
            const previous = selectedByAxis.get(axis);
            if (previous && previous !== record) {
              reason = 'lcia_mixed_location_axis_unsupported';
            } else {
              selectedByAxis.set(axis, record);
              const value = toBigNumberOrNaN(decision.value);
              if (value.isNaN() || !value.isFinite())
                throw new Error('lcia_supported_policy_static_record_invalid');
              totals.set(
                method.method_id,
                (totals.get(method.method_id) ?? toBigNumberOrZero(0)).plus(amount.times(value)),
              );
              row.counts.matched += 1;
            }
          }
        }
        if (reason) {
          row.counts[bucket] += 1;
          reasonsByMethod.get(method.method_id)!.add(reason);
          gaps.push(buildGap(method, exchange, exchangeIndex, reason));
        }
      }
    }
  } catch (error: unknown) {
    return await buildStaticNoResult(
      exchanges,
      'method_source_drift',
      error instanceof Error ? error.message : String(error),
      {
        listSha256: observedListSha256,
        factorSha256: observedFactorSha256,
      },
    );
  }

  const counts = byMethod.reduce<LciaCoverageCounts>(
    (sum, method) => ({
      matched: sum.matched + method.counts.matched,
      unmatched: sum.unmatched + method.counts.unmatched,
      invalid: sum.invalid + method.counts.invalid,
      unsupported_direction: sum.unsupported_direction + method.counts.unsupported_direction,
    }),
    emptyCounts(),
  );
  const matrix = await buildMatrix(counts, byMethod, gaps);
  const uniqueDriftReasons = Array.from(new Set(sourceDriftReasons)).sort();
  if (uniqueDriftReasons.length > 0) {
    return await buildStaticNoResult(
      exchanges,
      'method_source_drift',
      uniqueDriftReasons.join(','),
      { listSha256: observedListSha256, factorSha256: observedFactorSha256 },
    );
  }
  const categories: LciaAvailability['categories'] = STATIC_LCIA_CACHE_MANIFEST.methods.map(
    (method, impactIndex) => {
      const reasons: string[] = [...reasonsByMethod.get(method.method_id)!].sort();
      return {
        impact_index: impactIndex,
        method_id: method.method_id,
        method_version: method.method_version,
        status: reasons.length === 0 ? 'available' : 'unavailable',
        reasons,
      };
    },
  );
  const availableCount = categories.filter((category) => category.status === 'available').length;
  const availability: LciaAvailability = {
    schema_version: 'lcia.category-availability.v1',
    policy_version: LCIA_APPLICABILITY_POLICY_VERSION,
    completeness:
      availableCount === categories.length
        ? 'complete'
        : availableCount === 0
          ? 'unavailable'
          : 'partial',
    categories,
  };
  parseLciaAvailability(availability);
  const results = STATIC_LCIA_CACHE_MANIFEST.methods.map((method, index) => {
    const value = totals.get(method.method_id);
    const category = categories[index];
    const metadata = listedByLocator.get(method.artifact_locator_id);
    const result: LCIAResultTable = {
      key: method.method_id,
      referenceToLCIAMethodDataSet: {
        '@refObjectId': method.method_id,
        '@type': 'LCIA method data set',
        '@uri': `../lciamethods/${method.artifact_locator_id}.xml`,
        '@version': method.method_version,
        'common:shortDescription': metadata?.description ?? [
          { '@xml:lang': CANONICAL_CONTENT_LANGUAGE, '#text': method.method_id },
        ],
      },
      meanAmount:
        category.status === 'available' && value && value.isFinite() ? value.toString() : null,
      status: category.status,
      reasons: category.reasons,
    };
    return result;
  });

  return {
    results,
    report: {
      schema_version: 'lcia.frontend_calculation_report.v1',
      calculation_status: matrix.coverage_status,
      lcia_availability: availability,
      ...(inventoryClassification ? { inventory_classification: inventoryClassification } : {}),
      source: buildSource(observedListSha256, observedFactorSha256),
      method_factor_coverage: matrix,
      failure_reason: null,
    },
  };
}

/** Keep nullable availability view rows outside the scientific TIDAS LCIAResult array. */
export function persistableStaticLciaResults(
  calculation: LciaStaticCalculationResult,
): LCIAResultTable[] {
  const availability = parseLciaAvailability(calculation.report?.lcia_availability);
  return calculation.results.flatMap((row) => {
    const category = availability?.categories.find(
      (entry) =>
        entry.method_id === row.referenceToLCIAMethodDataSet?.['@refObjectId'] &&
        entry.method_version === row.referenceToLCIAMethodDataSet?.['@version'],
    );
    const amount = row.meanAmount;
    if (
      row.status === 'unavailable' ||
      (availability && category?.status !== 'available') ||
      amount === null ||
      amount === undefined ||
      String(amount).trim() === '' ||
      !Number.isFinite(Number(amount))
    )
      return [];
    const scientific = { ...row };
    delete scientific.status;
    delete scientific.reasons;
    return [scientific];
  });
}
