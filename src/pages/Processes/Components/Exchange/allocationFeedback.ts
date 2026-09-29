import { getLangText } from '@/services/general/util';
import type { AllocationProblem } from '@/services/processes/allocation';
import type { ProcessExchangeData } from '@/services/processes/data';

type Formatter = { formatMessage: (message: { id: string; defaultMessage: string }) => string };

export const allocationProblemText = (
  problems: AllocationProblem[],
  exchanges: ProcessExchangeData[],
  lang: string,
  intl: Formatter,
) =>
  problems
    .map((problem) => {
      const label = (id: string) => {
        const row = exchanges.find((exchange) => String(exchange['@dataSetInternalID']) === id);
        const ref = Array.isArray(row?.referenceToFlowDataSet)
          ? row.referenceToFlowDataSet[0]
          : row?.referenceToFlowDataSet;
        return `${getLangText(ref?.['common:shortDescription'], lang)} (#${id})`;
      };
      let reason: string;
      switch (problem.code) {
        case 'target':
          reason = intl.formatMessage({
            id: 'pages.process.allocation.reason.target',
            defaultMessage: 'The target is missing or is not a verified product output.',
          });
          break;
        case 'duplicate':
          reason = intl.formatMessage({
            id: 'pages.process.allocation.reason.duplicate',
            defaultMessage: 'A target is repeated.',
          });
          break;
        case 'fraction':
          reason = intl.formatMessage({
            id: 'pages.process.allocation.reason.fraction',
            defaultMessage: 'Each share must be a number from 0 to 100.',
          });
          break;
        case 'total':
          reason = intl.formatMessage({
            id: 'pages.process.allocation.reason.total',
            defaultMessage: 'Shares must total 100%.',
          });
          break;
        case 'mixed':
          reason = intl.formatMessage({
            id: 'pages.process.allocation.reason.mixed',
            defaultMessage: 'Legacy shares and target allocations cannot be mixed.',
          });
          break;
        case 'legacyInput':
          reason = intl.formatMessage({
            id: 'pages.process.allocation.reason.legacyInput',
            defaultMessage: 'Legacy shares are only valid on outputs.',
          });
          break;
        case 'unverified':
          reason = intl.formatMessage({
            id: 'pages.process.allocation.reason.unverified',
            defaultMessage: 'Product targets could not be verified. Reopen to retry.',
          });
          break;
      }
      return `${label(problem.exchangeId)}: ${reason}${problem.targetIds.length ? ` → ${problem.targetIds.map(label).join(', ')}` : ''}`;
    })
    .join('\n');
