import LciaAvailabilityNotice, {
  formatLciaUnavailableQueryError,
  formatLciaUnavailableReasons,
  LciaUnavailableValue,
} from '@/components/LciaAvailabilityNotice';
import { render, screen } from '@testing-library/react';
type ReactNode = import('react').ReactNode;
type LciaAvailability = import('@/services/lca/categoryAvailability').LciaAvailability;

const mockMessages: Record<string, string> = {
  'pages.process.lca.availability.unavailable': 'Unavailable',
  'pages.process.lca.availability.reason.version': 'The source revision is unresolved.',
  'pages.process.lca.availability.reason.location': 'The source does not cover this location.',
  'pages.process.lca.availability.reason.condition': 'A source condition is unresolved.',
  'pages.process.lca.availability.reason.source': 'The factor source is not verified.',
  'pages.process.lca.availability.reason.factor': 'No applicable factor is verified.',
  'pages.process.lca.availability.partial': 'Available categories and inventory remain readable.',
  'pages.process.lca.availability.none': 'Inventory remains readable without impact results.',
};
const mockFormatMessage = ({ id, defaultMessage }: { id: string; defaultMessage?: string }) =>
  mockMessages[id] ?? defaultMessage ?? id;

jest.mock('umi', () => ({
  useIntl: () => ({ formatMessage: mockFormatMessage }),
  FormattedMessage: (props: { id: string; defaultMessage?: string }) => mockFormatMessage(props),
}));

jest.mock('antd', () => ({
  Alert: ({ title }: { title: ReactNode }) => <div role='alert'>{title}</div>,
  Tooltip: ({ title, children }: { title?: string; children: ReactNode }) => (
    <span data-testid='availability-tooltip' data-title={title}>
      {children}
    </span>
  ),
  Typography: { Text: ({ children }: { children: ReactNode }) => <span>{children}</span> },
}));

const intl = { formatMessage: mockFormatMessage } as any;

it('explains source, revision and condition failures with localized reasons and no raw codes', () => {
  const reasons = [
    'lcia_flow_version_mismatch',
    'lcia_generic_location_not_admitted',
    'lcia_factor_qualifier_unsupported',
    'lcia_proof_pin_mismatch',
    'lcia_source_unavailable',
  ];
  const detail = formatLciaUnavailableReasons(reasons, intl);
  expect(detail).toBe(
    'The source revision is unresolved. The source does not cover this location. A source condition is unresolved. The factor source is not verified.',
  );
  reasons.forEach((reason) => expect(detail).not.toContain(reason));
});

it('normalizes query reason arrays, transport detail and absent details into readable failures', () => {
  expect(
    formatLciaUnavailableQueryError({ reasons: [17, 'lcia_source_unavailable', null] }, intl),
  ).toBe('Unavailable: The factor source is not verified.');
  expect(formatLciaUnavailableQueryError({ detail: 'lcia_flow_version_mismatch' }, intl)).toBe(
    'Unavailable: The source revision is unresolved.',
  );
  expect(formatLciaUnavailableQueryError(undefined, intl)).toBe(
    'Unavailable: No applicable factor is verified.',
  );
});

it('renders the default unavailable value with an explanatory tooltip', () => {
  render(<LciaUnavailableValue />);
  expect(screen.getByText('Unavailable')).toBeInTheDocument();
  expect(screen.getByTestId('availability-tooltip')).toHaveAttribute(
    'data-title',
    'No applicable factor is verified.',
  );
});

it('preserves readable inventory notices for both partial and all-unavailable results', () => {
  const availability: LciaAvailability = {
    schema_version: 'lcia.category-availability.v1',
    policy_version: 'lcia.applicability.source-bound.v3',
    completeness: 'unavailable',
    categories: [
      {
        impact_index: 0,
        method_id: '11111111-1111-4111-8111-111111111111',
        method_version: '01.00.000',
        status: 'unavailable',
        reasons: ['lcia_generic_location_not_admitted'],
      },
    ],
  };
  const { rerender } = render(<LciaAvailabilityNotice availability={availability} />);
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Inventory remains readable without impact results.',
  );
  rerender(<LciaAvailabilityNotice incomplete />);
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Available categories and inventory remain readable.',
  );
  rerender(<LciaAvailabilityNotice />);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
