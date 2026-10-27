import { test, expect, type Locator, type Page, type TestInfo } from '../i18n/fixtures';
import { signInViaUi } from '../i18n/auth';
import { selectAppLocaleThroughUi } from '../i18n/contracts';
import {
  installManagementFixture,
  ROOT_REVIEW_ID,
  REVIEWER_ID,
  TEAM_IDS,
  type ManagementQuery,
} from './management-fixture';

test.skip(
  process.env.E2E_QUALIFICATION !== 'true',
  'Management layout fixtures require the closed qualification backend.',
);

const sizes = [
  { width: 1440, height: 1000 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
];

async function loginInChinese(page: Page) {
  await signInViaUi(page);
  await expect(page.locator('.ant-message-notice')).toHaveCount(0);
  await selectAppLocaleThroughUi(page, 'zh-CN');
}

const reviewTable = (page: Page) => page.locator('.review-table-with-expand-icon:visible').first();
const latest = (queries: ManagementQuery[], rpc: string) =>
  queries.filter((query) => query.rpc === rpc).slice(-1)[0]?.body;

async function assertListLayout(page: Page, root: Locator, width: number) {
  await expect(root).toBeVisible();
  await expect(root.locator('.ant-spin-spinning')).toHaveCount(0);
  await expect(root.locator('.ant-input-search')).toHaveCount(1);
  await expect(root.locator('.ant-pro-table-list-toolbar-title')).toHaveCount(0);
  await expect
    .poll(() =>
      root
        .locator('.ant-input-search input')
        .evaluate((input) => input.getBoundingClientRect().width),
    )
    .toBeGreaterThanOrEqual(120);
  await expect
    .poll(() =>
      root.locator('.responsive-data-list-toolbar').evaluate((toolbar) => {
        const bounds = toolbar.getBoundingClientRect();
        return [
          ...toolbar.querySelectorAll<HTMLElement>(
            '.ant-input-search, .ant-select, button, .ant-pro-table-list-toolbar-setting-item',
          ),
        ]
          .filter((element) => element.getBoundingClientRect().width > 0)
          .every((element) => {
            const control = element.getBoundingClientRect();
            return control.left >= bounds.left - 1 && control.right <= bounds.right + 1;
          });
      }),
    )
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    .toBe(true);
  const body = root.locator('.ant-table-body').first();
  await expect(body).toBeVisible();
  if (width === 390) {
    await expect
      .poll(() => body.evaluate((element) => element.scrollWidth > element.clientWidth + 1))
      .toBe(true);
  }
}

async function captureLayout(
  page: Page,
  root: Locator,
  testInfo: TestInfo,
  name: string,
  width: number,
) {
  await assertListLayout(page, root, width);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: testInfo.outputPath(`${name}-${width}.png`) });
  await assertListLayout(page, root, width);
}

