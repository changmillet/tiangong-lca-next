// @ts-nocheck
import { activateReviewerContact, getReviewerContactStatus } from '@/services/reviewerContacts/api';
import { FunctionRegion } from '@supabase/supabase-js';

const mockRpc = jest.fn();
const mockGetSession = jest.fn();
const mockInvoke = jest.fn();
const mockGenContactJsonOrdered = jest.fn();
const mockNormalizeLangPayloadForSave = jest.fn();
const mockGetTeamIdByUserId = jest.fn();
const mockValidateDatasetRuleVerification = jest.fn();

jest.mock('@/services/supabase', () => ({
  supabase: {
    rpc: (...args: any[]) => mockRpc(...args),
    auth: { getSession: (...args: any[]) => mockGetSession(...args) },
    functions: { invoke: (...args: any[]) => mockInvoke(...args) },
  },
}));

jest.mock('@/services/contacts/util', () => ({
  genContactJsonOrdered: (...args: any[]) => mockGenContactJsonOrdered(...args),
}));

jest.mock('@/services/general/api', () => ({
  getTeamIdByUserId: (...args: any[]) => mockGetTeamIdByUserId(...args),
  normalizeLangPayloadForSave: (...args: any[]) => mockNormalizeLangPayloadForSave(...args),
}));

jest.mock('@/pages/Utils/review', () => ({
  validateDatasetRuleVerification: (...args: any[]) => mockValidateDatasetRuleVerification(...args),
}));

const input = {
  mode: 'create' as const,
  id: 'contact-1',
  formData: { name: 'Reviewer' },
  bind: true,
  expectedContact: null,
};

const contactPayload = (overrides: any = {}) => ({
  contactDataSet: {
    contactInformation: {
      dataSetInformation: { 'common:shortName': [{ '@xml:lang': 'en', '#text': 'Reviewer' }] },
    },
    administrativeInformation: {
      publicationAndOwnership: { 'common:dataSetVersion': '02.00.000' },
    },
    ...overrides,
  },
});

