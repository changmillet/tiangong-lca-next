import { getFlowProperties } from '@/services/flows/api';
import type { ProcessExchangeData } from '@/services/processes/data';
import { canonicalJson, computeLciaSha256 } from './evidence';

import {
  exactFlowReference,
  flowRevisionKey,
  knownFlowType,
  type LciaFlowMetadata,
  type LciaInventoryClassification,
} from './inventoryClassification';
export type { LciaFlowMetadata, LciaInventoryClassification } from './inventoryClassification';

function reference(exchange: ProcessExchangeData) {
  const value = exchange.referenceToFlowDataSet;
  return Array.isArray(value) ? (value.length === 1 ? value[0] : undefined) : value;
}

/** Deduplicate exact revisions and batch the existing reader; its revision fallback is rejected. */
export async function resolveLciaFlowMetadata(
  exchanges: ProcessExchangeData[],
  existing: readonly LciaFlowMetadata[] = [],
): Promise<LciaFlowMetadata[]> {
  const requested = new Map<string, { id: string; version: string }>();
  for (const exchange of exchanges) {
    const ref = reference(exchange);
    const id = String(ref?.['@refObjectId'] ?? '');
    const version = String(ref?.['@version'] ?? '');
    if (exactFlowReference(id, version))
      requested.set(flowRevisionKey(id, version), { id, version });
  }
  const resolved = new Map<string, LciaFlowMetadata>();
  for (const row of existing) {
    const key = flowRevisionKey(row.id, row.version);
    if (!requested.has(key)) continue;
    const previous = resolved.get(key);
    resolved.set(
      key,
      previous && previous.typeOfDataSet !== row.typeOfDataSet
        ? { id: row.id, version: row.version }
        : row,
    );
  }
  const pending = [...requested.values()].filter(
    (item) => !resolved.has(flowRevisionKey(item.id, item.version)),
  );
  const batches: (typeof pending)[] = [];
  for (let offset = 0; offset < pending.length; offset += 100)
    batches.push(pending.slice(offset, offset + 100));
  for (let offset = 0; offset < batches.length; offset += 4) {
    await Promise.all(
      batches.slice(offset, offset + 4).map(async (batch) => {
        let rows: LciaFlowMetadata[] = [];
        try {
          const response = await getFlowProperties(batch);
          if (
            response?.success !== false &&
            !('error' in response && response.error) &&
            Array.isArray(response?.data)
          )
            rows = response.data;
        } catch {
          // Unknown remains explicit below; neither the reference flag nor factor absence can classify it.
        }
        for (const item of batch) {
          const matches = rows.filter((row) => row.id === item.id && row.version === item.version);
          const types = new Set(matches.map((row) => row.typeOfDataSet));
          resolved.set(
            flowRevisionKey(item.id, item.version),
            matches.length > 0 && types.size === 1
              ? matches[0]
              : { id: item.id, version: item.version },
          );
        }
      }),
    );
  }
  return [...requested.keys()].map((key) => resolved.get(key)!);
}

export async function classifyLciaInventory(
  exchanges: ProcessExchangeData[],
  existing?: readonly LciaFlowMetadata[],
): Promise<{ exchanges: ProcessExchangeData[]; receipt: LciaInventoryClassification }> {
  const metadata = await resolveLciaFlowMetadata(exchanges, existing);
  const byRevision = new Map(metadata.map((row) => [flowRevisionKey(row.id, row.version), row]));
  const elementary: ProcessExchangeData[] = [];
  const bindings: LciaInventoryClassification['bindings'] = exchanges.map((exchange, index) => {
    const ref = reference(exchange);
    const id = String(ref?.['@refObjectId'] ?? '');
    const version = String(ref?.['@version'] ?? '');
    const row = byRevision.get(flowRevisionKey(id, version));
    const type = knownFlowType(row?.typeOfDataSet) ? row.typeOfDataSet : 'Unknown';
    if (type === 'Elementary flow') elementary.push(exchange);
    return {
      exchange_id: String(exchange['@dataSetInternalID'] ?? `exchange-${index + 1}`),
      flow_id: id,
      flow_version: version,
      type_of_dataset: type,
    };
  });
  return {
    exchanges: elementary,
    receipt: {
      schema_version: 'lcia.inventory-classification.v1',
      source_kind: 'exact_flow_revision_metadata',
      exchange_count: bindings.length,
      elementary_exchange_count: elementary.length,
      non_elementary_exchange_count: bindings.filter(
        (binding) =>
          binding.type_of_dataset === 'Product flow' || binding.type_of_dataset === 'Waste flow',
      ).length,
      unresolved_exchange_count: bindings.filter((binding) => binding.type_of_dataset === 'Unknown')
        .length,
      metadata_sha256: await computeLciaSha256(canonicalJson(metadata)),
      bindings,
    },
  };
}