test('admin queues retain submitted search, filters, expansion and selected actions in responsive toolbars', async ({
  page,
}, testInfo) => {
  const queries = await installManagementFixture(page, 'review-admin');
  await loginInChinese(page);
  await page.goto('/#/review');
  let root = reviewTable(page);
  await expect(root.getByText('合成审核任务 001', { exact: true })).toBeVisible();

  for (const size of sizes) {
    await page.setViewportSize(size);
    root = reviewTable(page);
    await captureLayout(page, root, testInfo, 'review-admin', size.width);
    const firstRow = root.locator(`.ant-table-tbody > tr[data-row-key="${ROOT_REVIEW_ID}"]`);
    await firstRow.locator('.ant-table-row-expand-icon').click();
    await expect(root.locator('.ant-table-expanded-row:visible')).toContainText('合成引用联系机构');
    await firstRow.getByRole('checkbox').check();
    await expect(root.getByRole('button', { name: '批量驳回', exact: true })).toBeVisible();
    await assertListLayout(page, root, size.width);

    const search = root.locator('.ant-input-search input');
    const beforeDraft = queries.length;
    await search.fill('工具栏检索');
    expect(queries).toHaveLength(beforeDraft);
    await search.press('Enter');
    await expect
      .poll(() => latest(queries, 'qry_review_get_admin_queue_items_v6'))
      .toMatchObject({
        p_status: 'unassigned',
        p_query: '工具栏检索',
        p_page: 1,
      });
    await expect(root.getByText('工具栏检索：合成审核任务 001', { exact: true })).toBeVisible();
    await expect(root.locator('.ant-table-expanded-row:visible')).toHaveCount(0);
    await expect(firstRow.locator('.ant-table-row-expand-icon')).toHaveClass(
      /ant-table-row-expand-icon-collapsed/,
    );
    await expect(firstRow.getByRole('checkbox')).not.toBeChecked();
    await root.locator('.ant-input-clear-icon').click();
    await expect
      .poll(() => latest(queries, 'qry_review_get_admin_queue_items_v6')?.p_query)
      .toBeNull();
    await expect(root.getByText('合成审核任务 001', { exact: true })).toBeVisible();
  }

  await page.setViewportSize(sizes[0]);
  await root.getByRole('combobox', { name: '展示模式', exact: true }).click();
  await page
    .locator('.ant-select-dropdown:visible')
    .getByText('其他类型审核', { exact: true })
    .click();
  await expect
    .poll(() => latest(queries, 'qry_review_get_admin_queue_items_v6'))
    .toMatchObject({
      p_display_mode: 'other',
      p_page: 1,
    });
  await root.getByRole('combobox', { name: '数据类型', exact: true }).click();
  await page.locator('.ant-select-dropdown:visible').getByText('联系人', { exact: true }).click();
  await expect
    .poll(() => latest(queries, 'qry_review_get_admin_queue_items_v6'))
    .toMatchObject({
      p_display_mode: 'other',
      p_target_table: 'contacts',
      p_page: 1,
    });
  for (const [name, status] of [
    ['审核中任务', 'in-progress'],
    ['已完成任务', 'completed'],
  ] as const) {
    await page.getByRole('tab', { name, exact: true }).click();
    root = reviewTable(page);
    await expect
      .poll(() => latest(queries, 'qry_review_get_admin_queue_items_v6')?.p_status)
      .toBe(status);
    await assertListLayout(page, root, 1440);
  }

  await page.getByRole('tab', { name: '成员管理', exact: true }).click();
  const member = page
    .locator('.ant-table-tbody > tr')
    .filter({ hasText: 'synthetic-reviewer@example.invalid' });
  await member.getByRole('button', { name: '2', exact: true }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.locator('.review-table-with-expand-icon')).toBeVisible();
  await expect(drawer.locator('.ant-input-search')).toHaveCount(0);
  await expect(drawer.locator('.ant-pro-table-list-toolbar-title')).toHaveCount(0);
  await expect
    .poll(() => latest(queries, 'qry_review_get_member_workload_items_v1'))
    .toMatchObject({
      p_status: 'pending',
      p_reviewer_id: REVIEWER_ID,
      p_query: null,
    });
});

test('reviewer pending, submitted and completed queues use the same contained list layout', async ({
  page,
}, testInfo) => {
  const queries = await installManagementFixture(page, 'review-member');
  await loginInChinese(page);
  await page.goto('/#/review');
  for (const [name, status] of [
    ['待审核任务', 'pending'],
    ['已提交意见', 'submitted'],
    ['已完成任务', 'completed'],
  ] as const) {
    await page.setViewportSize(sizes[0]);
    await page.getByRole('tab', { name, exact: true }).click();
    const root = reviewTable(page);
    await expect(root.getByText('合成审核任务 001', { exact: true })).toBeVisible();
    await expect
      .poll(() => latest(queries, 'qry_review_get_member_queue_items_v6')?.p_status)
      .toBe(status);
    await expect(page.getByRole('tab', { name: '成员管理', exact: true })).toHaveCount(0);
    for (const size of sizes) {
      await page.setViewportSize(size);
      await captureLayout(page, root, testInfo, `review-member-${status}`, size.width);
    }
  }
});

