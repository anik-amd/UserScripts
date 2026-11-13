// Throwaway probe: selection must survive site pointer blocking, overlays, and copy hijacking.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const OUT = 'probe-out';
await fs.mkdir(OUT, { recursive: true });
const report = [];
const say = (k, v) => report.push(`## ${k}\n${typeof v === 'string' ? v : JSON.stringify(v, null, 1)}\n`);

const SELECT_SCRIPT = await fs.readFile('scripts/qwen-selectable-text.user.js', 'utf8');
const SEND_SCRIPT = await fs.readFile('scripts/qwen-enter-to-send.user.js', 'utf8');

const flush = () => fs.writeFile(`${OUT}/report.md`, report.join('\n'), 'utf8');
process.on('unhandledRejection', async (e) => {
  say('FAILED', String((e && e.message) || e));
  await flush();
  process.exit(1);
});

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 400, height: 860 },
  locale: 'en-US',
  permissions: ['clipboard-read', 'clipboard-write']
});
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 160)));
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 160)));

await page.addInitScript(SELECT_SCRIPT);
await page.addInitScript(SEND_SCRIPT);
await page.goto('https://chat.qwen.ai', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(8000);
await page.evaluate(() => document.querySelector('[class*="cookie-confirm"]')?.remove());

// ---- setup: hostile CSS (loaded after the script, like the site bundle) ----
await page.evaluate(() => {
  const hostile = document.createElement('style');
  hostile.textContent = `
    .qwen-markdown, .qwen-markdown * { -webkit-user-select: none; user-select: none; }
    .message-inner-ci, .message-inner-ci * { user-select: none !important; }
  `;
  document.head.appendChild(hostile);
});

const MESSAGE = 'copyable reply text';
await page.evaluate((message) => {
  const wrap = document.createElement('div');
  wrap.className = 'qwen-markdown';
  wrap.id = 'probe-msg';
  // Fixed placement inside the viewport: appending to <body> can land below the fold.
  wrap.style.cssText = 'position:fixed;left:16px;top:220px;width:320px;z-index:90000;background:#fff';
  wrap.innerHTML = `<div class="qwen-markdown-paragraph"><span class="qwen-markdown-text"><span class="qwen-markdown-text-node">${message}</span></span></div>`;
  document.body.appendChild(wrap);
}, MESSAGE);

async function dragSelect() {
  const box = await page.locator('#probe-msg').boundingBox();
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 10 });
  const mid = await page.evaluate(() => getSelection().toString());
  await page.mouse.up();
  await page.waitForTimeout(120);
  const after = await page.evaluate(() => getSelection().toString());
  return { mid, after };
}

say('css unlocked', await page.evaluate(() => {
  const node = document.querySelector('#probe-msg .qwen-markdown-text-node');
  return { userSelect: getComputedStyle(node).userSelect, inline: node.style.getPropertyValue('user-select') };
}));

await page.evaluate(() => {
  window.__selTrace = [];
  document.addEventListener('selectionchange', () => {
    window.__selTrace.push(getSelection().toString().slice(0, 40));
  }, true);
});
say('drag select', await dragSelect());
say('selectionchange trace', await page.evaluate(() => window.__selTrace || null));

// ---- hostile: site blocks pointerdown/mousedown at window level ----
await page.evaluate(() => {
  window.__pointerSeen = 0;
  const block = (e) => {
    window.__pointerSeen += 1;
    e.preventDefault();
  };
  window.addEventListener('mousedown', block, true);
  window.addEventListener('pointerdown', block, true);
});
say('drag under window-level block', await dragSelect());
say('site pointer handlers saw', await page.evaluate(() => window.__pointerSeen));

// ---- hostile: transparent overlay above the message ----
await page.evaluate(() => {
  const overlay = document.createElement('div');
  overlay.id = 'probe-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:transparent';
  overlay.addEventListener('mousedown', (e) => e.preventDefault(), true);
  document.body.appendChild(overlay);
  getSelection().removeAllRanges();
});
say('drag under overlay', await dragSelect());

// double-click fallback must still select the message through the overlay
await page.evaluate(() => getSelection().removeAllRanges());
const box = await page.locator('#probe-msg').boundingBox();
await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(200);
say('double-click selection', await page.evaluate(() => getSelection().toString()));

// Alt+C must copy the message without any selection
await page.evaluate(() => getSelection().removeAllRanges());
await page.evaluate(() => navigator.clipboard.writeText('BEFORE-ALT-C'));
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.keyboard.press('Alt+c');
await page.waitForTimeout(400);
say('alt+c clipboard', await page.evaluate(() => navigator.clipboard.readText()));

// remove overlay + hijackers before the send regression
await page.evaluate(() => document.querySelector('#probe-overlay')?.remove());
await page.evaluate(() => location.reload());
await page.waitForTimeout(8000);
await page.evaluate(() => document.querySelector('[class*="cookie-confirm"]')?.remove());

// ---- regression: Enter-to-send still fires exactly one send ----
const ta = page.locator('textarea').first();
await ta.click({ force: true });
await ta.type('probe selectable', { delay: 10 });
await page.evaluate(() => {
  window.__clicks = [];
  const native = HTMLElement.prototype.click;
  HTMLElement.prototype.click = function () {
    window.__clicks.push(`${this.tagName}.${typeof this.className === 'string' ? this.className : ''}`);
    return native.apply(this, arguments);
  };
});
await page.keyboard.press('Enter');
await page.waitForTimeout(4000);
say('send after fix', await page.evaluate(() => ({
  clicks: window.__clicks || [],
  value: document.querySelector('textarea')?.value,
  loginWall: /Welcome to Qwen/i.test(document.body.innerText || '')
})));

await page.screenshot({ path: `${OUT}/selectable-v13.png` });
say('console errors', errors.slice(0, 10));
await browser.close();
await flush();
console.log(report.join('\n'));
