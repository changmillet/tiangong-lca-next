import { getFlowProperties } from '../flows/api';
import {
  allocationEntries,
  allocationTargetIds,
  collectAllocationProblems,
  isLegacyAllocation,
  type AllocationProblem,
} from './allocation';
import type { ProcessExchangeData } from './data';

// Resolve product identity against the exact revision. The existing properties
// lookup can fall back to another revision; such rows do not verify a target.
export const verifyAllocationProductProblems = async (
  exchanges: ProcessExchangeData[],
): Promise<AllocationProblem[]> => {
  const problems = collectAllocationProblems(exchanges);
  if (problems.length) return problems;
  const targetIds = new Set(
    exchanges.flatMap((exchange) =>
      isLegacyAllocation(exchange.allocations?.allocation)
        ? []
        : allocationEntries(exchange.allocations?.allocation).map((entry) =>
            String(entry['@internalReferenceToCoProduct']),
          ),
    ),
  );
  if (!targetIds.size) return [];
  const refs = exchanges
    .filter((exchange) => targetIds.has(String(exchange['@dataSetInternalID'])))
    .map((exchange) => {
      const ref = Array.isArray(exchange.referenceToFlowDataSet)
        ? exchange.referenceToFlowDataSet[0]
        : exchange.referenceToFlowDataSet;
      return { id: ref?.['@refObjectId'] ?? '', version: ref?.['@version'] ?? '' };
    });
  const affected = (ids: Set<string>, code: 'target' | 'unverified'): AllocationProblem[] =>
    exchanges.flatMap((exchange) => {
      const targets = allocationTargetIds(exchange).filter((id) => ids.has(id));
      return targets.length
        ? [{ code, exchangeId: String(exchange['@dataSetInternalID']), targetIds: targets }]
        : [];
    });
  if (refs.some((ref) => !ref.id || !ref.version)) return affected(targetIds, 'target');
  try {
    const response = await getFlowProperties(refs);
    if (!response?.data) return affected(targetIds, 'unverified');
    const invalidIds = new Set(
      exchanges
        .filter((exchange) => {
          if (!targetIds.has(String(exchange['@dataSetInternalID']))) return false;
          const ref = Array.isArray(exchange.referenceToFlowDataSet)
            ? exchange.referenceToFlowDataSet[0]
            : exchange.referenceToFlowDataSet;
          return !response.data.some(
            (flow: { id: string; version: string; typeOfDataSet: string }) =>
              flow.id === ref?.['@refObjectId'] &&
              flow.version === ref?.['@version'] &&
              flow.typeOfDataSet === 'Product flow',
          );
        })
        .map((exchange) => String(exchange['@dataSetInternalID'])),
    );
    return affected(invalidIds, 'target');
  } catch {
    return affected(targetIds, 'unverified');
  }
};

export const verifyAllocationProducts = async (exchanges: ProcessExchangeData[]) => {
  const problem = (await verifyAllocationProductProblems(exchanges))[0];
  return problem?.code === 'unverified' ? 'target' : problem?.code;
};
