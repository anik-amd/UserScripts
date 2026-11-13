// Throwaway probe: why text selection fails in a narrow Qwen window.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const OUT = 'probe-out';
await fs.mkdir(OUT, { recursive: true });
const report = [];
const say = (k, v) => report.push(`## ${k}\n${typeof v === 'string' ? v : JSON.stringify(v, null, 1)}\n`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, locale: 'en-US' });
const page = await ctx.newPage();

await page.goto('https://chat.qwen.ai', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(8000);
await page.screenshot({ path: `${OUT}/narrow-loaded.png` });

say('viewport', page.viewportSize());

say(
  'selection styles',
  await page.evaluate(() => {
    const pick = (el) => {
      const s = getComputedStyle(el);
      return {
        el: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${typeof el.className === 'string' ? el.className.split(/\s+/).slice(0, 3).join('.') : ''}`,
        userSelect: s.userSelect,
        webkitUserSelect: s.webkitUserSelect,
        pointerEvents: s.pointerEvents
      };
    };
    const chain = (el) => {
      const out = [];
      let node = el;
      for (let i = 0; i < 6 && node; i += 1, node = node.parentElement) out.push(pick(node));
      return out;
    };
    const main = document.querySelector('main') || document.body;
    return {
      body: pick(document.body),
      root: document.querySelector('#root') ? pick(document.querySelector('#root')) : null,
      mainChain: chain(main),
      headingChain: chain([...document.querySelectorAll('h1,h2,h3,div,span')].find((e) => /How can I help you/i.test(e.textContent || '')) || document.body)
    };
  })
);

say(
  'hit test',
  await page.evaluate(() => {
    const describe = (el) => {
      if (!el) return null;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        el: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${typeof el.className === 'string' ? el.className.split(/\s+/).slice(0, 3).join('.') : ''}`,
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        userSelect: s.userSelect,
        pointerEvents: s.pointerEvents,
        position: s.position,
        zIndex: s.zIndex,
        text: (el.textContent || '').trim().slice(0, 60)
      };
    };
    const points = [];
    for (const fy of [0.25, 0.4, 0.55, 0.7]) {
      points.push([Math.round(innerWidth * 0.5), Math.round(innerHeight * fy)]);
    }
    return points.map(([x, y]) => {
      let el = document.elementFromPoint(x, y);
      const chain = [];
      for (let i = 0; i < 5 && el; i += 1, el = el.parentElement) chain.push(describe(el));
      return { point: [x, y], chain };
    });
  })
);

say(
  'large overlays',
  await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const s = getComputedStyle(el);
      if (s.position !== 'fixed' && s.position !== 'absolute') continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.width * r.height < innerWidth * innerHeight * 0.4) continue;
      out.push({
        el: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${typeof el.className === 'string' ? el.className.split(/\s+/).slice(0, 4).join('.') : ''}`,
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        pointerEvents: s.pointerEvents,
        zIndex: s.zIndex,
        overflow: s.overflow,
        cursor: s.cursor
      });
    }
    return out.slice(0, 25);
  })
);

say(
  'css rules with user-select:none',
  await page.evaluate(() => {
    const hits = [];
    for (const sheet of document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      const walk = (list, media) => {
        for (const rule of list) {
          if (rule.cssRules && rule.conditionText !== undefined) {
            walk(rule.cssRules, rule.conditionText);
          } else if (rule.style && rule.style.userSelect === 'none') {
            hits.push(`${media ? `@media ${media} ` : ''}${rule.selectorText}`);
          }
        }
      };
      walk(rules, '');
    }
    return [...new Set(hits)].slice(0, 40);
  })
);

await browser.close();
await fs.writeFile(`${OUT}/report.md`, report.join('\n'), 'utf8');
console.log(report.join('\n'));
