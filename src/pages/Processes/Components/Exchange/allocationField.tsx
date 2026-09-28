import { isLegacyAllocation, validateAllocation } from '@/services/processes/allocation';
import type { ProcessExchangeData } from '@/services/processes/data';
import { Form } from 'antd';
import { useIntl } from 'umi';
import AllocationEditor, { useAllocationTargets } from './allocationEditor';

export default function AllocationField({
  exchanges,
  lang,
  allowLegacy,
}: {
  exchanges: ProcessExchangeData[];
  lang: string;
  allowLegacy?: boolean;
}) {
  const intl = useIntl();
  const { targets, loading, failed } = useAllocationTargets(exchanges, lang);
  return (
    <Form.Item
      name={['allocations', 'allocation']}
      rules={[
        {
          validator: async (_, value) => {
            if (allowLegacy && isLegacyAllocation(value)) return;
            if (validateAllocation(value, new Set(targets.map((target) => target.value)))) {
              throw new Error(
                intl.formatMessage({
                  id: 'pages.process.allocation.invalid',
                  defaultMessage:
                    'Check allocation targets and shares: each explicit allocation must total 100%, and legacy shares cannot be mixed with targeted allocations.',
                }),
              );
            }
          },
        },
      ]}
    >
      <AllocationEditor targets={targets} loading={loading} failed={failed} />
    </Form.Item>
  );
}
