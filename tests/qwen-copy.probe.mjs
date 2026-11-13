// Throwaway probe: does text selection work in Qwen's narrow ("mobile") layout?
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const OUT = 'probe-out';
await fs.mkdir(OUT, { recursive: true });
const report = [];
const say = (k, v) => report.push(`## ${k}\n${typeof v === 'string' ? v : JSON.stringify(v, null, 1)}\n`);

async function experiment(width) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height: 860 }, locale: 'en-US' });
  const page = await ctx.newPage();
  await page.goto('https://chat.qwen.ai', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);

  const meta = await page.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find((e) => /How can I help you/i.test(e.textContent || '') && e.children.length === 0);
    const s = el ? getComputedStyle(el) : null;
    return {
      htmlClass: document.documentElement.className,
      touchAction: document.body.style.touchAction || getComputedStyle(document.body).touchAction,
      el: el ? el.tagName + '.' + el.className : null,
      userSelect: s ? s.userSelect : null,
      webkitUserSelect: s ? s.webkitUserSelect : null
    };
  });
  say(`${width}px: meta`, meta);

  const target = page.getByText('How can I help you?').first();
  const box = await target.boundingBox();
  if (!box) {
    say(`${width}px: target`, 'not found');
    await browser.close();
    return;
  }

  const readSelection = () => page.evaluate(() => {
    const sel = getSelection();
    return { text: sel ? sel.toString().slice(0, 80) : null, ranges: sel ? sel.rangeCount : 0 };
  });

  // 1. drag across the text
  await page.mouse.move(box.x + 3, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 3, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  say(`${width}px: drag`, await readSelection());
  await page.screenshot({ path: `${OUT}/select-drag-${width}.png` });

  // 2. triple click
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { clickCount: 3 });
  say(`${width}px: triple click`, await readSelection());

  // 3. Ctrl+A
  await page.keyboard.press('Control+A');
  say(`${width}px: ctrl+a`, await readSelection());

  // 4. does a mousedown handler cancel the event?
  say(`${width}px: mousedown defaultPrevented`, await page.evaluate(() => {
    let prevented = null;
    const probe = (e) => {
      setTimeout(() => {
        prevented = e.defaultPrevented;
      }, 0);
    };
    document.addEventListener('mousedown', probe, true);
    const el = document.elementFromPoint(200, 200);
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }));
    document.removeEventListener('mousedown', probe, true);
    return prevented;
  }));

  await browser.close();
}

await experiment(1280);
await experiment(400);

await fs.writeFile(`${OUT}/report.md`, report.join('\n'), 'utf8');
console.log(report.join('\n'));
