import { validateDatasetRuleVerification } from '@/pages/Utils/review';
import { genContactJsonOrdered } from '@/services/contacts/util';
import { getTeamIdByUserId, normalizeLangPayloadForSave } from '@/services/general/api';
import { supabase } from '@/services/supabase';
import { FunctionRegion } from '@supabase/supabase-js';

export type ReviewerContactStatus = {
  status: 'missing' | 'invalid' | 'ready';
  ready: boolean;
  contact: Record<string, any> | null;
  dataset: {
    id: string;
    version: string;
    state_code: number;
    rule_verification: boolean;
    json_ordered: any;
  } | null;
};

export async function getReviewerContactStatus(): Promise<{
  data: ReviewerContactStatus | null;
  error: any;
}> {
  const result = await supabase.rpc('qry_review_get_my_contact_status');
  if (result.error) return { data: null, error: result.error };
  if (result.data?.ok === false) return { data: null, error: result.data };
  return { data: result.data?.data ?? null, error: null };
}

export async function activateReviewerContact(input: {
  mode: 'create' | 'createVersion';
  id: string;
  sourceVersion?: string;
  formData: any;
  bind: boolean;
  expectedContact: Record<string, any> | null;
}) {
  const rawJsonOrdered = genContactJsonOrdered(input.id, input.formData);
  const normalized = await normalizeLangPayloadForSave(rawJsonOrdered);
  if (normalized.validationError) {
    return {
      data: null,
      error: {
        code: 'LANG_VALIDATION_ERROR',
        message: normalized.validationError,
      },
    };
  }
  const jsonOrdered = normalized.payload ?? rawJsonOrdered;
  const contact = jsonOrdered.contactDataSet;
  const publication = ((contact.administrativeInformation ??= {}).publicationAndOwnership ??= {});
  publication['common:referenceToOwnershipOfDataSet'] = {
    '@refObjectId': input.id,
    '@type': 'contact data set',
    '@uri': `../contacts/${input.id}.xml`,
    '@version': publication['common:dataSetVersion'] ?? input.sourceVersion ?? '01.00.000',
    'common:shortDescription':
      contact.contactInformation?.dataSetInformation?.['common:shortName'] ?? [],
  };
  const teamId = (await getTeamIdByUserId()) ?? '';
  const validation = await validateDatasetRuleVerification('contact data set', jsonOrdered, teamId);
  if (!validation.ruleVerification) {
    return {
      data: null,
      error: {
        code: 'REVIEWER_CONTACT_INVALID',
        message: 'Reviewer profile data validation failed',
        details: validation,
      },
    };
  }

  const session = await supabase.auth.getSession();
  if (!session.data.session) {
    return { data: null, error: { code: 'AUTH_REQUIRED', message: 'No session' } };
  }

  return supabase.functions.invoke('app_review_contact_activate', {
    headers: { Authorization: `Bearer ${session.data.session.access_token}` },
    body: {
      mode: input.mode,
      id: input.id,
      sourceVersion: input.sourceVersion,
      jsonOrdered,
      bind: input.bind,
      expectedContact: input.expectedContact,
      operationId: crypto.randomUUID(),
    },
    region: FunctionRegion.UsEast1,
  });
}
