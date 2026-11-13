// Diagnostic: is the "class blocker" just geometry? .qwen-markdown forces height:100%,
// so the synthetic div is 860px tall with one line of text at its top.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const OUT = 'probe-out';
await fs.mkdir(OUT, { recursive: true });
const report = [];
const say = (k, v) => report.push(`## ${k}\n${typeof v === 'string' ? v : JSON.stringify(v, null, 1)}\n`);
const flush = () => fs.writeFile(`${OUT}/report.md`, report.join('\n'), 'utf8');
process.on('unhandledRejection', async (e) => {
  say('FAILED', String((e && e.message) || e));
  await flush();
  process.exit(1);
});

const SELECT_SCRIPT = await fs.readFile('scripts/qwen-selectable-text.user.js', 'utf8');

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, locale: 'en-US' });
const page = await ctx.newPage();
await page.goto('https://chat.qwen.ai', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(8000);
await page.evaluate(() => document.querySelector('[class*="cookie-confirm"]')?.remove());

await page.evaluate(() => {
  const make = (id, top, className, height, inner) => {
    const div = document.createElement('div');
    div.id = id;
    div.className = className;
    div.style.cssText = `position:fixed;left:16px;top:${top}px;width:320px;z-index:90000;background:#fff;${height ? `height:${height}px;` : ''}`;
    div.innerHTML = inner;
    document.body.appendChild(div);
  };

  // Control: tall plain div, one line at top (the geometry the synthetic qwen div accidentally had).
  make('g-tall', 40, '', 700, 'tall plain text');
});

say('boxes', await page.evaluate(() => {
  const out = {};
  for (const id of ['g-tall']) {
    const r = document.querySelector('#' + id).getBoundingClientRect();
    out[id] = { top: r.top, height: r.height, bottom: r.bottom };
  }
  return out;
}));

async function dragAt(id, dyFromTop) {
  const box = await page.locator('#' + id).boundingBox();
  const y = box.y + dyFromTop;
  await page.mouse.move(box.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  return page.evaluate(() => getSelection().toString().trim());
}

// g-tall is 700px tall with its text on line 1.
say('tall plain: drag on text line (y+10)', await dragAt('g-tall', 10));
await page.evaluate(() => getSelection().removeAllRanges());
say('tall plain: drag mid-height (empty)', await dragAt('g-tall', 350));
await page.evaluate(() => getSelection().removeAllRanges());

await page.evaluate(() => {
  document.querySelector('#g-tall').remove();
  const div = document.createElement('div');
  div.id = 'g-class';
  div.className = 'qwen-markdown';
  div.style.cssText = 'position:fixed;left:16px;top:40px;width:320px;z-index:90000;background:#fff';
  div.innerHTML = 'class text';
  document.body.appendChild(div);
});
say('class box', await page.evaluate(() => {
  const r = document.querySelector('#g-class').getBoundingClientRect();
  return { top: r.top, height: r.height };
}));

// g-class is tall because of the class rule; text still on line 1.
say('class: drag on text line (y+10)', await dragAt('g-class', 10));
await page.evaluate(() => getSelection().removeAllRanges());

// And with the userscript enabled.
await page.evaluate(SELECT_SCRIPT);
await page.waitForTimeout(400);
await page.evaluate(() => getSelection().removeAllRanges());
say('class + userscript: drag on text line', await dragAt('g-class', 10));

// Does the userscript's drag fallback fire when the native drag does happen to work?
say('class + userscript: drag on empty area', await (async () => {
  const before = await page.evaluate(() => {
    window.__added = 0;
    const add = Selection.prototype.addRange;
    Selection.prototype.addRange = function (range) {
      window.__added += 1;
      return add.apply(this, arguments);
    };
  });
  await page.evaluate(() => getSelection().removeAllRanges());
  const selected = await dragAt('g-class', 500);
  return { selected, addRangeCalls: await page.evaluate(() => window.__added) };
})());

say('computed height of class div', await page.evaluate(() => {
  const cs = getComputedStyle(document.querySelector('#g-class'));
  return { height: cs.height, width: cs.width, whiteSpace: cs.whiteSpace, unicodeBidi: cs.unicodeBidi };
}));

await browser.close();
await flush();
console.log(report.join('\n'));