describe('reviewerContacts api', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTeamIdByUserId.mockResolvedValue('team-1');
    mockValidateDatasetRuleVerification.mockResolvedValue({ ruleVerification: true });
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'access-token' } },
    });
    mockInvoke.mockResolvedValue({ data: { ok: true }, error: null });
  });

  it('returns reviewer contact status data and normalizes empty data', async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: true, data: { status: 'ready' } }, error: null });
    await expect(getReviewerContactStatus()).resolves.toEqual({
      data: { status: 'ready' },
      error: null,
    });

    mockRpc.mockResolvedValueOnce({ data: undefined, error: null });
    await expect(getReviewerContactStatus()).resolves.toEqual({ data: null, error: null });
    expect(mockRpc).toHaveBeenCalledWith('qry_review_get_my_contact_status');
  });

  it('returns transport and command errors from reviewer contact status', async () => {
    const transportError = { message: 'offline' };
    mockRpc.mockResolvedValueOnce({ data: null, error: transportError });
    await expect(getReviewerContactStatus()).resolves.toEqual({
      data: null,
      error: transportError,
    });

    const commandError = { ok: false, code: 'FORBIDDEN' };
    mockRpc.mockResolvedValueOnce({ data: commandError, error: null });
    await expect(getReviewerContactStatus()).resolves.toEqual({
      data: null,
      error: commandError,
    });
  });

  it('stops activation when language or dataset validation fails', async () => {
    const raw = contactPayload();
    mockGenContactJsonOrdered.mockReturnValue(raw);
    mockNormalizeLangPayloadForSave.mockResolvedValueOnce({
      payload: null,
      validationError: 'invalid language',
    });

    await expect(activateReviewerContact(input)).resolves.toEqual({
      data: null,
      error: { code: 'LANG_VALIDATION_ERROR', message: 'invalid language' },
    });

    mockNormalizeLangPayloadForSave.mockResolvedValueOnce({ payload: null, validationError: null });
    mockGetTeamIdByUserId.mockResolvedValueOnce(null);
    const validation = { ruleVerification: false, issues: ['missing name'] };
    mockValidateDatasetRuleVerification.mockResolvedValueOnce(validation);

    await expect(activateReviewerContact(input)).resolves.toEqual({
      data: null,
      error: {
        code: 'REVIEWER_CONTACT_INVALID',
        message: 'Reviewer profile data validation failed',
        details: validation,
      },
    });
    expect(mockValidateDatasetRuleVerification).toHaveBeenCalledWith('contact data set', raw, '');
  });

  it('requires a session after forcing self ownership', async () => {
    const raw = contactPayload({
      contactInformation: { dataSetInformation: {} },
      administrativeInformation: undefined,
    });
    mockGenContactJsonOrdered.mockReturnValue(raw);
    mockNormalizeLangPayloadForSave.mockResolvedValue({ payload: raw, validationError: null });
    mockGetSession.mockResolvedValueOnce({ data: { session: null } });

    await expect(
      activateReviewerContact({ ...input, sourceVersion: '03.00.000' }),
    ).resolves.toEqual({
      data: null,
      error: { code: 'AUTH_REQUIRED', message: 'No session' },
    });
    expect(
      raw.contactDataSet.administrativeInformation.publicationAndOwnership[
        'common:referenceToOwnershipOfDataSet'
      ],
    ).toEqual({
      '@refObjectId': 'contact-1',
      '@type': 'contact data set',
      '@uri': '../contacts/contact-1.xml',
      '@version': '03.00.000',
      'common:shortDescription': [],
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('invokes activation with normalized data, publication version, and fencing inputs', async () => {
    const raw = contactPayload();
    const normalized = contactPayload();
    mockGenContactJsonOrdered.mockReturnValue(raw);
    mockNormalizeLangPayloadForSave.mockResolvedValue({
      payload: normalized,
      validationError: null,
    });

    const result = await activateReviewerContact({
      ...input,
      mode: 'createVersion',
      sourceVersion: '01.00.000',
      expectedContact: { '@refObjectId': 'contact-1', '@version': '01.00.000' },
    });

    expect(result).toEqual({ data: { ok: true }, error: null });
    expect(mockInvoke).toHaveBeenCalledWith('app_review_contact_activate', {
      headers: { Authorization: 'Bearer access-token' },
      body: expect.objectContaining({
        mode: 'createVersion',
        id: 'contact-1',
        sourceVersion: '01.00.000',
        jsonOrdered: normalized,
        bind: true,
        expectedContact: { '@refObjectId': 'contact-1', '@version': '01.00.000' },
        operationId: expect.any(String),
      }),
      region: FunctionRegion.UsEast1,
    });
    expect(
      normalized.contactDataSet.administrativeInformation.publicationAndOwnership[
        'common:referenceToOwnershipOfDataSet'
      ],
    ).toEqual(
      expect.objectContaining({
        '@refObjectId': 'contact-1',
        '@version': '02.00.000',
        'common:shortDescription': [{ '@xml:lang': 'en', '#text': 'Reviewer' }],
      }),
    );
  });

  it('falls back to the initial version when neither publication nor source has a version', async () => {
    const raw = contactPayload({
      contactInformation: undefined,
      administrativeInformation: { publicationAndOwnership: {} },
    });
    mockGenContactJsonOrdered.mockReturnValue(raw);
    mockNormalizeLangPayloadForSave.mockResolvedValue({
      payload: undefined,
      validationError: null,
    });

    await activateReviewerContact(input);

    expect(
      raw.contactDataSet.administrativeInformation.publicationAndOwnership[
        'common:referenceToOwnershipOfDataSet'
      ],
    ).toEqual(expect.objectContaining({ '@version': '01.00.000' }));
  });
});
