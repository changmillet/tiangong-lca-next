// @ts-nocheck
import AddMemberModal from '@/pages/Review/Components/AddMemberModal';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from '../../../../helpers/testUtils';

const mockAddReviewMemberApi = jest.fn();
const mockGetUserInfoByEmail = jest.fn();
const mockMessageSuccess = jest.fn();
const mockMessageError = jest.fn();

jest.mock('@umijs/max', () => ({
  FormattedMessage: ({ id, defaultMessage }: any) => defaultMessage ?? id,
  useIntl: () => ({ formatMessage: ({ id, defaultMessage }: any) => defaultMessage ?? id }),
}));

jest.mock('antd', () => {
  const actual = jest.requireActual('antd');
  return {
    ...actual,
    App: {
      ...actual.App,
      useApp: () => ({ message: { success: mockMessageSuccess, error: mockMessageError } }),
    },
  };
});

jest.mock('@/services/roles/api', () => ({
  addReviewMemberApi: (...args: any[]) => mockAddReviewMemberApi(...args),
}));
jest.mock('@/services/users/api', () => ({
  getUserInfoByEmail: (...args: any[]) => mockGetUserInfoByEmail(...args),
}));

describe('ReviewAddMemberModal', () => {
  beforeEach(() => jest.clearAllMocks());

  const submitEmail = async (email = 'reviewer@example.com') => {
    await userEvent.type(screen.getByLabelText('Email'), email);
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
  };

  it('adds a reviewer directly from the registered email without contact selection', async () => {
    mockGetUserInfoByEmail.mockResolvedValue({
      success: true,
      user: { id: 'reviewer-1' },
    });
    mockAddReviewMemberApi.mockResolvedValue({ success: true, error: null });
    const onCancel = jest.fn();
    const onSuccess = jest.fn();
    render(<AddMemberModal open onCancel={onCancel} onSuccess={onSuccess} />);

    await submitEmail();

    await waitFor(() =>
      expect(mockGetUserInfoByEmail).toHaveBeenCalledWith('reviewer@example.com'),
    );
    expect(mockAddReviewMemberApi).toHaveBeenCalledWith('reviewer-1');
    expect(onSuccess).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
    expect(mockMessageSuccess).toHaveBeenCalledWith('pages.review.members.addSuccess');
    expect(screen.queryByText('pages.review.members.email.addHint')).not.toBeInTheDocument();
    expect(screen.queryByText(/contact/i)).not.toBeInTheDocument();
  });

  it('does not add when no registered account matches the email', async () => {
    mockGetUserInfoByEmail.mockResolvedValue({ success: false, user: null });
    render(<AddMemberModal open onCancel={jest.fn()} onSuccess={jest.fn()} />);

    await submitEmail('missing@example.com');

    await waitFor(() => expect(mockGetUserInfoByEmail).toHaveBeenCalled());
    expect(mockAddReviewMemberApi).not.toHaveBeenCalled();
    expect(mockMessageError).toHaveBeenCalledWith('pages.review.members.userNotFound');
  });

  it('reports duplicate and generic reviewer assignment failures', async () => {
    mockGetUserInfoByEmail.mockResolvedValue({ success: true, user: { id: 'reviewer-1' } });
    mockAddReviewMemberApi.mockResolvedValueOnce({
      success: false,
      error: { code: '23505' },
    });
    const first = render(<AddMemberModal open onCancel={jest.fn()} onSuccess={jest.fn()} />);
    await submitEmail();
    await waitFor(() =>
      expect(mockMessageError).toHaveBeenCalledWith('pages.review.members.addError.duplicate'),
    );
    first.unmount();

    mockAddReviewMemberApi.mockResolvedValueOnce(undefined);
    render(<AddMemberModal open onCancel={jest.fn()} onSuccess={jest.fn()} />);
    await submitEmail();
    await waitFor(() =>
      expect(mockMessageError).toHaveBeenCalledWith('pages.review.members.addError'),
    );
  });

  it('handles unexpected lookup errors and resets the form while closed', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGetUserInfoByEmail.mockRejectedValue(new Error('lookup failed'));
    const { rerender } = render(<AddMemberModal open onCancel={jest.fn()} onSuccess={jest.fn()} />);
    await submitEmail();

    await waitFor(() => expect(consoleSpy).toHaveBeenCalledWith(expect.any(Error)));
    expect(mockMessageError).toHaveBeenCalledWith('pages.review.members.addError');

    rerender(<AddMemberModal open={false} onCancel={jest.fn()} onSuccess={jest.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    consoleSpy.mockRestore();
  });
});
