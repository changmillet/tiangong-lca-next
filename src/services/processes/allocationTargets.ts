import { getFlowProperties } from '../flows/api';
import { allocationEntries, isLegacyAllocation, validateProcessAllocations } from './allocation';
import type { ProcessExchangeData } from './data';

// Resolve product identity against the exact revision. The existing properties
// lookup can fall back to another revision; such rows do not verify a target.
export const verifyAllocationProducts = async (exchanges: ProcessExchangeData[]) => {
  const issue = validateProcessAllocations(exchanges);
  if (issue) return issue;
  const targetIds = new Set(
    exchanges.flatMap((exchange) =>
      isLegacyAllocation(exchange.allocations?.allocation)
        ? []
        : allocationEntries(exchange.allocations?.allocation).map((entry) =>
            String(entry['@internalReferenceToCoProduct']),
          ),
    ),
  );
  if (!targetIds.size) return undefined;
  const refs = exchanges
    .filter((exchange) => targetIds.has(String(exchange['@dataSetInternalID'])))
    .map((exchange) => {
      const ref = Array.isArray(exchange.referenceToFlowDataSet)
        ? exchange.referenceToFlowDataSet[0]
        : exchange.referenceToFlowDataSet;
      return { id: ref?.['@refObjectId'] ?? '', version: ref?.['@version'] ?? '' };
    });
  if (refs.some((ref) => !ref.id || !ref.version)) return 'target';
  try {
    const response = await getFlowProperties(refs);
    return refs.every((ref) =>
      response?.data?.some(
        (flow: { id: string; version: string; typeOfDataSet: string }) =>
          flow.id === ref.id &&
          flow.version === ref.version &&
          flow.typeOfDataSet === 'Product flow',
      ),
    )
      ? undefined
      : 'target';
  } catch {
    return 'target';
  }
};
