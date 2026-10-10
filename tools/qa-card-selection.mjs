import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';

const base = process.env.EXAM_SEARCH_URL || 'http://127.0.0.1:8813/';
const evidence = new URL('../_work/card-selection/', import.meta.url);
await mkdir(evidence, { recursive: true });
const observations = [];
const done = page => page.waitForFunction(() =>
  document.querySelector('#result-list')?.getAttribute('aria-busy') === 'false');

for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await type.launch({ headless: true });
  try {
    for (const width of [1440, 375]) {
      const context = await browser.newContext({
        viewport: { width, height: 960 }, hasTouch: width === 375,
      });
      const page = await context.newPage(), errors = [], detailRequests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => {
        if (/google-drive-gateway|pdf\.mjs|editable-editor/.test(request.url())) detailRequests.push(request.url());
      });
      await page.goto(base + '?group=science&subject=p1&year=2025&month=11&pageSize=6');
      await done(page);
      const wrapper = page.locator('.question-item:not([hidden])').first();
      const card = wrapper.locator('.result-card'), checkbox = wrapper.locator('input');
      const id = await card.getAttribute('data-id');
      const initialUrl = page.url(), initialHistory = await page.evaluate(() => history.length);
      const selected = async expected => {
        assert.equal(await checkbox.isChecked(), expected);
        assert.equal(await card.getAttribute('aria-pressed'), String(expected));
      };
      const activate = async (target, options) => {
        if (width === 375) await target.tap(options);
        else await target.click(options);
      };
      await card.locator('img').waitFor({ state: 'visible' });
      await page.waitForFunction(() => document.querySelector('.question-item:not([hidden]) img').naturalWidth > 0);
      for (const selector of ['img', '.result-meta', '.result-tags']) {
        await activate(card.locator(selector), selector === '.result-meta' ? { position: { x: 8, y: 20 } } : undefined);
        await selected(true);
        await activate(card.locator(selector), selector === '.result-meta' ? { position: { x: 8, y: 20 } } : undefined);
        await selected(false);
      }
      // Padding inside the card is selectable, not just its image or text.
      await activate(card, { position: { x: 3, y: 60 } }); await selected(true);
      await activate(card, { position: { x: 3, y: 60 } }); await selected(false);
      // Native checkbox/label events must toggle exactly once.
      await activate(checkbox); await selected(true);
      await activate(wrapper.locator('.card-selection span')); await selected(false);
      // Whole-card selection retains native keyboard operation.
      await card.focus(); await card.press('Space'); await selected(true);
      await card.press('Enter'); await selected(false);
      assert.equal(page.url(), initialUrl);
      assert.equal(await page.evaluate(() => history.length), initialHistory);
      assert(!await page.locator('.app-shell').evaluate(shell => shell.classList.contains('is-detail')));
      assert.deepEqual(detailRequests, [], 'selection must not start PDF/editor work');
      observations.push({ engine, width, scenario: 'whole-card selection', image: true, title: true,
        footer: true, padding: true, checkboxOnce: true, keyboard: true, noNavigation: true, noHeavyRequests: true });

      await activate(card.locator('img')); await selected(true);
      // Selection survives page changes and reloads.
      await page.locator('#load-more').click(); await done(page);
      await page.locator('#previous-page').click(); await done(page); await selected(true);
      await page.reload(); await done(page); await selected(true);
      assert.equal(await page.locator('#selection-count').textContent(), '선택 1개');
      await page.screenshot({ path: new URL(engine + '-' + width + '-selected.png', evidence).pathname });
      observations.push({ engine, width, scenario: 'selection retention', id, pagination: true, reload: true });

      // An explicit preview remains independently usable, with selection synchronized.
      await activate(wrapper.locator('.card-preview'));
      await page.waitForFunction(() => document.querySelector('.app-shell').classList.contains('is-detail'));
      await page.waitForFunction(() => document.querySelector('#detail-heading').textContent === '물리학Ⅰ 1번');
      assert.equal(await page.locator('#detail-selection').isChecked(), true);
      assert.equal(await page.locator('#selection-count').textContent(), '선택 1개');
      await page.locator('#detail-selection').uncheck(); await selected(false);
      await page.locator('#mobile-back').click(); await done(page);
      assert(!await page.locator('.app-shell').evaluate(shell => shell.classList.contains('is-detail')));
      assert.equal(await page.evaluate(() => document.activeElement.dataset.id), id);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const overlap = await wrapper.evaluate(e => {
        const meta = e.querySelector('.result-meta');
        const actions = e.querySelector('.card-actions').getBoundingClientRect();
        const text = document.createRange(); text.selectNodeContents(meta);
        return [...text.getClientRects()].some(r =>
          r.left < actions.right && r.right > actions.left && r.top < actions.bottom && r.bottom > actions.top);
      });
      assert(!overlap, 'card title must not overlap preview/checkbox actions');
      const sourceWarnings = errors.filter(error => /google-drive-gateway.*due to access control checks/u.test(error));
      assert.deepEqual(errors.filter(error => !sourceWarnings.includes(error)), []);
      observations.push({ engine, width, scenario: 'independent preview', detailSync: true, backFocus: true,
        noTitleOverlap: true, noOverflow: true, sourceWarnings: sourceWarnings.length });
      await context.close();
    }
  } finally { await browser.close(); }
}
await writeFile(new URL('results.json', evidence), JSON.stringify({ passed: true, observations }, null, 2));
console.log(JSON.stringify({ passed: true, observations }, null, 2));
