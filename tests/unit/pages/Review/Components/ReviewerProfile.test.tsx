// @ts-nocheck
import ReviewerProfile from '@/pages/Review/Components/ReviewerProfile';
import { act, fireEvent, render, screen, waitFor } from '../../../../helpers/testUtils';

const mockActivateReviewerContact = jest.fn();
const mockGenContactFromData = jest.fn();
const mockModalConfirm = jest.fn();
const mockMessageSuccess = jest.fn();
const mockMessageError = jest.fn();
const mockResetFields = jest.fn();
const mockSetFieldsValue = jest.fn();
const mockGetFieldsValue = jest.fn(() => ({ form: 'values' }));
const mockValidateFields = jest.fn();
let mockProvideFormRef = true;

jest.mock('@/services/reviewerContacts/api', () => ({
  activateReviewerContact: (...args: any[]) => mockActivateReviewerContact(...args),
}));

jest.mock('@/services/contacts/util', () => ({
  genContactFromData: (...args: any[]) => mockGenContactFromData(...args),
}));

jest.mock('@/services/general/util', () => ({
  formatDateTime: () => '2026-09-24T00:00:00Z',
  getLang: (locale: string) => `lang:${locale}`,
  getLangText: (values: any[]) => values?.[0]?.['#text'] ?? '-',
}));

jest.mock('@/services/general/data', () => ({ initVersion: '01.00.000' }));
jest.mock('uuid', () => ({ v4: () => 'generated-contact-id' }));

jest.mock('umi', () => ({
  FormattedMessage: ({ id, defaultMessage }: any) => <span>{defaultMessage ?? id}</span>,
  useIntl: () => ({
    locale: 'en-US',
    formatMessage: ({ id, defaultMessage }: any) => defaultMessage ?? id,
  }),
}));

jest.mock('@ant-design/icons', () => ({
  CloseOutlined: () => <span>close-icon</span>,
  EditOutlined: () => <span>edit-icon</span>,
  PlusOutlined: () => <span>plus-icon</span>,
}));

jest.mock('@ant-design/pro-components', () => ({
  ProForm: ({ formRef, initialValues, onValuesChange, children }: any) => {
    if (mockProvideFormRef) {
      formRef.current = {
        resetFields: mockResetFields,
        setFieldsValue: mockSetFieldsValue,
        getFieldsValue: mockGetFieldsValue,
        validateFields: mockValidateFields,
      };
    }
    return (
      <div data-testid='pro-form' data-initial-values={JSON.stringify(initialValues ?? null)}>
        <button type='button' onClick={() => onValuesChange?.({}, { changed: true })}>
          change-form-values
        </button>
        {children}
      </div>
    );
  },
}));

jest.mock('@/pages/Contacts/Components/form', () => ({
  ContactForm: ({ formType, lang, activeTabKey, onData, onTabChange, lockOwnership }: any) => (
    <div
      data-testid='contact-form'
      data-form-type={formType}
      data-lang={lang}
      data-active-tab={activeTabKey}
      data-lock-ownership={String(lockOwnership)}
    >
      <button type='button' onClick={onData}>
        emit-data
      </button>
      <button type='button' onClick={() => onTabChange('administrativeInformation')}>
        change-tab
      </button>
    </div>
  ),
}));

