// Throwaway probe v2: exact composer DOM, send-control element, network on Enter/click.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const OUT = 'probe-out';
await fs.mkdir(OUT, { recursive: true });
const report = [];
const say = (key, value) => report.push(`## ${key}\n${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`);

const US = await fs.readFile('scripts/qwen-enter-to-send.user.js', 'utf8');

const DUMP = () => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const byName = [...document.querySelectorAll('*')]
    .filter((el) => {
      const n = `${el.id || ''} ${typeof el.className === 'string' ? el.className : ''}`;
      return /send|submit/i.test(n) && vis(el);
    })
    .slice(0, 20)
    .map((el) => ({
      tag: el.tagName,
      id: el.id,
      cls: typeof el.className === 'string' ? el.className : '',
      role: el.getAttribute('role'),
      label: el.getAttribute('aria-label'),
      html: el.outerHTML.slice(0, 900)
    }));
  const ta = document.querySelector('textarea');
  let composer = null;
  if (ta) {
    let node = ta;
    for (let i = 0; i < 4 && node.parentElement; i += 1) node = node.parentElement;
    composer = node.outerHTML.slice(0, 4000);
  }
  return { byName, composer };
};

async function run(label, inject, action) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
  const page = await ctx.newPage();
  const net = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' && !/\.(js|css|png|svg|woff2?|ico)(\?|$)/.test(r.url())) {
      net.push(`${r.method()} ${r.url().slice(0, 160)}`);
    }
  });

  if (inject) await page.addInitScript(US);
  await page.goto('https://chat.qwen.ai', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(7000);

  const dom = await page.evaluate(DUMP);
  say(`${label}: send-named elements`, dom.byName);
  say(`${label}: composer html`, dom.composer);

  const before = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 300));
  say(`${label}: modal before typing`, /Welcome to Qwen/i.test(before));

  const ta = page.locator('textarea').first();
  await ta.click();
  await ta.type('probe ' + label, { delay: 15 });
  const netAfterType = net.length;
  await page.screenshot({ path: `${OUT}/${label}-typed.png` });

  if (action === 'enter') await page.keyboard.press('Enter');
  if (action === 'click') {
    const clicked = await page.evaluate(() => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
      };
      const cands = [...document.querySelectorAll('div, span, button')].filter((el) => {
        const n = `${el.id || ''} ${typeof el.className === 'string' ? el.className : ''}`;
        return /send|submit/i.test(n) && vis(el);
      });
      const target = cands[cands.length - 1];
      if (!target) return null;
      target.click();
      return `${target.tagName}.${target.className}`;
    });
    say(`${label}: clicked`, clicked);
  }

  await page.waitForTimeout(5000);
  const after = await page.evaluate(() => {
    const el = document.querySelector('textarea');
    return {
      value: el ? el.value : null,
      body: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 600)
    };
  });
  say(`${label}: textarea after`, after.value);
  say(`${label}: body after`, after.body);
  say(`${label}: requests after action`, net.slice(netAfterType));
  await page.screenshot({ path: `${OUT}/${label}-after.png` });
  await browser.close();
}

await run('native-enter', false, 'enter');
await run('native-click', false, 'click');
await run('userscript-enter', true, 'enter');

await fs.writeFile(`${OUT}/report.md`, report.join('\n'), 'utf8');
console.log(report.join('\n'));
