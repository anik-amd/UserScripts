// Probe: selection, copy, and fallbacks for qwen-selectable-text.user.js.
// Runs against a live chat.qwen.ai page with synthetic messages (the guest page has no chat
// bubbles). Drags sweep the text line, not the element's vertical centre: `.qwen-markdown`
// forces height:100%, so its centre is empty space and Chromium does not select there.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const OUT = 'probe-out';
await fs.mkdir(OUT, { recursive: true });
const report = [];
const failures = [];
const say = (k, v) => report.push(`## ${k}\n${typeof v === 'string' ? v : JSON.stringify(v, null, 1)}\n`);
const check = (name, ok, detail) => {
  report.push(`- ${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}\n`);
  if (!ok) failures.push(name);
};

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
page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));

await page.addInitScript(SELECT_SCRIPT);
await page.addInitScript(SEND_SCRIPT);
await page.goto('https://chat.qwen.ai', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(8000);
await page.evaluate(() => document.querySelector('[class*="cookie-confirm"]')?.remove());

const MESSAGES = {
  't-plain': 'plain selectable text',
  't-class': 'class selectable text',
  't-inline': 'inline selectable text',
  't-msg': 'nested selectable text'
};

await page.evaluate((messages) => {
  const make = (id, top, className, inline, inner) => {
    const div = document.createElement('div');
    div.id = id;
    if (className) div.className = className;
    div.style.cssText = `position:fixed;left:16px;top:${top}px;width:360px;z-index:90000;background:#fff;${inline || ''}`;
    div.innerHTML = inner;
    document.body.appendChild(div);
  };

  make('t-plain', 100, '', '', messages['t-plain']);
  make('t-class', 160, 'qwen-markdown', '', messages['t-class']);
  make('t-inline', 620, '', 'user-select:text !important;-webkit-user-select:text !important', `<span>${messages['t-inline']}</span>`);
  make(
    't-msg',
    680,
    'qwen-markdown',
    '',
    `<div class="qwen-markdown-paragraph"><span class="qwen-markdown-text"><span class="qwen-markdown-text-node">${messages['t-msg']}</span></span></div>`
  );
}, MESSAGES);

/** Sweep the first text line of `id`, which is where glyphs actually are. */
async function drag(id, { line = true } = {}) {
  const box = await page.locator('#' + id).boundingBox();
  const y = line ? box.y + 10 : box.y + Math.min(box.height / 2, 500);
  await page.mouse.move(box.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(250); // the fallback runs on a 0ms timer after mouseup
  return page.evaluate(() => getSelection().toString().trim());
}

// ---- 1. drag selection on every markup variant ----
for (const id of Object.keys(MESSAGES)) {
  await page.evaluate(() => getSelection().removeAllRanges());
  const selected = await drag(id);
  say(`drag ${id} (text line)`, { selected });
  check(`drag selects text in ${id}`, selected.includes(MESSAGES[id]), selected);
}

// ---- 2. site-level drag sabotage must not matter ----
await page.evaluate(() => {
  window.__blocked = 0;
  const block = (e) => {
    window.__blocked += 1;
    e.preventDefault();
  };
  window.addEventListener('mousedown', block, true);
  window.addEventListener('pointerdown', block, true);
  window.addEventListener('selectstart', block, true);
});
await page.evaluate(() => getSelection().removeAllRanges());
const underBlock = await drag('t-msg');
say('drag t-msg with site preventDefault', { selected: underBlock, blocked: await page.evaluate(() => window.__blocked) });
check('drag selects text while the site cancels pointer events', underBlock.includes(MESSAGES['t-msg']), underBlock);

// ---- 2b. mobile layout: preventDefault on pointerdown suppresses mousedown/mouseup entirely ----
await page.evaluate(() => {
  window.__mouseEvents = { mousedown: 0, mouseup: 0, pointerup: 0 };
  for (const type of ['mousedown', 'mouseup', 'pointerup']) {
    window.addEventListener(type, () => { window.__mouseEvents[type] += 1; }, true);
  }
  const block = (e) => e.preventDefault();
  window.addEventListener('pointerdown', block, true);
  window.__unblockPointer = () => window.removeEventListener('pointerdown', block, true);
});
await page.evaluate(() => getSelection().removeAllRanges());
const noMouse = await drag('t-msg');
const counters = await page.evaluate(() => window.__mouseEvents);
await page.evaluate(() => window.__unblockPointer());
say('drag with pointerdown default cancelled', { selected: noMouse, counters });
// In this headless browser the compatibility mouse events still fire, so the pointerup path only
// proves itself on the live site (verified separately in Brave's mobile layout, where a cancelled
// pointerdown suppresses mousedown/mouseup entirely).
check('drag selects text when a pointerdown handler cancels the event', noMouse.includes(MESSAGES['t-msg']), noMouse);

// ---- 3. transparent overlay above the message ----
await page.evaluate(() => {
  const overlay = document.createElement('div');
  overlay.id = 'probe-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:95000;background:transparent';
  document.body.appendChild(overlay);
  getSelection().removeAllRanges();
});
const underOverlay = await drag('t-msg');
say('drag t-msg under overlay', underOverlay);
check('drag selects text through an overlay', underOverlay.includes(MESSAGES['t-msg']), underOverlay);

// double-click fallback works even when the overlay swallowed the event
await page.evaluate(() => getSelection().removeAllRanges());
const box = await page.locator('#t-msg').boundingBox();
await page.mouse.dblclick(box.x + box.width / 2, box.y + 10);
await page.waitForTimeout(250);
const dbl = await page.evaluate(() => getSelection().toString().trim());
say('double-click selection', dbl);
check('double-click selects the message', dbl.includes(MESSAGES['t-msg']), dbl);

// Alt+C copies without any selection
await page.evaluate(() => {
  document.querySelector('#probe-overlay')?.remove();
  getSelection().removeAllRanges();
});
await page.evaluate(() => navigator.clipboard.writeText('BEFORE-ALT-C'));
await page.mouse.move(box.x + box.width / 2, box.y + 10);
await page.keyboard.press('Alt+c');
await page.waitForTimeout(400);
const altC = await page.evaluate(() => navigator.clipboard.readText());
say('alt+c clipboard', altC);
check('Alt+C copies the message', altC.includes(MESSAGES['t-msg']), altC);

// ---- 4. drag over empty space selects the message instead of nothing ----
await page.evaluate(() => getSelection().removeAllRanges());
const emptyArea = await drag('t-class', { line: false });
say('drag empty area of t-class', emptyArea);
check('drag over empty message area still yields text', emptyArea.includes(MESSAGES['t-class']), emptyArea);

// ---- 5. Ctrl+C must copy the selection even when the site hijacks it ----
await page.evaluate(() => {
  window.__siteSaw = { copy: 0, keydown: 0 };
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
await page.evaluate(() => getSelection().removeAllRanges());
await drag('t-msg');
await page.evaluate(() => navigator.clipboard.writeText('BEFORE-CTRL-C'));
await page.keyboard.press('Control+c');
await page.waitForTimeout(500);
const copied = await page.evaluate(() => navigator.clipboard.readText());
say('ctrl+c clipboard', { copied, siteSaw: await page.evaluate(() => window.__siteSaw) });
check('Ctrl+C copies the selection, not the site text', copied.includes(MESSAGES['t-msg']), copied);

// ---- 6. regression: Enter still sends exactly one message ----
await page.evaluate(() => location.reload());
await page.waitForTimeout(8000);
await page.evaluate(() => document.querySelector('[class*="cookie-confirm"]')?.remove());

const ta = page.locator('textarea').first();
await ta.click({ force: true });
await ta.type('probe selectable', { delay: 10 });
await page.evaluate(() => {
  window.__clicks = [];
  const native = HTMLElement.prototype.click;
  HTMLElement.prototype.click = function () {
    window.__clicks.push(`${this.tagName}.${String(this.className).trim()}`);
    return native.apply(this, arguments);
  };
});
await page.keyboard.press('Enter');
await page.waitForTimeout(4000);
const send = await page.evaluate(() => ({
  clicks: window.__clicks || [],
  value: document.querySelector('textarea')?.value ?? null
}));
say('send after fix', send);
check('Enter triggers exactly one send button click', send.clicks.length === 1 && send.clicks[0].startsWith('BUTTON.send-button'), send.clicks);

await page.screenshot({ path: `${OUT}/selectable-v15.png` });
say('console errors', errors.slice(0, 10));
say('summary', failures.length ? { failures } : 'all checks passed');

await browser.close();
await flush();
console.log(report.join('\n'));
if (failures.length) process.exitCode = 1;
