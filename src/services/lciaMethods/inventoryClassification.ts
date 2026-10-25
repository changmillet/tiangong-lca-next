export type FlowType = 'Elementary flow' | 'Product flow' | 'Waste flow';
export type LciaFlowMetadata = { id: string; version: string; typeOfDataSet?: string };
export type LciaInventoryClassification = {
  schema_version: 'lcia.inventory-classification.v1';
  source_kind: 'exact_flow_revision_metadata';
  exchange_count: number;
  elementary_exchange_count: number;
  non_elementary_exchange_count: number;
  unresolved_exchange_count: number;
  metadata_sha256: string;
  bindings: {
    exchange_id: string;
    flow_id: string;
    flow_version: string;
    type_of_dataset: FlowType | 'Unknown';
  }[];
};

export function knownFlowType(value: unknown): value is FlowType {
  return value === 'Elementary flow' || value === 'Product flow' || value === 'Waste flow';
}

export const flowRevisionKey = (id: string, version: string) => `${id}@${version}`;
export const exactFlowReference = (id: string, version: string) =>
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id) &&
  /^\d{2}\.\d{2}\.\d{3}$/.test(version);

export function normalizeLciaInventoryClassification(
  value: unknown,
): LciaInventoryClassification | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as LciaInventoryClassification;
  if (
    Object.keys(raw).length !== 8 ||
    raw.schema_version !== 'lcia.inventory-classification.v1' ||
    raw.source_kind !== 'exact_flow_revision_metadata' ||
    !/^[0-9a-f]{64}$/.test(raw.metadata_sha256) ||
    !Array.isArray(raw.bindings) ||
    ![
      raw.exchange_count,
      raw.elementary_exchange_count,
      raw.non_elementary_exchange_count,
      raw.unresolved_exchange_count,
    ].every((count) => Number.isSafeInteger(count) && count >= 0) ||
    raw.exchange_count !== raw.bindings.length ||
    !raw.bindings.every(
      (binding) =>
        binding &&
        Object.keys(binding).length === 4 &&
        typeof binding.exchange_id === 'string' &&
        typeof binding.flow_id === 'string' &&
        typeof binding.flow_version === 'string' &&
        (binding.type_of_dataset === 'Unknown' ||
          (knownFlowType(binding.type_of_dataset) &&
            exactFlowReference(binding.flow_id, binding.flow_version))),
    ) ||
    raw.elementary_exchange_count !==
      raw.bindings.filter((binding) => binding.type_of_dataset === 'Elementary flow').length ||
    raw.non_elementary_exchange_count !==
      raw.bindings.filter(
        (binding) =>
          binding.type_of_dataset === 'Product flow' || binding.type_of_dataset === 'Waste flow',
      ).length ||
    raw.unresolved_exchange_count !==
      raw.bindings.filter((binding) => binding.type_of_dataset === 'Unknown').length
  )
    return null;
  return raw;
}

export function isKnownEmptyLciaInventory(value: unknown): boolean {
  const receipt = normalizeLciaInventoryClassification(value);
  return Boolean(
    receipt && receipt.elementary_exchange_count === 0 && receipt.unresolved_exchange_count === 0,
  );
}
