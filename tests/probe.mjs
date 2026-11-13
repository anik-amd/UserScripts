// Throwaway probe v4: verify the userscript clicks the real send button and nothing else.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const OUT = 'probe-out';
await fs.mkdir(OUT, { recursive: true });
const report = [];
const say = (k, v) => report.push(`## ${k}\n${typeof v === 'string' ? v : JSON.stringify(v, null, 1)}\n`);

const US = await fs.readFile('scripts/qwen-enter-to-send.user.js', 'utf8');

async function scenario(label, inject, keys, patchClick) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
  const page = await ctx.newPage();

  if (inject) await page.addInitScript(US);

  await page.goto('https://chat.qwen.ai', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(7000);

  if (patchClick) {
    await page.evaluate(() => {
      window.__clicks = [];
      const native = HTMLElement.prototype.click;
      HTMLElement.prototype.click = function () {
        window.__clicks.push(`${this.tagName}.${typeof this.className === 'string' ? this.className : ''}`);
        return native.apply(this, arguments);
      };
    });
  }

  const ta = page.locator('textarea').first();
  await ta.click();
  await ta.type('probe ' + label, { delay: 15 });

  const state = () =>
    page.evaluate(() => ({
      value: document.querySelector('textarea')?.value,
      newline: (document.querySelector('textarea')?.value || '').includes('\n'),
      loginWall: /Welcome to Qwen/i.test(document.body.innerText || ''),
      clicks: window.__clicks || []
    }));

  say(`${label}: before`, await state());
  for (const key of keys) await page.keyboard.press(key);
  await page.waitForTimeout(4000);
  say(`${label}: after`, await state());
  await page.screenshot({ path: `${OUT}/${label}.png` });
  await browser.close();
}

// Native reference: guest mode Enter already sends (login wall = send attempt).
await scenario('ref-native-enter', false, ['Enter'], false);
// Userscript must reproduce that exactly, and click only the send button.
await scenario('us-plain-enter', true, ['Enter'], true);
// Userscript must leave Shift+Enter alone.
await scenario('us-shift-enter', true, ['Shift+Enter'], true);

await fs.writeFile(`${OUT}/report.md`, report.join('\n'), 'utf8');
console.log(report.join('\n'));