test('system All Teams retains ranked search and saves the actual dragged row order', async ({
  page,
}, testInfo) => {
  const queries = await installManagementFixture(page, 'system-admin');
  await loginInChinese(page);
  await page.goto('/#/manageSystem');
  const root = page.locator('.responsive-data-list-table:visible').first();
  await expect(root.getByText('合成团队 1', { exact: true })).toBeVisible();
  await expect(root.locator('.ant-pro-table-drag-icon').first()).toBeVisible();
  for (const size of sizes) {
    await page.setViewportSize(size);
    await captureLayout(page, root, testInfo, 'all-teams-system', size.width);
  }
  const search = root.locator('.ant-input-search input');
  await search.fill('团队检索');
  await search.press('Enter');
  await expect
    .poll(() => latest(queries, 'qry_team_list'))
    .toMatchObject({
      p_mode: 'ranked',
      p_keyword: '团队检索',
      p_page: 1,
    });
  await expect(root.getByText('团队检索：合成团队 1', { exact: true })).toBeVisible();
  await search.fill('');
  await search.press('Enter');
  await expect
    .poll(() => latest(queries, 'qry_team_list'))
    .toMatchObject({
      p_mode: 'ranked',
      p_keyword: null,
      p_page: 1,
    });
  await expect(root.getByText('合成团队 1', { exact: true })).toBeVisible();

  await page.setViewportSize(sizes[0]);
  await assertListLayout(page, root, 1440);
  const rows = root.locator('.ant-table-tbody > tr[data-row-key^="13550000-0000-4000-8100-"]');
  const firstRow = root.locator(`.ant-table-tbody > tr[data-row-key="${TEAM_IDS[0]}"]`);
  const secondRow = root.locator(`.ant-table-tbody > tr[data-row-key="${TEAM_IDS[1]}"]`);
  const firstHandle = firstRow.locator('.ant-pro-table-drag-icon');
  const secondHandle = secondRow.locator('.ant-pro-table-drag-icon');
  await expect(firstHandle).toBeVisible();
  await expect(secondHandle).toBeVisible();
  await expect(rows).toHaveCount(10);
  const before = await rows.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-row-key')),
  );
  const source = await firstHandle.boundingBox();
  const target = await secondHandle.boundingBox();
  expect(source).not.toBeNull();
  expect(target).not.toBeNull();
  const x = source!.x + source!.width / 2;
  await page.mouse.move(x, source!.y + source!.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, source!.y + source!.height / 2 + 6, { steps: 3 });
  await page.mouse.move(x, target!.y + target!.height / 2, { steps: 12 });
  await expect
    .poll(() => firstRow.evaluate((element) => getComputedStyle(element).transform))
    .not.toBe('none');
  await page.mouse.up();
  const reordered = [before[1], before[0], ...before.slice(2)];
  await expect
    .poll(() =>
      rows.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('data-row-key')),
      ),
    )
    .toEqual(reordered);
  const save = root.getByRole('button', { name: '保存排序', exact: true });
  await expect(save).toBeVisible();
  await assertListLayout(page, root, 1440);
  await save.click();
  await expect
    .poll(() =>
      queries.filter((query) => query.rpc === 'admin_team_set_rank').map((query) => query.body),
    )
    .toEqual(reordered.map((teamId, index) => ({ teamId, rank: index + 1 })));
  await expect(save).toHaveCount(0);
  await expect
    .poll(() =>
      rows.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('data-row-key')),
      ),
    )
    .toEqual(reordered);
});

test('join-team modal preserves its public search scope and a single title at every width', async ({
  page,
}, testInfo) => {
  const queries = await installManagementFixture(page, 'standard-user');
  await loginInChinese(page);
  // ProLayout remounts the avatar when switching desktop/mobile navigation.
  // Open the actual entry point at each viewport instead of assuming a popup survives that switch.
  for (const size of [...sizes, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    await page.locator('.tg-global-header-avatar-trigger').click();
    await page.getByRole('menuitem', { name: '我的团队' }).click();
    await page.getByRole('button', { name: '加入团队', exact: true }).click();
    const modal = page.getByRole('dialog');
    const root = modal.locator('.responsive-data-list-table');
    await expect(root.getByText('合成团队 1', { exact: true })).toBeVisible();
    await expect(modal.getByText('全部团队', { exact: true })).toHaveCount(1);
    await expect(root.locator('.ant-pro-table-drag-icon')).toHaveCount(0);
    await captureLayout(page, root, testInfo, 'all-teams-join', size.width);
    await expect
      .poll(() => root.locator('.ant-table-body').evaluate((body) => body.clientHeight))
      .toBeGreaterThanOrEqual(72);
    const pagination = await root.locator('.ant-pagination').boundingBox();
    expect(pagination!.y + pagination!.height).toBeLessThanOrEqual(size.height + 1);
    const search = root.locator('.ant-input-search input');
    await search.fill('公开团队');
    await search.press('Enter');
    await expect
      .poll(() => latest(queries, 'qry_team_list'))
      .toMatchObject({
        p_mode: 'public',
        p_keyword: '公开团队',
        p_page: 1,
      });
    await expect(root.getByText('公开团队：合成团队 1', { exact: true })).toBeVisible();
    await search.fill('');
    await search.press('Enter');
    await expect(root.getByText('合成团队 1', { exact: true })).toBeVisible();
    await modal.locator('.ant-modal-close').click();
    await expect(modal).toHaveCount(0);
  }
});
