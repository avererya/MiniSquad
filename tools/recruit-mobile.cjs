// v0.5 phone checks (touch emulation): Recruitment Office (3 readable cards, no clipped text,
// tappable Recruit / Refresh, credits + roster count visible), rotation, soldier details with
// Dismiss, the dismissal confirmation, the rename dialog with the input focused and a
// simulated on-screen keyboard (shorter viewport), the owned-only roster, and the Campaign
// screen's New Campaign dialog. Devices: iPhone SE, iPhone 14, Pixel 7 (landscape + portrait).
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const OUT = process.env.OUT || '';
const URL = process.env.URL || 'http://localhost:4173/';
const DEVICES = [
  { name: 'iphoneSE', land: [667, 375], dpr: 2 },
  { name: 'iphone14', land: [844, 390], dpr: 3 },
  { name: 'pixel7', land: [915, 412], dpr: 2.625 },
];
(async () => {
  const browser = await chromium.launch();
  let fails = 0;
  const check = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(74)} ${String(detail).slice(0, 200)}`); };
  for (const dev of DEVICES) {
    const [W, H] = dev.land;
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true, deviceScaleFactor: dev.dpr });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(URL); await page.evaluate(() => localStorage.clear()); await page.goto(URL); await page.waitForTimeout(250);
    const shot = async (n) => { if (OUT) await page.screenshot({ path: `${OUT}/m-${dev.name}-${n}.png` }); };
    const layout = (sel) => page.evaluate((sel) => {
      const vw = window.innerWidth, vh = window.innerHeight, m = document.getElementById('menu');
      const boxes = [...document.querySelectorAll(sel)].map((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { inside: r.left >= -0.5 && r.top >= -0.5 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5, aligned: !!hit && (hit === el || el.contains(hit)), h: Math.round(r.height), w: Math.round(r.width) };
      });
      const texts = [...m.querySelectorAll('*')].filter((e) => e.offsetParent && [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()));
      const clipped = [...m.querySelectorAll('.rc-card *, .x-card *, .m-head *')].filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible' && e.tagName !== 'CANVAS' && e.tagName !== 'INPUT').map((e) => e.className + ':' + e.textContent.trim().slice(0, 20));
      const headOut = [...m.querySelectorAll('.m-head > *')].filter((e) => e.offsetParent && e.getBoundingClientRect().right > vw + 0.5).map((e) => e.className);
      return { n: boxes.length, boxes, minFont: Math.min(...texts.map((e) => parseFloat(getComputedStyle(e).fontSize))), clipped, headOut, vscroll: m.scrollHeight > m.clientHeight + 1, hOverflow: document.documentElement.scrollWidth > vw + 1 || m.scrollWidth > m.clientWidth + 1 };
    }, sel);
    const okBoxes = (L, minH = 34) => L.boxes.every((b) => b.inside && b.aligned && b.h >= minH);

    // ---------- owned-only roster (fresh save) + Campaign New Campaign button ----------
    const C = await layout('.c-reset, .c-btns [data-a="deploy"]');
    check(`${dev.name}: Campaign shows NEW CAMPAIGN button + Deploy, tappable, no scroll`, C.n === 2 && okBoxes(C, 30) && !C.vscroll && !C.hOverflow, JSON.stringify(C.boxes));
    await page.evaluate(() => { window.__account().credits = 6000; window.__persist(); });
    await page.tap('[data-a="to-barracks"]');
    const cards = await page.$$eval('.s-card', (c) => c.map((x) => x.dataset.id));
    check(`${dev.name}: fresh Barracks shows only Ace + Ranger (no locked preview cards)`, cards.join() === 'ace,ranger', cards.join());
    await shot('landscape-barracks-fresh');

    // ---------- Recruitment Office ----------
    await page.tap('[data-a="tab"][data-tab="recruit"]'); await page.waitForTimeout(80);
    const checkOffice = async (tag) => {
      const L = await layout('.rc-buy, [data-a="refresh"], .m-tab, [data-a="to-campaign"]');
      check(`${dev.name} ${tag}: 3 cards, Recruit/Refresh/tabs on screen + tappable (>=34px)`, L.n === 3 + 1 + 4 + 1 && okBoxes(L) && !L.hOverflow, `out ${L.boxes.filter((b) => !b.inside).length}, misaligned ${L.boxes.filter((b) => !b.aligned).length}, min h ${Math.min(...L.boxes.map((b) => b.h))}`);
      check(`${dev.name} ${tag}: no clipped text, header fits, text >= 11px, no vertical scroll`, L.clipped.length === 0 && L.headOut.length === 0 && L.minFont >= 11 && !L.vscroll, `clipped ${L.clipped.join('|')} head ${L.headOut.join('|')} font ${L.minFont} vscroll ${L.vscroll}`);
      const info = await page.evaluate(() => ({ cr: document.querySelector('.m-credits').textContent, ro: document.querySelector('.rc-bar .b-count').textContent }));
      check(`${dev.name} ${tag}: credits + roster count visible`, /\d,\d{3}/.test(info.cr) && /ROSTER\s*\d+ \/ 12/.test(info.ro), `${info.cr.trim()} · ${info.ro}`);
    };
    await checkOffice('landscape');
    await shot('landscape-recruit');
    const o = await page.evaluate(() => window.__account().recruitment.offers.map((x) => x.id));
    await page.tap(`.rc-card[data-id="${o[0]}"] .rc-buy`); await page.waitForTimeout(500);
    const st = await page.evaluate(() => ({ n: window.game.roster.activeCount(), cr: window.__account().credits }));
    check(`${dev.name}: tap Recruit -> joins (-750)`, st.n === 3 && st.cr === 5250, JSON.stringify(st));
    await page.tap('[data-a="refresh"]'); await page.waitForTimeout(450);
    await shot('landscape-refresh-armed');
    await page.tap('[data-a="refresh"]'); await page.waitForTimeout(500);
    check(`${dev.name}: Refresh tap, tap again -> -100`, (await page.evaluate(() => window.__account().credits)) === 5150);
    // rotation
    await page.setViewportSize({ width: H, height: W }); await page.waitForTimeout(400);
    const P = await layout('.rc-buy, [data-a="refresh"]');
    check(`${dev.name} portrait: office stacks cards, no sideways scroll`, P.n === 4 && !P.hOverflow && P.minFont >= 11, `vscroll ${P.vscroll}`);
    await shot('portrait-recruit');
    await page.setViewportSize({ width: W, height: H }); await page.waitForTimeout(400);
    await checkOffice('after rotation');

    // ---------- details, dismissal ----------
    await page.tap('[data-a="tab"][data-tab="roster"]');
    const rid = await page.evaluate(() => window.game.roster.owned().find((s) => s.id.startsWith('rc-')).id);
    await page.tap(`.s-card[data-id="${rid}"] .s-name`); await page.waitForTimeout(80);
    const D = await layout('.d-btns .m-big, .d-rename');
    check(`${dev.name}: details buttons (incl. Dismiss, Rename) on screen + tappable`, D.n >= 5 && okBoxes(D, 30), `${D.n} buttons, out ${D.boxes.filter((b) => !b.inside).length}`);
    await shot('landscape-details');
    await page.tap('.d-btns [data-a="dismiss"]'); await page.waitForTimeout(80);
    const X = await layout('[data-a="dismiss-cancel"], [data-a="dismiss-confirm"]');
    check(`${dev.name}: dismissal confirmation fits, Cancel/Confirm tappable, no clipping`, X.n === 2 && okBoxes(X, 36) && X.clipped.length === 0 && X.minFont >= 11, `clipped ${X.clipped.join('|')}`);
    await shot('landscape-dismiss-confirm');
    await page.tap('[data-a="dismiss-cancel"]'); await page.waitForTimeout(80);

    // ---------- rename with the phone keyboard ----------
    await page.tap('.d-rename'); await page.waitForTimeout(80);
    await page.tap('#rn-input'); await page.waitForTimeout(50);
    const focus1 = await page.evaluate(() => document.activeElement && document.activeElement.id);
    // simulate the on-screen keyboard: the visual viewport shrinks to about 45%
    await page.setViewportSize({ width: W, height: Math.round(H * 0.45) }); await page.waitForTimeout(450);
    const K = await page.evaluate(() => {
      const i = document.getElementById('rn-input'), r = i.getBoundingClientRect();
      return { focus: document.activeElement === i, top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight, fs: parseFloat(getComputedStyle(i).fontSize), menu: document.getElementById('menu').className };
    });
    check(`${dev.name}: keyboard up: input keeps focus, stays visible, 16px (no iOS zoom)`, focus1 === 'rn-input' && K.focus && K.top >= 0 && K.bottom <= K.vh && K.fs >= 16 && K.menu === 'barracks', JSON.stringify(K));
    await shot('landscape-rename-keyboard');
    await page.fill('#rn-input', '');
    await page.keyboard.type('Mo Jo');
    await page.keyboard.press('Enter'); await page.waitForTimeout(80);
    await page.setViewportSize({ width: W, height: H }); await page.waitForTimeout(450);
    const nm = await page.evaluate((id) => window.game.roster.get(id).name, rid);
    const scale = await page.evaluate(() => document.getElementById('stage').style.transform);
    check(`${dev.name}: rename via keyboard Enter saved; layout restored after keyboard`, nm === 'Mo Jo' && /scale/.test(scale) && !(await page.isVisible('#rn-input')), `${nm} · ${scale.slice(0, 50)}`);

    // ---------- New Campaign dialog ----------
    await page.keyboard.press('Escape');
    await page.tap('[data-a="to-campaign"]'); await page.waitForTimeout(80);
    await page.tap('[data-a="reset-open"]'); await page.waitForTimeout(80);
    const R = await layout('[data-a="reset-cancel"], [data-a="reset-confirm"]');
    check(`${dev.name}: New Campaign dialog fits, Cancel/Confirm tappable`, R.n === 2 && okBoxes(R, 36) && R.clipped.length === 0, '');
    await shot('landscape-new-campaign');
    await page.tap('[data-a="reset-cancel"]');

    check(`${dev.name}: no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall recruit mobile checks passed');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
