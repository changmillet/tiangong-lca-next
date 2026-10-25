import type { LciaAvailability } from '@/services/lca/categoryAvailability';
import { Alert, Tooltip, Typography } from 'antd';
import { FormattedMessage, useIntl } from 'umi';

export function formatLciaUnavailableReasons(
  reasons: string[],
  intl: ReturnType<typeof useIntl>,
): string {
  const formatReason = (reason: string) => {
    if (reason.includes('version'))
      return intl.formatMessage({ id: 'pages.process.lca.availability.reason.version' });
    if (reason.includes('location') || reason.includes('regional'))
      return intl.formatMessage({ id: 'pages.process.lca.availability.reason.location' });
    if (reason.includes('qualifier') || reason.includes('condition'))
      return intl.formatMessage({ id: 'pages.process.lca.availability.reason.condition' });
    if (reason.includes('source') || reason.includes('proof'))
      return intl.formatMessage({ id: 'pages.process.lca.availability.reason.source' });
    return intl.formatMessage({ id: 'pages.process.lca.availability.reason.factor' });
  };
  return Array.from(new Set((reasons.length ? reasons : ['unresolved']).map(formatReason))).join(
    ' ',
  );
}

export function formatLciaUnavailableQueryError(
  body: Record<string, unknown> | undefined,
  intl: ReturnType<typeof useIntl>,
): string {
  const reasons = Array.isArray(body?.reasons)
    ? body.reasons.filter((value): value is string => typeof value === 'string')
    : typeof body?.detail === 'string'
      ? body.detail.split(',')
      : [];
  return `${intl.formatMessage({ id: 'pages.process.lca.availability.unavailable' })}: ${formatLciaUnavailableReasons(reasons, intl)}`;
}

export function LciaUnavailableValue({ reasons = [] }: { reasons?: string[] }) {
  const intl = useIntl();
  const detail = formatLciaUnavailableReasons(reasons, intl);
  return (
    <Tooltip title={detail}>
      <Typography.Text type='secondary'>
        <FormattedMessage
          id='pages.process.lca.availability.unavailable'
          defaultMessage='Unavailable'
        />
      </Typography.Text>
    </Tooltip>
  );
}

export default function LciaAvailabilityNotice({
  availability,
  incomplete = false,
}: {
  availability?: LciaAvailability | null;
  incomplete?: boolean;
}) {
  if (!incomplete && (!availability || availability.completeness === 'complete')) return null;
  return (
    <Alert
      type='warning'
      showIcon
      title={
        availability?.completeness === 'unavailable' ? (
          <FormattedMessage
            id='pages.process.lca.availability.none'
            defaultMessage='Impact assessment is unavailable. Inventory remains readable; no complete assessment or aggregate score is available.'
          />
        ) : (
          <FormattedMessage
            id='pages.process.lca.availability.partial'
            defaultMessage='Some impact categories are unavailable. Available categories and inventory remain readable; incomplete results cannot be used as a complete assessment.'
          />
        )
      }
    />
  );
}
