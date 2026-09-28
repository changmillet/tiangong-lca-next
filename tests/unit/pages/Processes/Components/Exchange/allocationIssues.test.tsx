import AllocationIssues from '@/pages/Processes/Components/Exchange/allocationIssues';
import { render, screen } from '@testing-library/react';

jest.mock('umi', () => ({
  useIntl: () => ({
    formatMessage: ({ defaultMessage }: { defaultMessage: string }) => defaultMessage,
  }),
}));

it('lists each affected exchange, target identity and actionable reason', () => {
  render(
    <AllocationIssues
      lang='en'
      exchanges={[
        {
          '@dataSetInternalID': '1',
          referenceToFlowDataSet: [
            { 'common:shortDescription': [{ '@xml:lang': 'en', '#text': 'Electricity' }] },
          ],
        },
        {
          '@dataSetInternalID': '2',
          referenceToFlowDataSet: {
            'common:shortDescription': [{ '@xml:lang': 'en', '#text': 'Product A' }],
          },
        },
      ]}
      problems={[
        { code: 'target', exchangeId: '1', targetIds: ['2', '99'] },
        { code: 'duplicate', exchangeId: '1', targetIds: ['2'] },
        { code: 'fraction', exchangeId: '1', targetIds: [] },
        { code: 'total', exchangeId: '1', targetIds: [] },
        { code: 'mixed', exchangeId: '1', targetIds: [] },
        { code: 'legacyInput', exchangeId: '1', targetIds: [] },
        { code: 'unverified', exchangeId: 'missing', targetIds: ['2'] },
      ]}
    />,
  );
  const alert = screen.getByRole('alert');
  for (const text of [
    'Electricity (#1)',
    'Product A (#2)',
    '#99',
    '#missing',
    'target is missing',
    'target is repeated',
    '0 to 100',
    'total 100%',
    'cannot be mixed',
    'only valid on outputs',
    'could not be verified',
  ])
    expect(alert).toHaveTextContent(text);
});

it('does not show an allocation issue after repair', () => {
  render(<AllocationIssues lang='en' exchanges={[]} problems={[]} />);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
