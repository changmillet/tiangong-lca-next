import { expect, type Page } from '@playwright/test';
import { datasetRow, installDatasetListFixture, USER_ID } from './fixture';

const SYSTEM_TEAM_ID = '00000000-0000-0000-0000-000000000000';
export const REVIEWER_ID = '70400000-0000-4000-8000-000000000706';
export const ROOT_REVIEW_ID = '13550000-0000-4000-8000-000000000001';
const REFERENCE_REVIEW_ID = '13550000-0000-4000-8000-000000000101';
const VERSION = '01.00.000';
const TOTAL_REVIEWS = 62;
export const TEAM_IDS = Array.from(
  { length: 16 },
  (_, index) => `13550000-0000-4000-8100-${String(index + 1).padStart(12, '0')}`,
);
const langText = (text: string) =>
  ['zh', 'en', 'de', 'fr'].map((lang) => ({ '@xml:lang': lang, '#text': text }));

type ManagementRole = 'review-admin' | 'review-member' | 'system-admin' | 'standard-user';
export type ManagementQuery = { rpc: string; body: Record<string, any> };

/** Role/queue fixtures and one bounded synthetic rank command above the closed backend. */
export async function installManagementFixture(page: Page, role: ManagementRole) {
  expect(process.env.E2E_QUALIFICATION).toBe('true');
  await installDatasetListFixture(page);
  const queries: ManagementQuery[] = [];
  const teamRanks = new Map(TEAM_IDS.map((id, index) => [id, index + 1]));
  let activeStatus = 'unassigned';
  const queueRpcs = new Set([
    'qry_review_get_admin_queue_items_v6',
    'qry_review_get_member_queue_items_v6',
    'qry_review_get_member_workload_items_v1',
  ]);

  await page.route('**/rest/v1/rpc/*', async (route) => {
    const request = route.request();
    const target = new URL(request.url());
    expect(target.origin).toBe('https://semantic-harness.invalid');
    if (request.method() === 'OPTIONS') return route.fallback();
    const rpc = target.pathname.split('/').pop()!;
    const body = JSON.parse(request.postData() ?? '{}');
    if (rpc === 'qry_membership_get_mine') {
      const roles = role === 'system-admin' ? ['admin'] : role === 'standard-user' ? [] : [role];
      return route.fulfill({
        json: roles.map((memberRole) => ({
          role: memberRole,
          team_id: SYSTEM_TEAM_ID,
          user_id: USER_ID,
        })),
      });
    }
    if (rpc === 'qry_review_get_my_contact_status') {
      const contact = datasetRow('contact', 0);
      return route.fulfill({
        json: {
          ok: true,
          data: {
            status: 'ready',
            ready: true,
            contact: { id: contact.id, version: VERSION },
            dataset: { ...contact, rule_verification: true, state_code: 100 },
          },
        },
      });
    }
    if (rpc === 'qry_identity_get_visible_users') {
      return route.fulfill({
        json: (body.p_user_ids ?? []).map((id: string) => ({
          id,
          email: 'synthetic-owner@example.invalid',
          display_name: '合成数据编制人',
        })),
      });
    }
    if (queueRpcs.has(rpc)) {
      queries.push({ rpc, body });
      activeStatus = body.p_status;
      const stateCode = activeStatus === 'unassigned' ? 0 : activeStatus === 'completed' ? 2 : 1;
      const start = ((body.p_page ?? 1) - 1) * (body.p_page_size ?? 50);
      const count = Math.max(0, Math.min(body.p_page_size ?? 50, TOTAL_REVIEWS - start));
      const targetTable =
        body.p_target_table ?? (body.p_display_mode === 'other' ? 'contacts' : 'processes');
      return route.fulfill({
        json: Array.from({ length: count }, (_, index) => {
          const ordinal = start + index;
          const id = `13550000-0000-4000-8000-${String(ordinal + 1).padStart(12, '0')}`;
          const name = `${body.p_query ? `${body.p_query}：` : ''}合成审核任务 ${String(ordinal + 1).padStart(3, '0')}`;
          return {
            id,
            review_kind: 'root',
            target_table: targetTable,
            data_id: datasetRow('process', ordinal).id,
            data_version: VERSION,
            state_code: stateCode,
            review_state_code: stateCode,
            root_can_read: true,
            root_matches_status: true,
            reviewer_count: stateCode ? 2 : 0,
            completed_reviewer_count: stateCode ? 1 : 0,
            approve_opinion_count: stateCode ? 1 : 0,
            reject_opinion_count: 0,
            comment_state_code: activeStatus === 'pending' ? 0 : 1,
            comment_state_codes: stateCode ? [0, 1] : [],
            json: {
              data: {
                id: datasetRow('process', ordinal).id,
                version: VERSION,
                table: targetTable,
                name: { baseName: langText(name) },
              },
              user: { id: USER_ID, name: '合成数据编制人' },
            },
            created_at: '2026-10-20T00:00:00Z',
            modified_at: '2026-10-21T00:00:00Z',
            deadline: '2026-11-30T00:00:00Z',
            total_count: TOTAL_REVIEWS,
          };
        }),
      });
    }
    if (rpc === 'qry_root_review_reference_progress_v2') {
      queries.push({ rpc, body });
      return route.fulfill({
        json: [
          {
            reference_review_id: REFERENCE_REVIEW_ID,
            target_table: 'contacts',
            data_id: datasetRow('contact', 0).id,
            data_version: VERSION,
            data_name: { baseName: langText('合成引用联系机构') },
            submitted_revision_checksum: 'synthetic-review-reference-checksum',
            state_code: activeStatus === 'unassigned' ? 0 : 1,
            reviewer_count: 2,
            completed_reviewer_count: 1,
            approve_opinion_count: 1,
            reject_opinion_count: 0,
            actor_comment_state_code: 0,
          },
        ],
      });
    }
    if (rpc === 'qry_review_get_member_workload') {
      return route.fulfill({
        json: [
          {
            user_id: REVIEWER_ID,
            team_id: SYSTEM_TEAM_ID,
            email: 'synthetic-reviewer@example.invalid',
            display_name: '合成审核员',
            role: 'review-member',
            pending_count: 2,
            reviewed_count: 3,
            total_count: 1,
          },
        ],
      });
    }
    if (rpc === 'qry_team_list') {
      queries.push({ rpc, body });
      const start = ((body.p_page ?? 1) - 1) * (body.p_page_size ?? 10);
      const count = Math.max(0, Math.min(body.p_page_size ?? 10, 16 - start));
      return route.fulfill({
        json: [...TEAM_IDS]
          .sort((left, right) => teamRanks.get(left)! - teamRanks.get(right)!)
          .slice(start, start + count)
          .map((id) => ({
            id,
            json: {
              title: langText(
                `${body.p_keyword ? `${body.p_keyword}：` : ''}合成团队 ${TEAM_IDS.indexOf(id) + 1}`,
              ),
              description: langText('用于列表响应式验收的合成团队，涵盖较长介绍文本。'),
            },
            rank: teamRanks.get(id),
            is_public: true,
            owner_user_id: USER_ID,
            owner_email: 'synthetic-owner@example.invalid',
            created_at: '2026-10-20T00:00:00Z',
            modified_at: '2026-10-21T00:00:00Z',
            total_count: 16,
          })),
      });
    }
    return route.fallback();
  });
  await page.route(/\/functions\/v1\/admin_team_set_rank(?:\?.*)?$/u, async (route) => {
    const request = route.request();
    expect(new URL(request.url()).origin).toBe('https://semantic-harness.invalid');
    if (request.method() === 'OPTIONS') return route.fallback();
    expect(request.method()).toBe('POST');
    expect(role).toBe('system-admin');
    const body = JSON.parse(request.postData() ?? '{}');
    expect(Object.keys(body).sort()).toEqual(['rank', 'teamId']);
    expect(TEAM_IDS).toContain(body.teamId);
    expect(Number.isInteger(body.rank) && body.rank >= 1 && body.rank <= TEAM_IDS.length).toBe(
      true,
    );
    queries.push({ rpc: 'admin_team_set_rank', body });
    teamRanks.set(body.teamId, body.rank);
    return route.fulfill({ json: { ok: true, data: { teamId: body.teamId, rank: body.rank } } });
  });
  await page.route(/\/functions\/v1\/admin_review_quality_diagnostic(?:\?.*)?$/u, async (route) => {
    const request = route.request();
    expect(new URL(request.url()).origin).toBe('https://semantic-harness.invalid');
    if (request.method() === 'OPTIONS') return route.fallback();
    expect(request.method()).toBe('POST');
    expect(role).toBe('review-admin');
    const body = JSON.parse(request.postData() ?? '{}');
    expect(body).toEqual({ action: 'read' });
    queries.push({ rpc: 'admin_review_quality_diagnostic', body });
    return route.fulfill({
      json: { command: 'review_quality_diagnostic', action: 'read', data: null },
    });
  });
  return queries;
}
