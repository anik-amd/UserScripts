// Throwaway probe: inline !important must beat a hostile site rule; Enter-to-send must survive.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const OUT = 'probe-out';
await fs.mkdir(OUT, { recursive: true });
const report = [];
const say = (k, v) => report.push(`## ${k}\n${typeof v === 'string' ? v : JSON.stringify(v, null, 1)}\n`);

const SELECT_SCRIPT = await fs.readFile('scripts/qwen-selectable-text.user.js', 'utf8');
const SEND_SCRIPT = await fs.readFile('scripts/qwen-enter-to-send.user.js', 'utf8');

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, locale: 'en-US' });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 160)));
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 160)));

await page.addInitScript(SELECT_SCRIPT);
await page.addInitScript(SEND_SCRIPT);
await page.goto('https://chat.qwen.ai', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(8000);

// Hostile rules added AFTER the userscript, like the logged-in bundle does.
say('hostile css installed', await page.evaluate(() => {
  const hostile = document.createElement('style');
  hostile.textContent = `
    .qwen-markdown, .qwen-markdown * { -webkit-user-select: none; user-select: none; }
    .message-inner-ci, .message-inner-ci * { user-select: none !important; }
    html.mobile .message-inner-ci .qwen-markdown p { user-select: none !important; }
  `;
  document.head.appendChild(hostile);
  return true;
}));

// Message streamed in later, so the observer has to catch it.
say('late message', await page.evaluate(() => {
  const wrap = document.createElement('div');
  wrap.className = 'message-inner-ci';
  wrap.innerHTML = '<div class="qwen-markdown"><p>copyable reply text</p></div>';
  document.body.appendChild(wrap);
  const p = wrap.querySelector('p');
  const s = getComputedStyle(p);
  return {
    userSelect: s.userSelect,
    webkitUserSelect: s.webkitUserSelect,
    inlineUserSelect: p.style.getPropertyValue('user-select'),
    wrapper: getComputedStyle(wrap).userSelect
  };
}));

// Drag selection over the synthetic paragraph.
const target = page.getByText('copyable reply text').first();
const box = await target.boundingBox();
await page.mouse.move(box.x + 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 10 });
await page.mouse.up();
say('drag selection', await page.evaluate(() => getSelection().toString()));

// Framework reset: site writes user-select:none back onto the element.
say('after site reset', await page.evaluate(async () => {
  const p = document.querySelector('.qwen-markdown p');
  p.style.setProperty('user-select', 'none', 'important');
  await new Promise((r) => setTimeout(r, 50));
  return getComputedStyle(p).userSelect;
}));

// Site handler must not receive the mousedown that starts a selection.
say('site mousedown sees event', await page.evaluate(() => {
  let seen = 0;
  document.addEventListener('mousedown', () => { seen += 1; }, false);
  document.querySelector('.qwen-markdown p').dispatchEvent(
    new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })
  );
  return seen;
}));

// Interactive children must still receive events (copy button, links).
say('button mousedown passes through', await page.evaluate(() => {
  const btn = document.createElement('button');
  btn.textContent = 'copy';
  document.querySelector('.qwen-markdown').appendChild(btn);
  let seen = 0;
  document.addEventListener('mousedown', () => { seen += 1; }, false);
  btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  return seen;
}));

await page.screenshot({ path: `${OUT}/selectable-400.png` });

// Regression: Enter-to-send still works (guest composer -> login wall = send attempt).
const ta = page.locator('textarea').first();
await ta.click();
await ta.type('probe selectable', { delay: 10 });
await page.keyboard.press('Enter');
await page.waitForTimeout(4000);
say('send after fix', await page.evaluate(() => ({
  value: document.querySelector('textarea')?.value,
  loginWall: /Welcome to Qwen/i.test(document.body.innerText || '')
})));

say('console errors', errors.slice(0, 10));
await browser.close();
await fs.writeFile(`${OUT}/report.md`, report.join('\n'), 'utf8');
console.log(report.join('\n'));
