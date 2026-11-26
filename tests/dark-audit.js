// Karanlık mod okunabilirlik taraması: her sayfada yazı rengi ile gerçek arka plan arasındaki kontrastı ölçer.
// Kullanım: node tests/dark-audit.js  (yalnız teşhis içindir, test paketine dahil değildir)
const { startStaticServer, createFakeFirebase, newDevice, launch } = require('./e2e/helpers');

const AUDIT = () => {
      const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const a = m[1].split(',').map((x) => parseFloat(x)); return { r: a[0], g: a[1], b: a[2], a: a.length > 3 ? a[3] : 1 }; };
      const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
      const bgOf = (el) => { const stack = []; for (let e = el; e; e = e.parentElement) { const gi = getComputedStyle(e).backgroundImage; const gm = gi && gi.includes('gradient') ? gi.match(/rgba?\([^)]+\)/) : null; const c = gm ? parse(gm[0]) : parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 0.95) break; } } let res = { r: 0, g: 0, b: 0 }; const base = stack.pop() || { r: 0, g: 0, b: 0 }; res = { r: base.r, g: base.g, b: base.b }; while (stack.length) { const c = stack.pop(); res = { r: c.r * c.a + res.r * (1 - c.a), g: c.g * c.a + res.g * (1 - c.a), b: c.b * c.a + res.b * (1 - c.a) }; } return res; };
      const found = [];
      document.querySelectorAll('.content *, .topbar *, nav *, #modalRoot *').forEach((el) => {
        const t = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
        if (!t || t.length < 2) return; const rect = el.getBoundingClientRect(); if (!rect.width || !rect.height) return;
        const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.2) return;
        const fg = parse(cs.color), bg = bgOf(el); if (!fg) return;
        const L1 = lum(fg), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        if (ratio < 3) found.push({ ratio: Math.round(ratio * 100) / 100, tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 60), text: t.slice(0, 50), color: cs.color, bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`, style: (el.getAttribute('style') || '').slice(0, 80), pstyle: (el.parentElement?.getAttribute('style') || '').slice(0, 80) });
      });
      return found;
};
(async () => {
  const { server, url } = await startStaticServer();
  const browser = await launch();
  const fb = createFakeFirebase();
  const p = await newDevice(browser, url, fb);
  await p.setViewportSize({ width: 1366, height: 900 });
  await p.evaluate(() => document.getElementById('darkThemeBtn')?.click());
  await p.waitForTimeout(500);
  const routes = await p.evaluate(() => [...new Set([...document.querySelectorAll('[data-go],[data-route]')].map((b) => b.dataset.go || b.dataset.route))]);
  const out = {};
  for (const r of routes) {
    await p.evaluate((r) => { document.querySelector('#modalRoot .modal-backdrop')?.remove(); const b = document.querySelector(`[data-route="${r}"],[data-go="${r}"]`); b && b.click(); }, r);
    await p.waitForTimeout(400);
    const bad = await p.evaluate(AUDIT);
    if (bad.length) out[r] = bad;
    // sayfa içindeki sekmeler / alt menüler
    const tabs = await p.evaluate(() => [...document.querySelectorAll('.content [data-invoice-view],.content [data-def-tab],.content [data-tab],.content [data-view],.content [data-stock-view],.content [data-finance-tab],.content [data-pusula-report]')].map((b, i) => { b.dataset.auditIdx = 'a' + i; return 'a' + i; }));
    for (const t of tabs.slice(0, 30)) {
      const label = await p.evaluate((t) => { const b = document.querySelector(`[data-audit-idx="${t}"]`); if (!b) return null; const l = b.innerText.trim().slice(0, 30); b.click(); return l; }, t);
      if (!label) continue;
      await p.waitForTimeout(350);
      const bad2 = await p.evaluate(AUDIT);
      if (bad2.length) out[r + ' > ' + label] = bad2;
      await p.evaluate(() => { const x = document.querySelector('#modalX'); x && x.click(); });
      await p.evaluate((r) => { const b = document.querySelector(`[data-route="${r}"],[data-go="${r}"]`); b && b.click(); }, r);
      await p.waitForTimeout(250);
    }
  }
  console.log(JSON.stringify(out, null, 1));
  await browser.close(); server.close();
})();
