import { test, expect, runFeature } from './fixtures.mjs';

// Tier-4 enhancement UI: plan toolbar (filter / select-all), click-to-focus,
// and the lower-assurance adapter note. Uses the fully-local dupeTabs feature
// so the plan is deterministic (no CLI dependency).
test.describe.configure({ mode: 'serial' });

test('plan toolbar filters + bulk-selects, and click-to-focus jumps to a tab', async ({ context, server, panel }) => {
  const docs = `${server}/react/docs`;
  const hooks = `${server}/react/hooks`;
  await (await context.newPage()).goto(docs);
  await (await context.newPage()).goto(docs);   // duplicate pair 1
  await (await context.newPage()).goto(hooks);
  await (await context.newPage()).goto(hooks);  // duplicate pair 2

  const run = await runFeature(panel, 'dupeTabs');
  expect(run.ok, run.error).toBeTruthy();

  // Reload so the panel UI renders the stored plan.
  await panel.reload({ waitUntil: 'domcontentloaded' });

  await expect(panel.locator('#planTools')).toBeVisible();
  await expect(panel.locator('#plan .item')).toHaveCount(2); // one closeTab per duplicate pair

  // Filter narrows the displayed suggestions.
  await panel.fill('#planFilter', 'docs');
  await expect(panel.locator('#plan .item')).toHaveCount(1);
  await panel.fill('#planFilter', '');
  await expect(panel.locator('#plan .item')).toHaveCount(2);

  // Select all / none drives the checkboxes.
  await panel.click('#selectAll');
  const boxes = panel.locator('#plan .itemCheck');
  for (let i = 0; i < 2; i++) await expect(boxes.nth(i)).toBeChecked();
  await panel.click('#selectNone');
  for (let i = 0; i < 2; i++) await expect(boxes.nth(i)).not.toBeChecked();

  // Click-to-focus activates the target tab.
  const goBtn = panel.locator('#plan .itemFocus').first();
  await expect(goBtn).toBeVisible();
  await goBtn.click();
  await expect.poll(async () => {
    const active = await panel.evaluate(() => new Promise((r) => chrome.tabs.query({ active: true, lastFocusedWindow: true }, (t) => r(t[0]))));
    return !!active && (active.url === docs || active.url === hooks);
  }).toBeTruthy();
});

test('settings shows a lower-assurance note for Copilot only', async ({ panel }) => {
  await panel.click('#settings summary');
  await panel.check('#settingsForm input[name=provider][value=other]'); // reveal the backend dropdown
  await panel.selectOption('#settingsForm [name=adapter]', 'copilot');
  await expect(panel.locator('#adapterNote')).toBeVisible();
  await expect(panel.locator('#adapterNote')).toContainText(/Lower assurance/);
  await panel.selectOption('#settingsForm [name=adapter]', 'claude');
  await expect(panel.locator('#adapterNote')).toBeHidden();
});
