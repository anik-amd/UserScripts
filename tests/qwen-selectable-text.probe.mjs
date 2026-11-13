// Throwaway probe: isolate what stops a drag selection on .qwen-markdown.
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
const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, locale: 'en-US' });
const page = await ctx.newPage();
await page.addInitScript(SELECT_SCRIPT);
await page.addInitScript(SEND_SCRIPT);
await page.goto('https://chat.qwen.ai', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(8000);
await page.evaluate(() => document.querySelector('[class*="cookie-confirm"]')?.remove());

await page.evaluate(() => {
  const make = (id, top, className, inline, inner) => {
    const div = document.createElement('div');
    div.id = id;
    if (className) div.className = className;
    div.style.cssText = `position:fixed;left:16px;top:${top}px;width:320px;z-index:90000;background:#fff;${inline || ''}`;
    div.innerHTML = inner;
    document.body.appendChild(div);
  };

  make('t-plain', 120, '', '', 'plain selectable text');
  make('t-class', 180, 'qwen-markdown', '', 'class selectable text');
  make('t-inline', 240, '', 'user-select:text !important;-webkit-user-select:text !important', '<span>inline selectable text</span>');
  make(
    't-msg',
    300,
    'qwen-markdown',
    '',
    '<div class="qwen-markdown-paragraph"><span class="qwen-markdown-text"><span class="qwen-markdown-text-node">nested selectable text</span></span></div>'
  );

  window.__selEvents = [];
  document.addEventListener(
    'selectstart',
    (e) => {
      const seen = { prevented: e.defaultPrevented, target: String(e.target.className || e.target.id || e.target.tagName).slice(0, 40) };
      setTimeout(() => {
        seen.laterPrevented = e.defaultPrevented;
        window.__selEvents.push(seen);
      }, 0);
    },
    true
  );
});

async function drag(id) {
  const box = await page.locator('#' + id).boundingBox();
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 10 });
  const mid = await page.evaluate(() => getSelection().toString());
  await page.mouse.up();
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => getSelection().toString());
  const computed = await page.evaluate((elId) => {
    const node = document.querySelector('#' + elId);
    const s = getComputedStyle(node);
    return {
      userSelect: s.userSelect,
      webkitUserSelect: s.webkitUserSelect,
      pointerEvents: s.pointerEvents,
      inline: node.getAttribute('style')
    };
  }, id);
  return { mid, after, computed };
}

for (const id of ['t-plain', 't-class', 't-inline', 't-msg']) {
  await page.evaluate(() => getSelection().removeAllRanges());
  say(`drag ${id}`, await drag(id));
}

say('selectstart events', await page.evaluate(() => window.__selEvents));

say('child computed', await page.evaluate(() => {
  const node = document.querySelector('#t-msg .qwen-markdown-text-node');
  const cs = getComputedStyle(node);
  const rect = node.getBoundingClientRect();
  const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
  return {
    pointerEvents: cs.pointerEvents,
    userSelect: cs.userSelect,
    webkitUserDrag: cs.webkitUserDrag,
    display: cs.display,
    contentVisibility: cs.contentVisibility,
    touchAction: cs.touchAction,
    hit: hit ? `${hit.tagName}.${String(hit.className).slice(0, 50)}` : null
  };
}));

say('site rules touching qwen-markdown', await page.evaluate(() => {
  const out = [];
  const walk = (list, media) => {
    for (const rule of list) {
      if (rule.cssRules && rule.conditionText !== undefined) {
        walk(rule.cssRules, rule.conditionText);
        continue;
      }
      if (!rule.selectorText || !/qwen-markdown/.test(rule.selectorText)) continue;
      const css = rule.style.cssText;
      if (!/pointer-events|user-select|content-visibility|touch-action|overflow|position|z-index|display/.test(css)) continue;
      out.push({ selector: rule.selectorText.slice(0, 140), media, css: css.slice(0, 220) });
    }
  };
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    walk(rules, '');
  }
  return out.slice(0, 40);
}));

// does the site cancel a programmatically dispatched selectstart?
say('dispatch selectstart', await page.evaluate(() => {
  const node = document.querySelector('#t-msg .qwen-markdown-text-node');
  const event = new Event('selectstart', { bubbles: true, cancelable: true });
  node.dispatchEvent(event);
  return { defaultPrevented: event.defaultPrevented };
}));

await browser.close();
await flush();
console.log(report.join('\n'));
