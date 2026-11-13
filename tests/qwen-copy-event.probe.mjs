// Throwaway probe: does the userscript stop site copy handlers from hijacking Ctrl+C?
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const OUT = 'probe-out';
await fs.mkdir(OUT, { recursive: true });
const report = [];
const say = (k, v) => report.push(`## ${k}\n${typeof v === 'string' ? v : JSON.stringify(v, null, 1)}\n`);

const SELECT_SCRIPT = await fs.readFile('scripts/qwen-selectable-text.user.js', 'utf8');
const flush = () => fs.writeFile(`${OUT}/report.md`, report.join('\n'), 'utf8');
process.on('unhandledRejection', async (e) => {
  say('FAILED', String((e && e.message) || e));
  await flush();
  process.exit(1);
});

async function scenario(label, inject) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 400, height: 860 },
    locale: 'en-US',
    permissions: ['clipboard-read', 'clipboard-write']
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 120)));

  if (inject) await page.addInitScript(SELECT_SCRIPT);
  await page.goto('https://chat.qwen.ai', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(7000);
  await page.evaluate(() => document.querySelector('[class*="cookie-confirm"]')?.remove());

  // Synthetic message body, like a rendered reply.
  await page.evaluate(() => {
    const wrap = document.createElement('div');
    wrap.className = 'qwen-markdown';
    wrap.innerHTML = '<div class="qwen-markdown-paragraph"><span class="qwen-markdown-text"><span class="qwen-markdown-text-node">copy-me-12345</span></span></div>';
    document.body.appendChild(wrap);
    window.__siteSaw = { copy: 0, keydown: 0 };
  });

  // Site-like hijackers, installed after the userscript (as the real bundle is).
  await page.evaluate(() => {
    document.addEventListener('copy', (e) => {
      window.__siteSaw.copy += 1;
      e.preventDefault();
      navigator.clipboard.writeText('COPY-EVENT-HIJACK');
    }, true);
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'c') {
        window.__siteSaw.keydown += 1;
        e.preventDefault();
        navigator.clipboard.writeText('KEYDOWN-HIJACK');
      }
    }, true);
  });

  // Select the message text.
  say(`${label}: selection`, await page.evaluate(() => {
    const node = document.querySelector('.qwen-markdown-text-node');
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return { text: selection.toString(), userSelect: getComputedStyle(node).userSelect };
  }));

  await page.evaluate(() => navigator.clipboard.writeText('BEFORE'));
  await page.keyboard.press('Control+C');
  await page.waitForTimeout(800);

  say(`${label}: clipboard`, await page.evaluate(() => navigator.clipboard.readText()));
  say(`${label}: site handlers saw`, await page.evaluate(() => window.__siteSaw));
  say(`${label}: page errors`, errors.slice(0, 5));
  await page.screenshot({ path: `${OUT}/${label}.png` });
  await browser.close();
}

await scenario('without-userscript', false);
await scenario('with-userscript', true);

await flush();
console.log(report.join('\n'));
