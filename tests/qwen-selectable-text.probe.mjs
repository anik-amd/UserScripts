// Diagnostic: why does a drag never start a selection on elements with class .qwen-markdown?
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
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
await page.goto('https://chat.qwen.ai', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(8000);
await page.evaluate(() => document.querySelector('[class*="cookie-confirm"]')?.remove());

// Same page, two runs: without and with the userscript (injected at runtime, still early enough).
say('caret apis', await page.evaluate(() => {
  const describe = (fn) => ({
    type: typeof fn,
    native: typeof fn === 'function' ? /\[native code\]/.test(Function.prototype.toString.call(fn)) : null
  });
  return {
    caretRangeFromPoint: describe(Document.prototype.caretRangeFromPoint),
    instanceCaretRange: describe(document.caretRangeFromPoint),
    caretPositionFromPoint: describe(Document.prototype.caretPositionFromPoint),
    instanceCaretPosition: describe(document.caretPositionFromPoint)
  };
}));

await page.evaluate(() => {
  const make = (id, top, className, inner) => {
    const div = document.createElement('div');
    div.id = id;
    div.className = className;
    div.style.cssText = `position:fixed;left:16px;top:${top}px;width:320px;z-index:90000;background:#fff`;
    div.innerHTML = inner;
    document.body.appendChild(div);
    return div;
  };
  make('d-class', 200, 'qwen-markdown', 'class selectable text');
  make('d-inline', 260, '', '<span>inline selectable text</span>');
  // Same class, stripped after mount: survives CSS, keeps any JS handlers bound at insert.
  const stripped = make('d-stripped', 320, 'qwen-markdown', 'stripped selectable text');
  setTimeout(() => stripped.classList.remove('qwen-markdown'), 300);
});

await page.waitForTimeout(600);

say('class stripped?', await page.evaluate(() => document.querySelector('#d-stripped').className));

async function drag(id) {
  const box = await page.locator('#' + id).boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  return page.evaluate(() => getSelection().toString().trim());
}

say('drag before userscript', {
  dClass: await drag('d-class'),
  dInline: await drag('d-inline'),
  dStripped: await drag('d-stripped')
});

// computed-style diff between the two neighbouring divs
say('style diff (class vs inline)', await page.evaluate(() => {
  const a = getComputedStyle(document.querySelector('#d-class'));
  const b = getComputedStyle(document.querySelector('#d-inline'));
  const props = new Set([...a, ...b]);
  const diff = {};
  for (const prop of props) {
    const av = a.getPropertyValue(prop);
    const bv = b.getPropertyValue(prop);
    if (av !== bv) diff[prop] = { class: av, inline: bv };
  }
  return diff;
}));

// which site rules match .qwen-markdown, and what do they set?
say('site rules for qwen-markdown', await page.evaluate(() => {
  const out = [];
  const walk = (list, media) => {
    for (const rule of list) {
      if (rule.cssRules && rule.conditionText !== undefined) {
        walk(rule.cssRules, rule.conditionText);
        continue;
      }
      if (!rule.selectorText || !/qwen-markdown/.test(rule.selectorText)) continue;
      out.push({ selector: rule.selectorText.slice(0, 160), media, css: rule.style.cssText.slice(0, 300) });
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
  return { count: out.length, sample: out.slice(0, 25) };
}));

// Is the selection actually cancelled on selectstart, and by whom?
say('selectstart cancellation', await page.evaluate(() => {
  const node = document.querySelector('#d-class .qwen-markdown-text-node') || document.querySelector('#d-class');
  const fired = [];
  const listener = (e) => fired.push({ preventedAtCapture: e.defaultPrevented, target: e.target.nodeName });
  document.addEventListener('selectstart', listener, true);
  const event = new Event('selectstart', { bubbles: true, cancelable: true });
  node.dispatchEvent(event);
  document.removeEventListener('selectstart', listener, true);
  return { fired, preventedAfterDispatch: event.defaultPrevented };
}));

// Does adding the class to an already-working div break it?
say('add class to inline div then drag', await page.evaluate(() => {
  document.querySelector('#d-inline').className = 'qwen-markdown';
}));
say('drag after class add', await drag('d-inline'));

// now load the userscript and retry the class element
await page.evaluate(SELECT_SCRIPT);
await page.waitForTimeout(500);
await page.evaluate(() => getSelection().removeAllRanges());
say('drag d-class with userscript', await drag('d-class'));
say('caret probe inside d-class', await page.evaluate(() => {
  const box = document.querySelector('#d-class').getBoundingClientRect();
  const y = box.y + box.height / 2;
  const fromPoint = document.caretRangeFromPoint?.(box.x + 2, y);
  const fromPosition = document.caretPositionFromPoint?.(box.x + 2, y);
  return {
    range: fromPoint && {
      container: fromPoint.startContainer.nodeName,
      offset: fromPoint.startOffset,
      inside: document.querySelector('#d-class').contains(fromPoint.startContainer)
    },
    position: fromPosition && {
      node: fromPosition.offsetNode.nodeName,
      offset: fromPosition.offset,
      inside: document.querySelector('#d-class').contains(fromPosition.offsetNode)
    }
  };
}));

say('console errors', errors.slice(0, 10));
await page.screenshot({ path: `${OUT}/diag.png` });
await browser.close();
await flush();
console.log(report.join('\n'));
