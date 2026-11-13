// Throwaway probe v3: what does native Enter do, vs Shift+Enter, vs clicking the send div?
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const OUT = 'probe-out';
await fs.mkdir(OUT, { recursive: true });
const report = [];
const say = (key, value) => report.push(`## ${key}\n${value}\n`);

const STATE = () => {
  const ta = document.querySelector('textarea');
  const send = document.querySelector('.message-input-right-button-send, .message-input-right-button-send *');
  return {
    value: ta ? ta.value : null,
    newline: ta ? ta.value.includes('\n') : null,
    loginWall: /Welcome to Qwen/i.test(document.body.innerText || ''),
    sendRegion: document.querySelector('.message-input-right-button-send')?.outerHTML.slice(0, 700) || null,
    icon: send ? `${send.tagName}.${typeof send.className === 'string' ? send.className : ''}` : null
  };
};

async function scenario(label, act) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
  const page = await ctx.newPage();
  const net = [];
  page.on('request', (r) => {
    if (r.method() === 'POST') net.push(`${r.method()} ${r.url().slice(0, 120)}`);
  });

  await page.goto('https://chat.qwen.ai', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(7000);

  const ta = page.locator('textarea').first();
  await ta.click();
  await ta.type('probe ' + label, { delay: 15 });
  const typed = await page.evaluate(STATE);
  say(`${label}: state typed`, JSON.stringify({ ...typed, value: undefined }, null, 1));

  await act(page);
  await page.waitForTimeout(4000);
  const after = await page.evaluate(STATE);
  say(`${label}: state after`, JSON.stringify(after, null, 1));
  say(`${label}: POSTs`, net.length ? net.join('\n') : 'none');
  await page.screenshot({ path: `${OUT}/${label}.png` });
  await browser.close();
}

await scenario('a-control-no-key', async () => {});
await scenario('b-plain-enter', (p) => p.keyboard.press('Enter'));
await scenario('c-shift-enter', (p) => p.keyboard.press('Shift+Enter'));
await scenario('d-click-send-div', (p) => p.locator('.message-input-right-button-send').click({ force: true }));

await fs.writeFile(`${OUT}/report.md`, report.join('\n'), 'utf8');
console.log(report.join('\n'));
