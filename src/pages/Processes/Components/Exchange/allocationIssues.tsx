import { Alert } from 'antd';
import { useIntl } from 'umi';
import type { AllocationProblem } from '@/services/processes/allocation';
import type { ProcessExchangeData } from '@/services/processes/data';
import { allocationProblemText } from './allocationFeedback';

export default function AllocationIssues({
  problems,
  exchanges,
  lang,
}: {
  problems: AllocationProblem[];
  exchanges: ProcessExchangeData[];
  lang: string;
}) {
  const intl = useIntl();
  return problems.length ? (
    <Alert
      type='warning'
      showIcon
      title={
        <span style={{ whiteSpace: 'pre-line' }}>
          {allocationProblemText(problems, exchanges, lang, intl)}
        </span>
      }
    />
  ) : null;
}