jest.mock('antd', () => {
  const React = require('react');
  const Button = ({ children, onClick, icon, loading: _loading, ...props }: any) => {
    void _loading;
    return (
      <button type='button' onClick={onClick} {...props}>
        {icon}
        {children}
      </button>
    );
  };
  const Spin = ({ children, spinning }: any) => (
    <div data-testid='spin' data-spinning={String(Boolean(spinning))}>
      {children}
    </div>
  );
  const Alert = ({ title, action, type }: any) => (
    <div data-testid={`alert-${type}`}>
      {title}
      {action}
    </div>
  );
  const Card = ({ title, extra, children }: any) => (
    <section data-testid='card'>
      {title}
      {extra}
      {children}
    </section>
  );
  const Descriptions = ({ items = [] }: any) => (
    <dl data-testid='descriptions'>
      {items.map((item: any) => (
        <React.Fragment key={item.key}>
          <dt>{item.label}</dt>
          <dd>{item.children}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
  const Drawer = ({ open, onClose, title, extra, footer, children }: any) =>
    open ? (
      <section data-testid='drawer'>
        {title}
        {extra}
        <button type='button' onClick={onClose}>
          drawer-on-close
        </button>
        {children}
        {footer}
      </section>
    ) : null;
  const Space = ({ children }: any) => <div>{children}</div>;
  const App = ({ children }: any) => <>{children}</>;
  App.useApp = () => ({
    message: { success: mockMessageSuccess, error: mockMessageError },
    modal: { confirm: mockModalConfirm },
  });
  return { App, Alert, Button, Card, Descriptions, Drawer, Space, Spin };
});

const missingStatus = {
  status: 'missing',
  ready: false,
  contact: null,
  dataset: null,
};

const readyStatus = {
  status: 'ready',
  ready: true,
  contact: { '@refObjectId': 'contact-1', '@version': '01.00.000' },
  dataset: {
    id: 'contact-1',
    version: '01.00.000',
    state_code: 100,
    rule_verification: true,
    json_ordered: {
      contactDataSet: {
        persisted: true,
        contactInformation: {
          dataSetInformation: {
            'common:name': [{ '@xml:lang': 'en', '#text': 'Alice Reviewer' }],
          },
        },
      },
    },
  },
};

const latestConfirm = () => mockModalConfirm.mock.calls.at(-1)?.[0];

describe('ReviewerProfile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProvideFormRef = true;
    mockValidateFields.mockResolvedValue(undefined);
    mockGenContactFromData.mockReturnValue({ persisted: 'form-data' });
    mockActivateReviewerContact.mockResolvedValue({ data: { ok: true }, error: null });
  });

  it('renders loading and retry states', async () => {
    const onRefresh = jest.fn();
    const { rerender } = render(
      <ReviewerProfile status={null} loading error={null} onRefresh={onRefresh} />,
    );
    expect(screen.getByTestId('spin')).toBeInTheDocument();

    rerender(
      <ReviewerProfile
        status={null}
        loading={false}
        error={{ message: 'offline' }}
        onRefresh={onRefresh}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('creates a self-owned open-data profile and binds it to the reviewer', async () => {
    const onRefresh = jest.fn().mockResolvedValue(undefined);
    render(
      <ReviewerProfile
        status={missingStatus as any}
        loading={false}
        error={null}
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByTestId('alert-warning')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /pages.review.reviewerProfile.create/ }));

    await waitFor(() => expect(screen.getByTestId('drawer')).toBeInTheDocument());
    expect(screen.getByTestId('contact-form')).toHaveAttribute('data-form-type', 'create');
    expect(screen.getByTestId('contact-form')).toHaveAttribute('data-lang', 'lang:en-US');
    expect(screen.getByTestId('contact-form')).toHaveAttribute('data-lock-ownership', 'true');
    expect(mockSetFieldsValue).toHaveBeenCalledWith(
      expect.objectContaining({
        administrativeInformation: expect.objectContaining({
          publicationAndOwnership: expect.objectContaining({
            'common:referenceToOwnershipOfDataSet': expect.objectContaining({
              '@refObjectId': 'generated-contact-id',
              '@version': '01.00.000',
            }),
          }),
        }),
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'change-form-values' }));
    fireEvent.click(screen.getByRole('button', { name: 'emit-data' }));
    fireEvent.click(screen.getByRole('button', { name: 'change-tab' }));
    expect(screen.getByTestId('contact-form')).toHaveAttribute(
      'data-active-tab',
      'administrativeInformation',
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'pages.review.reviewerProfile.validateAndPublish' }),
    );
    await waitFor(() => expect(mockModalConfirm).toHaveBeenCalled());
    await act(async () => latestConfirm().onOk());

    expect(mockActivateReviewerContact).toHaveBeenCalledWith({
      mode: 'create',
      id: 'generated-contact-id',
      sourceVersion: undefined,
      formData: { form: 'values' },
      bind: true,
      expectedContact: null,
    });
    expect(mockMessageSuccess).toHaveBeenCalledWith('Reviewer profile published and bound.');
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('drawer')).not.toBeInTheDocument();
  });

  it('requires a new version and supports publish-only without changing the binding', async () => {
    const onRefresh = jest.fn().mockResolvedValue(undefined);
    render(
      <ReviewerProfile
        status={readyStatus as any}
        loading={false}
        error={null}
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByTestId('descriptions')).toHaveTextContent('contact-1');
    expect(screen.getByTestId('descriptions')).toHaveTextContent(
      'pages.review.reviewerProfile.contactName',
    );
    expect(screen.getByTestId('descriptions')).toHaveTextContent('Alice Reviewer');
    expect(screen.getByTestId('descriptions')).toHaveTextContent(
      'pages.review.reviewerProfile.ready',
    );
    fireEvent.click(screen.getByRole('button', { name: /pages.review.reviewerProfile.update/ }));
    expect(latestConfirm().title).toBe('Create a new version to update');
    act(() => latestConfirm().onOk());

    await waitFor(() => expect(screen.getByTestId('drawer')).toBeInTheDocument());
    expect(mockGenContactFromData).toHaveBeenCalledWith(
      readyStatus.dataset.json_ordered.contactDataSet,
    );
    expect(screen.getByTestId('contact-form')).toHaveAttribute('data-form-type', 'createVersion');

    fireEvent.click(
      screen.getByRole('button', { name: 'pages.review.reviewerProfile.validateAndPublish' }),
    );
    await waitFor(() => expect(latestConfirm().title).toBe('Bind the new version?'));
    await act(async () => latestConfirm().onCancel());

    expect(mockActivateReviewerContact).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'createVersion',
        id: 'contact-1',
        sourceVersion: '01.00.000',
        bind: false,
        expectedContact: readyStatus.contact,
      }),
    );
    expect(mockMessageSuccess).toHaveBeenCalledWith(
      'New version published. The previous version remains bound.',
    );
  });

  it('binds a new version and reports activation errors from every response shape', async () => {
    const onRefresh = jest.fn().mockResolvedValue(undefined);
    const { unmount } = render(
      <ReviewerProfile
        status={{ ...readyStatus, status: 'invalid', ready: false } as any}
        loading={false}
        error={null}
        onRefresh={onRefresh}
      />,
    );
    expect(screen.getByTestId('descriptions')).toHaveTextContent(
      'pages.review.reviewerProfile.invalid',
    );
    expect(screen.getByTestId('alert-warning')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /pages.review.reviewerProfile.update/ }));
    act(() => latestConfirm().onOk());
    await waitFor(() => expect(screen.getByTestId('drawer')).toBeInTheDocument());
    fireEvent.click(
      screen.getByRole('button', { name: 'pages.review.reviewerProfile.validateAndPublish' }),
    );
    await waitFor(() => expect(latestConfirm().title).toBe('Bind the new version?'));
    await act(async () => latestConfirm().onOk());
    expect(mockActivateReviewerContact).toHaveBeenLastCalledWith(
      expect.objectContaining({ bind: true }),
    );

    unmount();
    for (const response of [
      { data: null, error: { message: 'transport error' } },
      { data: { ok: false, message: 'command error' }, error: null },
      { data: { ok: false }, error: null },
    ]) {
      mockActivateReviewerContact.mockResolvedValueOnce(response);
      const view = render(
        <ReviewerProfile
          status={missingStatus as any}
          loading={false}
          error={null}
          onRefresh={onRefresh}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /pages.review.reviewerProfile.create/ }));
      await waitFor(() => expect(screen.getByTestId('drawer')).toBeInTheDocument());
      fireEvent.click(
        screen.getByRole('button', { name: 'pages.review.reviewerProfile.validateAndPublish' }),
      );
      await waitFor(() => expect(latestConfirm().title).toBe('Publish reviewer profile'));
      await act(async () => latestConfirm().onOk());
      view.unmount();
    }

    expect(mockMessageError).toHaveBeenNthCalledWith(1, 'transport error');
    expect(mockMessageError).toHaveBeenNthCalledWith(2, 'command error');
    expect(mockMessageError).toHaveBeenNthCalledWith(3, 'Action failed');
  });

  it('supports every drawer close path and a missing form instance', async () => {
    const onRefresh = jest.fn().mockResolvedValue(undefined);
    const view = render(
      <ReviewerProfile
        status={missingStatus as any}
        loading={false}
        error={null}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /pages.review.reviewerProfile.create/ }));
    await screen.findByTestId('drawer');
    fireEvent.click(screen.getByRole('button', { name: 'drawer-on-close' }));

    fireEvent.click(screen.getByRole('button', { name: /pages.review.reviewerProfile.create/ }));
    fireEvent.click(screen.getByRole('button', { name: /close-icon/ }));

    fireEvent.click(screen.getByRole('button', { name: /pages.review.reviewerProfile.create/ }));
    fireEvent.click(screen.getByRole('button', { name: 'pages.button.cancel' }));
    view.unmount();

    mockProvideFormRef = false;
    render(<ReviewerProfile status={null} loading={false} error={null} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole('button', { name: /pages.review.reviewerProfile.create/ }));
    await screen.findByTestId('drawer');
    fireEvent.click(screen.getByRole('button', { name: 'emit-data' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'pages.review.reviewerProfile.validateAndPublish' }),
    );
    await waitFor(() => expect(latestConfirm().title).toBe('Publish reviewer profile'));
  });
});
