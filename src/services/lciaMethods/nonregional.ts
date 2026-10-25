import defaults from '../../../public/lciamethods/nonregional_defaults.json';
import type { LciaFlowFactorEntry } from './data';

const alternatives = new Map(
  defaults.methods.flatMap((method) =>
    method.alternatives.map(
      (entry) =>
        [
          `${method.method_id}:${entry.flow_id}:${entry.flow_version}:${entry.direction}`,
          entry,
        ] as const,
    ),
  ),
);

/** Source-bound defaults for the immutable bundle; location is not a prerequisite. */
export function selectNonregionalFactors(
  methodId: string,
  flowId: string,
  flowVersion: string,
  direction: string,
  factors: LciaFlowFactorEntry[],
): LciaFlowFactorEntry[] | null {
  if (factors.length === 0) return factors;
  const prepared = alternatives.get(`${methodId}:${flowId}:${flowVersion}:${direction}`);
  if (!prepared) return factors.length <= 1 ? factors : null;
  if (factors.length !== prepared.alternative_count) return null;
  const bytes = new DataView(new ArrayBuffer(8));
  bytes.setBigUint64(0, BigInt(`0x${prepared.value_bits}`));
  const value = bytes.getFloat64(0);
  const factor = factors.find((entry) => Object.is(Number(entry.value), value));
  return factor ? [factor] : null;
}
