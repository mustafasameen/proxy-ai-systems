// Headless browser pass through one Places decision. Usage: node browser_flow.js <app_url> <out.png> [answer]
// Prints one JSON object: the /api/pick responses the page received, and the visible text after the click.
const path = require('path');
const pw = process.env.PLAYWRIGHT_MODULE || path.join(process.env.HOME, '.claude/skills/playwright-skill/node_modules/playwright');
const { chromium } = require(pw);
(async () => {
  const [appUrl, outPng, answer] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
  const picks = [];
  page.on('response', async (r) => {
    if (r.url().includes('/api/pick')) {
      let body = null;
      try { body = await r.json(); } catch (e) {}
      const h = r.headers();
      picks.push({ status: r.status(), request_id_header: h['x-request-id'] || null,
        body_keys: body ? Object.keys(body).slice(0, 12) : null,
        stage: body && body.stage, cached: body && body.cached, model_latency_s: body && body.model_latency_s,
        error: body && body.detail ? body.detail : (body && body.error ? body : undefined) });
    }
  });
  await page.goto(appUrl);
  await page.getByRole('button', { name: /Let PROXY choose/ }).waitFor({ timeout: 15000 });
  const t0 = Date.now();
  await page.getByRole('button', { name: /Let PROXY choose/ }).click();
  await page.waitForResponse((r) => r.url().includes('/api/pick'), { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(2000);
  if (answer) {
    const b = page.getByRole('button', { name: new RegExp('^' + answer, 'i') }).first();
    if (await b.count()) {
      await b.click();
      await page.waitForResponse((r) => r.url().includes('/api/pick'), { timeout: 40000 }).catch(() => {});
      await page.waitForTimeout(1500);
    }
  }
  const click_to_settled_s = (Date.now() - t0) / 1000;
  await page.screenshot({ path: outPng, fullPage: true });
  const text = await page.locator('body').innerText();
  const alerts = await page.locator('[role=alert],[role=status]').allInnerTexts();
  const i = text.indexOf('Let PROXY choose');
  console.log(JSON.stringify({ picks, click_to_settled_s, alerts, visible_text: text.slice(Math.max(0, i - 200), i + 900) }));
  await browser.close();
})();
