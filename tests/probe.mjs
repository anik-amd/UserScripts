// Throwaway probe: inspects chat.qwen.ai composer DOM and Enter behaviour.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const OUT = 'probe-out';
await fs.mkdir(OUT, { recursive: true });
const report = [];
const say = (key, value) => report.push(`## ${key}\n${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`);

const US = await fs.readFile('scripts/qwen-enter-to-send.user.js', 'utf8');

function collect(page) {
  return page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const editors = [...document.querySelectorAll('textarea, [contenteditable="true"], [contenteditable=""]')].map((el) => ({
      tag: el.tagName,
      cls: el.className,
      placeholder: el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '',
      html: el.outerHTML.slice(0, 1500)
    }));
    const buttons = [...document.querySelectorAll('button, [role="button"]')]
      .filter(vis)
      .slice(0, 60)
      .map((el) => ({
        label: el.getAttribute('aria-label'),
        title: el.getAttribute('title'),
        testid: el.getAttribute('data-testid'),
        cls: typeof el.className === 'string' ? el.className : '',
        disabled: el.disabled,
        html: el.outerHTML.slice(0, 500)
      }));
    const bodyText = (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 1500);
    return { editors, buttons, bodyText };
  });
}

async function run(label, inject) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));

  if (inject) await page.addInitScript(US);

  await page.goto('https://chat.qwen.ai', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => say(`${label}: goto error`, e.message));
  await page.waitForTimeout(8000);

  say(`${label}: url`, page.url());
  say(`${label}: title`, await page.title());
  const before = await collect(page);
  say(`${label}: editors`, before.editors);
  say(`${label}: buttons`, before.buttons);
  say(`${label}: bodyText`, before.bodyText);
  await page.screenshot({ path: `${OUT}/${label}-1-loaded.png`, fullPage: false });

  const editor = page.locator('textarea, [contenteditable="true"], [contenteditable=""]').first();
  let typed = false;
  try {
    await editor.waitFor({ state: 'visible', timeout: 15000 });
    await editor.click();
    await editor.type('probe message ' + label, { delay: 20 });
    typed = true;
  } catch (e) {
    say(`${label}: type failed`, e.message);
  }

  if (typed) {
    await page.screenshot({ path: `${OUT}/${label}-2-typed.png` });
    const stateBefore = await page.evaluate(() => {
      const el = document.querySelector('textarea, [contenteditable="true"], [contenteditable=""]');
      return el ? (el.value ?? el.innerText) : null;
    });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(5000);
    const stateAfter = await page.evaluate(() => {
      const el = document.querySelector('textarea, [contenteditable="true"], [contenteditable=""]');
      return el ? (el.value ?? el.innerText) : null;
    });
    const bubbles = await page.evaluate(() =>
      (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 2500)
    );
    say(`${label}: editor value before Enter`, stateBefore);
    say(`${label}: editor value after Enter`, stateAfter);
    say(`${label}: page text after Enter`, bubbles);
    say(`${label}: newline inserted`, String(stateAfter).includes('\n'));
    await page.screenshot({ path: `${OUT}/${label}-3-after-enter.png` });
  }

  say(`${label}: console errors`, errors.slice(0, 20));
  await browser.close();
}

await run('native', false);
await run('userscript', true);

await fs.writeFile(`${OUT}/report.md`, report.join('\n'), 'utf8');
console.log(report.join('\n'));
