import { expect, test } from '@playwright/test';
import { installDatasetListFixture } from '../dataset-lists/fixture';

// Synthetic browser proof: all backend requests remain intercepted.
const app = process.env.RESULT_PREVIEW_BASE_URL ?? 'http://127.0.0.1:8012';
const backend = 'https://semantic-harness.invalid';
const userId = '11111111-1111-4111-8111-111111111111';

test('published process results retain frozen revisions and units', async ({
  page,
  context,
}, testInfo) => {
  const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const user = {
    id: userId,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'preview@example.test',
    app_metadata: {},
    user_metadata: {},
  };
  const token = `${encoded({ alg: 'HS256', typ: 'JWT' })}.${encoded({ sub: userId, aud: 'authenticated', role: 'authenticated', exp: 2_000_000_000 })}.fixture`;
  await context.addInitScript(
    ({ key, session }) => {
      localStorage.setItem(key, JSON.stringify(session));
      localStorage.setItem('umi_locale', 'en-US');
    },
    {
      key: `sb-${new URL(backend).hostname.split('.')[0]}-auth-token`,
      session: {
        access_token: token,
        refresh_token: 'fixture',
        token_type: 'bearer',
        expires_at: 2_000_000_000,
        expires_in: 3600,
        user,
      },
    },
  );

  await installDatasetListFixture(page);
  await page.route('**/auth/v1/user', (route) => route.fulfill({ json: user }));
  await page.route('**/functions/v1/data_product_results**', (route) =>
    route.fulfill({
      json: {
        ok: true,
        data: {
          rowCount: 2,
          values: [
            {
              impact_id: '6209b35f-9447-40b5-b68c-a1099e3674a0',
              impact_version: '00.00.001',
              impact_index: 0,
              impact_name: 'Frozen climate category',
              unit: 'frozen kg',
              value: 17.5,
            },
            {
              impact_id: '6209b35f-9447-40b5-b68c-a1099e3674a0',
              impact_index: 1,
              impact_name: 'Historical category without revision',
              unit: 'legacy kg',
              value: -2,
            },
          ],
        },
      },
    }),
  );
  await page.goto(`${app}/#/tgdata/processes`);
  await page.getByRole('button', { name: 'profile', exact: true }).first().click();
  const drawer = page.locator('.ant-drawer:visible').last();
  await expect(drawer).toBeVisible();
  await drawer.getByRole('tab', { name: /LCIA/ }).click();
  const frozen = drawer.locator(
    'tr[data-row-key="6209b35f-9447-40b5-b68c-a1099e3674a0@00.00.001"]',
  );
  await expect(frozen).toContainText('00.00.001');
  await expect(frozen).toContainText('frozen kg');
  await expect(frozen).toContainText('17.5');
  const legacy = drawer.locator('tr[data-row-key="6209b35f-9447-40b5-b68c-a1099e3674a0@"]');
  await expect(legacy).toContainText('legacy kg');
  await expect(legacy).toContainText('-2');
  await expect(legacy).not.toContainText('01.00.000');
  await page.screenshot({
    path: testInfo.outputPath('frozen-method-metadata.png'),
    fullPage: true,
  });
});
