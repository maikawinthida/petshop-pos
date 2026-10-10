import * as DB from './db.js?v=69';
import { OWNER_EMAIL } from './config.js?v=69';
import { BRAND_RULES, BRAND_RULES_VERSION, detectBrand } from './brands.js?v=69';

/* ---------- state ---------- */
const P = new Map(); let LIST = [];
let BRANDS = [];                          // [th, en, count]
const norm = s => String(s ?? '').toLowerCase().replace(/\s+/g, '');
function mkKey(o) { const b = BRANDS[o.brand]; const tl = (typeof TYPES !== 'undefined' && TYPES.find(([v]) => v && v === o.type)?.[1]) || '', al = (typeof ANIMALS !== 'undefined' && ANIMALS.find(([v]) => v && v === o.animal)?.[1]) || '';
  return norm(o.name + ' ' + o.code + (b ? ' ' + b[0] + ' ' + b[1] + ' ' + (b[3] || []).join(' ') : '') + ' ' + tl + ' ' + al); }
/* brands that match what's typed, in Thai, English or a short form ("sm", "สม" → สมาร์ทฮาร์ท) */
// English ↔ Thai words people mix when searching ("pramy salmon" finds "พรามี่ ... แซลมอน")
const SYN_PAIRS = [['salmon', 'แซลมอน'], ['tuna', 'ทูน่า'], ['chicken', 'ไก่'], ['beef', 'เนื้อ'], ['lamb', 'แกะ'], ['liver', 'ตับ'], ['fish', 'ปลา'], ['shrimp', 'กุ้ง'],
  ['seafood', 'ซีฟู้ด'], ['milk', 'นม'], ['goat', 'แพะ'], ['kitten', 'ลูกแมว'], ['puppy', 'ลูกสุนัข'], ['cat', 'แมว'], ['dog', 'สุนัข'], ['dog', 'หมา'], ['adult', 'โต'],
  ['litter', 'ทราย'], ['sand', 'ทราย'], ['tofu', 'เต้าหู้'], ['carnivore', 'คาร์นิวอร์'], ['pouch', 'เพาซ์'], ['jelly', 'เยลลี่'], ['gravy', 'เกรวี่'], ['snack', 'ขนม'], ['treat', 'ขนม']];
const SYN = {}; for (const [a, b] of SYN_PAIRS) { (SYN[a] ||= []).push(b); (SYN[b] ||= []).push(a); }
const hasWord = (key, w) => key.includes(w) || (SYN[w] || []).some(x => key.includes(x));
function wordMatch(list, words, extra = () => true) {
  let r = list.filter(p => extra(p) && words.every(w => hasWord(p.key, w)));
  // nothing found: forgive a typo at the end of long words ("carnivol" finds "carnivore")
  if (!r.length && words.some(w => w.length >= 5)) { const loose = words.map(w => w.length >= 5 && !SYN[w] ? w.slice(0, Math.max(4, w.length - 2)) : w); r = list.filter(p => extra(p) && loose.every(w => hasWord(p.key, w))); }
  return r;
}
function brandSuggest(q, max = 8) {
  const nq = norm(q); if (!nq) return [];
  const out = [];
  BRANDS.forEach((b, i) => {
    const names = [b[0], b[1], ...(b[3] || [])].map(norm).filter(Boolean);
    const score = names.some(n => n.startsWith(nq)) ? 2 : (nq.length >= 2 && names.some(n => n.includes(nq))) ? 1 : 0;
    if (score) out.push([score, b[2] || 0, i]);
  });
  return out.sort((a, b) => b[0] - a[0] || b[1] - a[1]).slice(0, max).map(x => x[2]);
}
const brandLabel = i => { const b = BRANDS[i]; return b ? `${b[0]}${b[1] ? ' · ' + b[1] : ''}` : ''; };
function drawBrandSug(box, list, onPick, active) {
  box.innerHTML = '';
  if (active >= 0 && BRANDS[active]) {
    const c = document.createElement('button'); c.type = 'button'; c.className = 'bchip on'; c.innerHTML = `ยี่ห้อ: ${esc(brandLabel(active))} <b>✕</b>`; c.onclick = () => onPick(-1); box.appendChild(c);
  }
  for (const i of list) { if (i === active) continue; const c = document.createElement('button'); c.type = 'button'; c.className = 'bchip'; c.innerHTML = `${esc(brandLabel(i))} <span class="hint">${BRANDS[i][2] || 0}</span>`; c.onclick = () => onPick(i); box.appendChild(c); }
  box.hidden = !box.children.length;
}

const store = {
  get(k, d) { try { const v = localStorage.getItem('pos.' + k); return v ? JSON.parse(v) : d } catch (e) { return d } },
  set(k, v) { try { localStorage.setItem('pos.' + k, JSON.stringify(v)) } catch (e) { } }
};
const DEFAULT_SETTINGS = { shop: 'หนองเป็ดเพ็ทชอป', pp: '', sellers: ['พ่อ', 'ไหม'], suppliers: ['ชินจิ', 'ฟู้ดอินโนว่า', 'แอลเคมาร์เก็ตติ้ง', 'เพอร์เฟคคอมพาเนียน'] };
const S = {
  user: null, isOwner: false,
  settings: { ...DEFAULT_SETTINGS, ...store.get('settingsCache', {}) },
  seller: '',
  autoPrint: store.get('autoPrint', false),
  bills: [], priceLog: [], staff: [],
  recent: store.get('recent', []),
  tabs: store.get('tabs', null), cur: 0
};
const newTab = () => ({ cart: [], disc: 0, discMode: 'baht' });
if (!Array.isArray(S.tabs) || !S.tabs.length) S.tabs = [newTab()];
const T = () => S.tabs[S.cur];
const saveTabs = () => store.set('tabs', S.tabs);

const $ = id => document.getElementById(id);
const fmt = n => Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = n => Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const METHOD = { cash: 'เงินสด', transfer: 'โอน', half: 'คนละครึ่ง' };
const fail = e => { console.error(e); toast(e?.code === 'permission-denied' ? 'บัญชีนี้ไม่มีสิทธิ์บันทึก' : 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง'); };

/* barcode typed (or scanned) while the keyboard is on Thai: the number keys give Thai letters */
const TH_KEYS = { 'ๅ': '1', '/': '2', '-': '3', 'ภ': '4', 'ถ': '5', 'ุ': '6', 'ึ': '7', 'ค': '8', 'ต': '9', 'จ': '0', 'ใ': '.',
  '๐': '0', '๑': '1', '๒': '2', '๓': '3', '๔': '4', '๕': '5', '๖': '6', '๗': '7', '๘': '8', '๙': '9' };
const thaiDigits = s => String(s).replace(/./g, c => TH_KEYS[c] ?? c);
const hasThai = s => /[\u0E00-\u0E7F]/.test(s);
// returns the digit string if the text is a barcode typed on the Thai layout, otherwise the text unchanged
function fixCode(v) { if (!hasThai(v)) return v; const c = thaiDigits(v); return /^\d{3,}$/.test(c) ? c : v; }
function toast(t, ms = 2200) { const el = document.createElement('div'); el.className = 'toast'; el.textContent = t; $('toastRoot').replaceChildren(el); setTimeout(() => el.remove(), ms); }
const modalOpen = () => !!$('modalRoot').firstChild;
function focusQ() { if (!modalOpen() && !$('viewSell').hidden && !$('appRoot').hidden) $('q').focus(); }

/* ---------- catalog from Firestore ---------- */
const chunkItems = {}; let chunksSeen = new Set(); let catalogTimer = null; let appShown = false;
function rebuildCatalog() {
  P.clear();
  for (const items of Object.values(chunkItems)) for (const [code, o] of Object.entries(items)) { const p = DB.unpackProduct(code, o); P.set(code, p); }
  LIST = [...P.values()].sort((a, b) => b.rank - a.rank);
  const counts = {}; for (const p of LIST) counts[p.brand] = (counts[p.brand] || 0) + 1;
  BRANDS.forEach((b, i) => b[2] = counts[i] || 0);
  for (const p of LIST) p.key = mkKey(p);
  // keep cart names/prices in step with edits made on other devices
  for (const t of S.tabs) for (const i of t.cart) { const p = P.get(i.code); if (p && !i.custom) { i.price = p.price; i.name = p.name; } }
  if (appShown) {
    if (!$('cart').contains(document.activeElement)) render(); if (!$('viewBills').hidden) renderBills();
    if (!$('viewProd').hidden && PF.mode !== 'edit' && PF.mode !== 'new') { drawPList(); if (PF.mode === 'view' && P.has(PF.code)) pfFill(P.get(PF.code)); }
  }
}
let loadErrors = [];
function onChunk(id, items, fromCache, pending) {
  chunkItems[id] = items; chunksSeen.add(id);
  if (!appShown) $('gateMsg').textContent = `กำลังโหลดข้อมูลสินค้า… (${chunksSeen.size}/${DB.CHUNKS})`;
  clearTimeout(catalogTimer); catalogTimer = setTimeout(rebuildCatalog, 120);
  if (chunksSeen.size === DB.CHUNKS && !appShown) { setTimeout(showApp, 150); }
  setSync();
}

/* ---------- sync indicator ---------- */
let pendingSales = false;
function setSync() {
  const el = $('sync'); if (!el) return;
  const off = !navigator.onLine;
  el.className = 'sync' + (off ? ' off' : pendingSales ? ' pending' : '');
  el.textContent = off ? '● ออฟไลน์ (ขายได้ตามปกติ)' : pendingSales ? '● กำลังซิงก์…' : '● ออนไลน์';
}
addEventListener('online', setSync); addEventListener('offline', setSync);

/* ---------- price changes ---------- */
function setProductPrice(code, price) {
  const p = P.get(code); if (!p || p.price === price) return;
  const old = p.price; p.price = price;
  DB.patchProduct(code, { p: price }).catch(fail);
  DB.logPrice({ code, name: p.name, kind: 'price', old, new: price, by: S.seller, email: S.user?.email || '' }).catch(() => { });
  for (const t of S.tabs) for (const i of t.cart) if (i.code === code && !i.custom) i.price = price;
  saveTabs();
}
function askPrice(it, newPrice) {
  const p = P.get(it.code);
  const s = openModal(`<h2>แก้ราคา</h2><p>${esc(it.name)}</p><p class="num" style="font-size:22px">${fmt0(it.price)} → <b>${fmt0(newPrice)}</b> บาท</p>
    <div class="mrow"><button class="ghost" id="onlyBill">เฉพาะบิลนี้</button><button class="primary" id="forever">เปลี่ยนราคาสินค้า (ครั้งหน้าใช้ราคานี้)</button></div>`);
  s.querySelector('#onlyBill').onclick = () => { it.price = newPrice; it.custom = true; closeModal(); render(); };
  s.querySelector('#forever').onclick = () => { if (p) setProductPrice(it.code, newPrice); it.price = newPrice; it.custom = false; closeModal(); render(); toast('บันทึกราคาใหม่แล้ว'); };
  s.querySelector('#forever').focus();
  s.onclose = () => render();
}

/* ---------- totals & render ---------- */
const lineDisc = i => Math.min(i.ld || 0, i.price * i.qty);          // baht off this line
const lineNet = i => Math.round((i.price * i.qty - lineDisc(i)) * 100) / 100;
function totals(t = T()) {
  const sub = t.cart.reduce((s, i) => s + i.price * i.qty, 0);
  const ldisc = Math.round(t.cart.reduce((s, i) => s + lineDisc(i), 0) * 100) / 100;
  const base = sub - ldisc;
  let d = t.discMode === 'pct' ? base * Math.min(t.disc, 100) / 100 : Math.min(t.disc, base); d = Math.round(d * 100) / 100;
  return { sub, ldisc, disc: d, net: Math.round((base - d) * 100) / 100, count: t.cart.reduce((s, i) => s + i.qty, 0) };
}
let lastAdded = null;
function renderTabs() {
  const box = $('billTabs'); box.innerHTML = '';
  if (S.tabs.length < 2) { box.hidden = true; return; } box.hidden = false;
  S.tabs.forEach((t, i) => {
    const b = document.createElement('button'); b.className = 'btab'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', i === S.cur);
    b.innerHTML = `บิล ${i + 1} <span class="num">· ${fmt0(totals(t).net)}</span>`; b.onclick = () => switchTab(i); box.appendChild(b);
  });
  const a = document.createElement('button'); a.className = 'btab add'; a.textContent = '+ เปิดบิลซ้อน'; a.onclick = holdBill; box.appendChild(a);
}
function renderCart() {
  const tb = $('cart'); tb.innerHTML = ''; const cart = T().cart;
  cart.forEach((it, idx) => {
    const tr = document.createElement('tr'); tr.dataset.i = idx; if (it.code === lastAdded) tr.className = 'flash';
    tr.innerHTML = `<td class="num">${idx + 1}</td>
      <td style="min-width:180px">${esc(it.name)}<div class="hint num">${esc(it.code)} · ${esc(it.unit)}${it.custom ? ' <span class="changed">ราคาพิเศษบิลนี้</span>' : ''}</div></td>
      <td style="white-space:nowrap"><span class="qty"><button aria-label="ลด">−</button><input class="num" value="${it.qty}" inputmode="numeric" aria-label="จำนวน"><button aria-label="เพิ่ม">+</button></span>
        <label class="ld"><span>ลด</span><input class="num" value="${it.ld || ''}" placeholder="0" inputmode="decimal" aria-label="ส่วนลดรายการนี้ (บาท)"></label></td>
      <td class="r"><input class="price" value="${it.price}" inputmode="decimal" aria-label="ราคา"></td>
      <td class="r num">${lineDisc(it) ? `<s class="was">${fmt(it.price * it.qty)}</s><br>` : ''}${fmt(lineNet(it))}</td>
      <td><button class="del" aria-label="ลบรายการ">×</button></td>`;
    const [minus, plus] = tr.querySelectorAll('.qty button'); const qi = tr.querySelector('.qty input');
    minus.onclick = () => { if (it.qty > 1) it.qty--; else cart.splice(idx, 1); render(); };
    plus.onclick = () => { it.qty++; render(); };
    qi.onchange = () => { if (scanInBox(qi, it.qty)) return; it.qty = Math.max(1, Math.min(9999, parseInt(qi.value) || 1)); render(); afterCartEdit(); };
    qi.onkeydown = e => { if (e.key === 'Enter') qi.blur(); };
    const li = tr.querySelector('.ld input');
    li.onchange = () => { if (scanInBox(li, it.ld || '')) return; const v = parseFloat(li.value); it.ld = v > 0 ? Math.min(Math.round(v * 100) / 100, it.price * it.qty) : 0; render(); afterCartEdit(); };
    li.onkeydown = e => { if (e.key === 'Enter') li.blur(); };
    const pi = tr.querySelector('.price');
    pi.onkeydown = e => { if (e.key === 'Enter') pi.blur(); };
    pi.onchange = () => { if (scanInBox(pi, it.price)) return; const v = parseFloat(pi.value); if (!(v >= 0) || v === it.price) { pi.value = it.price; return; } askPrice(it, Math.round(v * 100) / 100); };
    tr.querySelector('.del').onclick = () => { cart.splice(idx, 1); render(); focusQ(); };
    tb.appendChild(tr);
  });
  $('emptyCart').hidden = cart.length > 0;
}
// which cart box the person clicked while another one was being edited, so the re-draw doesn't lose it
let cartNext = null;
$('cart').addEventListener('pointerdown', e => { const inp = e.target.closest('input'); const tr = e.target.closest('tr');
  cartNext = inp && tr ? { i: tr.dataset.i, f: inp.closest('.qty') ? '.qty input' : inp.closest('.ld') ? '.ld input' : '.price' } : null; }, true);
function afterCartEdit() {
  const n = cartNext; cartNext = null;
  const el = n && document.querySelector(`#cart tr[data-i="${n.i}"] ${n.f}`);
  if (el) { el.focus(); el.select?.(); } else focusQ();
}
// a barcode typed into a quantity/discount/price box by the scanner: put the box back and scan it instead
function scanInBox(inp, keep) {
  const v = fixCode(String(inp.value).trim()); if (!/^\d{8,14}$/.test(v)) return false;
  inp.value = keep; cartNext = null; focusQ(); scanEnter(v); return true;
}
function render() {
  renderTabs(); renderCart();
  const t = totals(), tab = T();
  $('subtotal').textContent = fmt(t.sub); $('discAmt').textContent = fmt(t.disc);
  $('ldRow').hidden = !t.ldisc; $('ldAmt').textContent = '-' + fmt(t.ldisc);
  $('netBig').textContent = fmt0(t.net); $('itemCount').textContent = t.count + ' ชิ้น';
  $('ledLabel').textContent = S.tabs.length > 1 ? `ยอดสุทธิ บิล ${S.cur + 1}` : 'ยอดสุทธิ';
  if (document.activeElement !== $('disc')) $('disc').value = tab.disc;
  $('dBaht').setAttribute('aria-pressed', tab.discMode === 'baht'); $('dPct').setAttribute('aria-pressed', tab.discMode === 'pct');
  document.querySelectorAll('.pay').forEach(b => b.disabled = !tab.cart.length);
  saveTabs();
}
function renderSellers() { $('shopTitle').textContent = S.settings.shop; }

/* ---------- held bills ---------- */
function holdBill() { S.tabs.push(newTab()); S.cur = S.tabs.length - 1; $('notice').innerHTML = ''; render(); focusQ(); toast('เปิดบิลใหม่แล้ว บิลเดิมยังอยู่ด้านบน'); }
function switchTab(i) { S.cur = i; $('notice').innerHTML = ''; render(); focusQ(); }
function closeCurrentTab() { S.tabs.splice(S.cur, 1); if (!S.tabs.length) S.tabs = [newTab()]; S.cur = Math.min(S.cur, S.tabs.length - 1); render(); }
$('holdBtn').onclick = holdBill;

/* ---------- scanning ---------- */
// "09278" finds every product whose barcode ends in 09278 (like the old program)
function findByDigits(v) {
  if (P.has(v)) return [P.get(v)];
  if (!/^\d{3,}$/.test(v)) return [];
  const ends = LIST.filter(p => p.code.endsWith(v));
  return ends.length ? ends : (v.length >= 4 ? LIST.filter(p => p.code.includes(v)) : []);
}
function addItem(p, qty = 1) {
  if (p.price > 99999 || !/[^\d\s.,-]/.test(p.name || '')) { notFound(p.code, p); return; }   // broken record (barcodes saved as name/price): fix it right here
  const cart = T().cart; const ex = cart.find(i => i.code === p.code);
  if (ex) { ex.qty += qty; cart.splice(cart.indexOf(ex), 1); cart.unshift(ex); }
  else cart.unshift({ code: p.code, name: p.name, unit: p.unit, price: p.price, qty });
  lastAdded = p.code; $('notice').innerHTML = ''; render();
}
function notFound(code, old) {   // old = existing product whose saved name/price is broken: same box, fixes it
  $('notice').innerHTML = `<div class="notice">${old ? `สินค้าบาร์โค้ด <b class="num">${esc(code)}</b> ข้อมูลผิด ใส่ชื่อกับราคาใหม่` : `ไม่พบสินค้าบาร์โค้ด <b class="num">${esc(code)}</b> เพิ่มเป็นสินค้าใหม่ได้เลย`}
    <form id="addForm"><span class="brandbox" style="flex:1 1 150px"><input id="nBrand" placeholder="ยี่ห้อ เช่น sm, สม" autocomplete="off" style="width:100%"><div class="bsug drop qa" id="nBrandSug" hidden></div></span>
    <input id="nName" placeholder="ชื่อสินค้า เช่น แมวโต ทูน่า 85g" required autocomplete="off" style="flex:2 1 200px">
    <input id="nUnit" placeholder="หน่วย" style="flex:0 1 90px"><input id="nPrice" placeholder="ราคา" inputmode="decimal" required style="flex:0 1 90px">
    <button class="primary" style="padding:8px 14px;font-size:15px">เพิ่มและขาย</button></form></div>`;
  const nb = $('nBrand'), box = $('nBrandSug');
  const sug = () => { const v = nb.value.trim(); drawBrandSug(box, v && !BRANDS.some(b => b[0] === v) ? brandSuggest(v) : [], i => { if (i >= 0) nb.value = BRANDS[i][0]; box.hidden = true; $('nName').focus(); }, -1); };
  nb.addEventListener('input', sug); nb.addEventListener('focus', sug);
  nb.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 200));
  nb.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const c = box.querySelector('.bchip'); if (c && !box.hidden) c.click(); else $('nName').focus(); } });
  if (old) { if (old.brand >= 0 && BRANDS[old.brand]) nb.value = BRANDS[old.brand][0]; if (old.unit && /[^\d\s]/.test(old.unit)) $('nUnit').value = old.unit; }
  nb.focus();
  // the scanner types digits + Enter: if that lands in these boxes, it's the next product, not a name or price
  $('addForm').addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    const el = e.target, v = fixCode(el.value), m = v.match(/(\d{8,14})\s*$/), isPrice = el.id === 'nPrice';
    if (!m || (isPrice && m[1].length < 7)) return;
    e.preventDefault(); e.stopPropagation();
    el.value = el.value.slice(0, el.value.length - m[0].length).trim();
    if (!$('nName').value.trim()) $('notice').innerHTML = '';
    toast('ยิงบาร์โค้ดใหม่ ข้ามสินค้าที่ไม่มีในระบบ (' + code + ')');
    scanEnter(m[1]); focusQ();
  }, true);
  $('addForm').onsubmit = e => {
    e.preventDefault();
    const nm = $('nName').value.trim(), pr = parseFloat($('nPrice').value);
    if (!/[^\d\s.,-]/.test(nm)) { toast('ชื่อสินค้าต้องเป็นตัวหนังสือ ไม่ใช่ตัวเลขบาร์โค้ด'); $('nName').value = ''; $('nName').focus(); return; }
    if (!(pr >= 0) || pr > 99999) { toast('ราคาผิด (ต้องไม่เกิน 99,999 บาท) ใส่ใหม่อีกที'); $('nPrice').value = ''; $('nPrice').focus(); return; }
    const bv = nb.value.trim(); let name = $('nName').value.trim();
    let bi = bv ? brandIndex(bv) : (old && old.brand >= 0 ? old.brand : brandFromName(name));
    if (bi < 0 && bv) { BRANDS.push([bv, '', 0, []]); bi = BRANDS.length - 1; DB.addBrand(bv, '').catch(fail); }
    if (bi >= 0 && bv) { const [th, en] = BRANDS[bi]; const n = norm(name); if (!n.includes(norm(th)) && !(en && n.includes(norm(en)))) name = th + ' ' + name; }
    const p = { ...(old || { rank: 0, type: 'other', animal: '', big: 0, cost: 0, supplier: '' }), code, name, unit: $('nUnit').value.trim(), price: parseFloat($('nPrice').value) || 0, brand: bi };
    p.key = mkKey(p);
    if (old) Object.assign(old, p); else { P.set(code, p); LIST.push(p); }
    DB.saveProduct(old || p).catch(fail);
    $('notice').innerHTML = ''; addItem(old || p); toast(old ? 'แก้ข้อมูลสินค้าแล้ว' : 'เพิ่มสินค้าใหม่แล้ว'); focusQ();
  };
}
$('q').addEventListener('input', e => {
  const v = e.target.value; clearTimeout(qTimer);
  if (/[^\d\s*\-]/.test(thaiDigits(v))) { e.target.value = ''; openFinder(v); return; }
  // a scanner types the whole code in a few ms; a person typing one Thai letter (ค, ต, จ ...) pauses → open the search
  if (hasThai(v)) qTimer = setTimeout(() => { const w = $('q').value; if (w && w.length <= 3 && hasThai(w)) { $('q').value = ''; openFinder(w); } }, 300);
});
let qTimer;
$('q').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return; e.preventDefault();
  const raw = e.target.value.trim(); if (!raw) return; e.target.value = '';
  scanEnter(raw);
});
function scanEnter(raw) {
  const v = fixCode(raw); if (v !== raw) toast('แป้นพิมพ์เป็นภาษาไทยอยู่ ระบบอ่านเป็น ' + v + ' ให้แล้ว');
  const cart = T().cart;
  const m = v.match(/^\*(\d+)$/); if (m) { if (cart[0]) { cart[0].qty = Math.max(1, +m[1]); render(); } return; }
  if (v === '-') { const it = cart[0]; if (it) { if (it.qty > 1) { it.qty--; toast('ลดเหลือ ' + it.qty + ' ชิ้น'); } else { cart.shift(); toast('เอารายการล่าสุดออกแล้ว'); } render(); } return; }
  if (/^\d+$/.test(v)) {
    const hits = findByDigits(v);
    if (hits.length === 1) { addItem(hits[0]); return; }
    if (hits.length > 1) { openFinder(v); return; }
    if (v.length >= 8) { notFound(v); return; }
    toast('ไม่พบสินค้าที่บาร์โค้ดลงท้ายด้วย ' + v); return;
  }
  openFinder(v);
}
$('findBtn').onclick = () => openFinder('');

/* ---------- finder popup ---------- */
const TYPES = [['', 'ทั้งหมด'], ['dry', 'อาหารเม็ด'], ['big', 'กระสอบ / 5 กก.+'], ['wet', 'อาหารเปียก'], ['lick', 'แมวเลีย'], ['treat', 'ขนม'], ['litter', 'ทราย'], ['med', 'ยา/อาหารเสริม'], ['groom', 'อาบน้ำ/ดูแลขน'], ['gear', 'อุปกรณ์/ของเล่น'], ['other', 'อื่นๆ']];
const ANIMALS = [['', 'ทุกสัตว์'], ['cat', 'แมว'], ['dog', 'สุนัข'], ['other', 'นก/กระต่าย/หนู/ปลา']];
const F = { q: '', brand: '', type: '', animal: '', sort: 'rank', sel: 0, res: [], added: 0 };
function filterF() {
  const words = F.q.toLowerCase().split(/\s+/).filter(Boolean).map(norm);
  if (/^\d{3,}$/.test(fixCode(F.q.trim()))) { const d = fixCode(F.q.trim()); F.res = LIST.filter(p => p.code.endsWith(d)); if (!F.res.length) F.res = LIST.filter(p => p.code.includes(d)); F.sel = 0; return; }
  const r = wordMatch(LIST, words, p => (F.brand === '' || p.brand === +F.brand) && (F.type === '' || (F.type === 'big' ? p.big : p.type === F.type)) && (F.animal === '' || p.animal === F.animal));
  const cmp = { rank: (a, b) => b.rank - a.rank, name: (a, b) => a.name.localeCompare(b.name, 'th'), price: (a, b) => a.price - b.price, pricedesc: (a, b) => b.price - a.price }[F.sort];
  F.res = r.sort(cmp); F.sel = 0;
}
function chipRow(list, key) { return list.map(([v, l]) => `<button class="chip" data-k="${key}" data-v="${v}" aria-pressed="${F[key] === v}">${l}</button>`).join(''); }
function openFinder(q) {
  Object.assign(F, { q, brand: '', type: '', animal: '', sel: 0, added: 0 });
  const sug = q.trim().length >= 2 ? brandSuggest(q) : [];
  if (sug.length === 1) { F.brand = String(sug[0]); F.q = ''; }
  const opts = BRANDS.map((b, i) => [i, b]).filter(([, b]) => b[2]).sort((a, b) => a[1][0].localeCompare(b[1][0], 'th')).map(([i, b]) => `<option value="${i}">${esc(b[0])} ${esc(b[1])} (${b[2]})</option>`).join('');
  const s = openModal(`<div class="fhead">
      <div class="frow"><input type="search" id="fq" placeholder="พิมพ์ชื่อ ยี่ห้อ หรือบาร์โค้ด" autocomplete="off" value="${esc(F.q)}">
        <select id="fb" aria-label="ยี่ห้อ"><option value="">ทุกยี่ห้อ</option>${opts}</select>
        <select id="fs" aria-label="เรียงตาม"><option value="rank">เรียง: ขายดี</option><option value="name">เรียง: ชื่อ</option><option value="price">เรียง: ราคาน้อย→มาก</option><option value="pricedesc">เรียง: ราคามาก→น้อย</option></select>
        <button class="closeb" id="fclose" aria-label="ปิด"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>ปิด <kbd>Esc</kbd></button></div>
      <div class="bsug" id="fbs" hidden></div>
      <div class="frow"><span class="flabel">ประเภท</span><div class="fchips">${chipRow(TYPES, 'type')}</div></div>
      <div class="frow"><span class="flabel">สัตว์</span><div class="fchips">${chipRow(ANIMALS, 'animal')}</div></div>
    </div>
    <div class="fbody"><table><thead><tr><th>สินค้า</th><th>หน่วย</th><th class="r">ราคา (แก้ได้)</th><th></th></tr></thead><tbody id="fr"></tbody></table><div class="empty" id="fempty" hidden>ไม่พบสินค้า ลองพิมพ์สั้นลง หรือเปลี่ยนตัวกรอง</div></div>
    <div class="ffoot"><span class="hint" id="fcount"></span><span class="hint">↑↓ เลือก · Enter ใส่บิลแล้วปิด · ปุ่ม "ใส่บิล" ใส่ต่อได้หลายตัว</span></div>`, 'finder');
  s.querySelector('#fb').value = F.brand;
  const draw = () => { filterF(); drawRows(); };
  const sugDraw = () => drawBrandSug(s.querySelector('#fbs'), F.q.trim().length >= 1 && !/^\d+$/.test(F.q.trim()) ? brandSuggest(F.q) : [], i => {
    F.brand = i >= 0 ? String(i) : ''; s.querySelector('#fb').value = F.brand; if (i >= 0) { F.q = ''; s.querySelector('#fq').value = ''; } sugDraw(); draw(); s.querySelector('#fq').focus();
  }, F.brand === '' ? -1 : +F.brand);
  s.querySelector('#fq').oninput = e => { F.q = e.target.value; sugDraw(); draw(); };
  sugDraw();
  s.querySelector('#fb').onchange = e => { F.brand = e.target.value; sugDraw(); draw(); s.querySelector('#fq').focus(); };
  s.querySelector('#fs').onchange = e => { F.sort = e.target.value; draw(); };
  s.querySelector('#fclose').onclick = closeModal;
  s.querySelectorAll('.fchips .chip').forEach(c => c.onclick = () => { F[c.dataset.k] = c.dataset.v; s.querySelectorAll(`.chip[data-k="${c.dataset.k}"]`).forEach(x => x.setAttribute('aria-pressed', x === c)); draw(); s.querySelector('#fq').focus(); });
  s.querySelector('#fq').onkeydown = e => {
    if (e.key === 'ArrowDown') { F.sel = Math.min(F.sel + 1, Math.min(F.res.length, 300) - 1); drawRows(true); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { F.sel = Math.max(F.sel - 1, 0); drawRows(true); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); const p = F.res[F.sel]; if (p) { addItem(p); closeModal(); toast('ใส่ ' + p.name.slice(0, 24) + ' แล้ว'); } }
  };
  draw(); const fq = s.querySelector('#fq'); fq.focus(); fq.setSelectionRange(fq.value.length, fq.value.length);
}
function drawRows(onlySel) {
  const tb = $('fr'); if (!tb) return; const rows = F.res.slice(0, 300);
  if (onlySel) { tb.querySelectorAll('tr').forEach((tr, i) => tr.classList.toggle('on', i === F.sel)); tb.children[F.sel]?.scrollIntoView({ block: 'nearest' }); return; }
  tb.innerHTML = '';
  rows.forEach((p, i) => {
    const tr = document.createElement('tr'); if (i === F.sel) tr.className = 'on';
    const b = BRANDS[p.brand];
    tr.innerHTML = `<td style="min-width:220px">${esc(p.name)}${p.big ? '<span class="tag">กระสอบ</span>' : ''}<div class="hint num">${esc(p.code)}${b ? ' · ' + esc(b[0]) : ''}</div></td>
      <td>${esc(p.unit)}</td><td class="r"><input class="price" value="${p.price}" inputmode="decimal" aria-label="ราคา ${esc(p.name)}"></td>
      <td style="white-space:nowrap"><button class="addb">ใส่บิล</button><button class="editb">แก้</button></td>`;
    tr.onclick = e => { if (e.target.closest('input,button')) return; F.sel = i; drawRows(true); };
    tr.querySelector('.editb').onclick = () => editProduct(p.code);
    tr.querySelector('.addb').onclick = () => { addItem(p); F.added++; toast('ใส่ ' + p.name.slice(0, 24) + ' แล้ว'); updCount(); };
    const pi = tr.querySelector('.price');
    pi.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); pi.blur(); } };
    pi.onchange = () => { const v = Math.round(parseFloat(pi.value) * 100) / 100; if (!(v >= 0)) { pi.value = p.price; return; } const old = p.price; setProductPrice(p.code, v); toast(`บันทึกราคา ${fmt0(old)} → ${fmt0(v)} บาท`); render(); };
    tb.appendChild(tr);
  });
  $('fempty').hidden = F.res.length > 0; updCount();
}
function updCount() { const c = $('fcount'); if (!c) return; c.textContent = `พบ ${F.res.length.toLocaleString()} รายการ${F.res.length > 300 ? ' (แสดง 300 แรก ใช้ตัวกรองให้แคบลง)' : ''}${F.added ? ` · ใส่บิลแล้ว ${F.added} ครั้ง` : ''}`; }

/* ---------- discount & clear ---------- */
$('dBaht').onclick = () => { T().discMode = 'baht'; render(); }; $('dPct').onclick = () => { T().discMode = 'pct'; render(); };
$('disc').oninput = e => { T().disc = Math.max(0, parseFloat(e.target.value) || 0); const t = totals(); $('discAmt').textContent = fmt(t.disc); $('netBig').textContent = fmt0(t.net); renderTabs(); saveTabs(); };
$('disc').onkeydown = e => { if (e.key === 'Enter') focusQ(); };
$('clearBtn').onclick = () => { if (!T().cart.length && S.tabs.length < 2) return; confirmBox(S.tabs.length > 1 ? `ปิดบิล ${S.cur + 1} และล้างสินค้าทั้งหมด?` : 'ล้างสินค้าทั้งหมดในบิลนี้?', 'ล้างบิล', () => { closeCurrentTab(); focusQ(); }); };


/* ---------- ของหมด: shopping list for restocking, grouped brand → type → name ---------- */
const BUY = { items: [], sup: '' };
const QTY_QUICK = ['1 โหล', '2 โหล', '3 โหล', '6 ชิ้น', '1 ลัง', '2 ลัง', '1 แพ็ค', '1 กระสอบ', '2 กระสอบ'];
const typeLabel = t => t === 'big' ? 'กระสอบ' : (TYPES.find(([v]) => v === t)?.[1] || 'อื่นๆ');
const animalLabel = a => ANIMALS.find(([v]) => v === a && v)?.[1] || '';
function buyInfo(it) {   // live product data when linked, else what was saved with the item
  const p = it.code ? P.get(it.code) : null;
  const bi = p ? p.brand : -1;
  const nb = !(bi >= 0) && !it.bt ? brandFromName(p?.name || it.name) : -1;
  const b = bi >= 0 && BRANDS[bi] ? BRANDS[bi] : (it.bt ? BRANDS.find(x => x[0] === it.bt) || [it.bt, ''] : (nb >= 0 ? BRANDS[nb] : null));
  return { p, name: p?.name || it.name, brand: b ? b[0] + (b[1] ? ' · ' + b[1] : '') : 'ไม่มียี่ห้อ',
    type: p ? (p.type || 'other') : (it.t || 'other'), animal: p ? p.animal : (it.a || ''), sup: p?.supplier || it.s || '' };
}
function buyBadge() { const n = BUY.items.filter(i => !i.done).length; $('tabBuy').textContent = n ? `ของหมด (${n})` : 'ของหมด'; }
function buyOpen() { buyDraw(); if (innerWidth >= 900) $('bq').focus(); }
function buySearch() {
  const raw = $('bq').value.trim(), box = $('bRes'); box.innerHTML = '';
  if (!raw) return;
  const d = fixCode(raw); let res;
  if (/^\d{3,}$/.test(d)) res = LIST.filter(p => p.code.endsWith(d));
  else { const words = raw.toLowerCase().split(/\s+/).filter(Boolean).map(norm); res = wordMatch(LIST, words).sort((a, b) => b.rank - a.rank); }
  for (const p of res.slice(0, 12)) {
    const inList = BUY.items.find(i => i.code === p.code && !i.done);
    const b = document.createElement('button'); b.className = 'bresrow';
    b.innerHTML = `<span class="nm">${esc(p.name)}</span><span class="hint">${inList ? 'อยู่ในลิสต์: ' + esc(inList.qty || '') : esc(p.unit || '')}</span>`;
    b.onclick = () => buyAsk(p); box.appendChild(b);
  }
  if (!/^\d+$/.test(d)) { const b = document.createElement('button'); b.className = 'bresrow free'; b.innerHTML = `<span class="nm">＋ เพิ่ม "${esc(raw)}" เป็นรายการพิมพ์เอง</span>`; b.onclick = () => buyAsk(null, raw); box.appendChild(b); }
  else if (!res.length) box.innerHTML = '<p class="hint">ไม่พบบาร์โค้ดนี้ในระบบ</p>';
}
$('bq').addEventListener('input', buySearch);
$('bq').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const f = $('bRes').querySelector('.bresrow'); if (f) f.click(); } });
$('bCam').onclick = () => { SC.target = 'buy'; if (!SC.camOn) camStart(); };
function buyScan(code) { const p = P.get(code); if (p) buyAsk(p); else { $('bq').value = code; buySearch(); toast('ไม่พบบาร์โค้ดนี้ในระบบ'); } }
// ask how many to buy; editing an existing line when the product is already on the list
function buyAsk(p, freeName, item) {
  item = item || (p && BUY.items.find(i => i.code === p.code && !i.done)) || null;
  const name = p?.name || item?.name || freeName || '';
  const s = openModal(`<h2>${esc(name)}</h2><p class="hint" style="margin:0">จะซื้อเท่าไร</p>
    <div class="fchips qchips">${QTY_QUICK.map(q => `<button class="chip" data-q="${q}">${q}</button>`).join('')}</div>
    <input class="tin" id="buyQty" placeholder="หรือพิมพ์เอง เช่น 2 โหล, 10 ซอง" value="${esc(item?.qty || '')}">
    <input class="tin" id="buyNote" placeholder="หมายเหตุ (ถ้ามี) เช่น เอารสทูน่า" value="${esc(item?.note || '')}">
    <div class="mrow">${item ? '<button class="ghost bad" id="buyDel">ลบออกจากลิสต์</button>' : ''}<button class="ghost" id="buyNo">ยกเลิก</button><button class="primary" id="buyOk">${item ? 'บันทึก' : 'เพิ่มในลิสต์'}</button></div>`);
  const q = s.querySelector('#buyQty');
  s.querySelectorAll('.qchips .chip').forEach(c => c.onclick = () => { q.value = c.dataset.q; s.querySelector('.qchips [aria-pressed="true"]')?.setAttribute('aria-pressed', 'false'); c.setAttribute('aria-pressed', 'true'); });
  const ok = () => {
    const it = item ? { ...item } : { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), code: p?.code || '', done: false, at: Date.now() };
    it.qty = q.value.trim(); it.note = s.querySelector('#buyNote').value.trim(); it.name = name; it.by = S.user?.email || '';
    if (p) { const bi = p.brand; it.bt = bi >= 0 && BRANDS[bi] ? BRANDS[bi][0] : ''; it.t = p.type || 'other'; it.a = p.animal || ''; it.s = p.supplier || ''; }
    const i = BUY.items.findIndex(x => x.id === it.id); if (i >= 0) BUY.items[i] = it; else BUY.items.push(it);
    DB.saveBuy(it).catch(fail); closeModal(); buyDraw(); buyBadge();
    toast(item ? 'แก้ไขแล้ว' : 'เพิ่มในลิสต์ของหมดแล้ว'); $('bq').value = ''; $('bRes').innerHTML = '';
  };
  s.querySelector('#buyOk').onclick = ok; s.querySelector('#buyNo').onclick = closeModal;
  q.onkeydown = e => { if (e.key === 'Enter') ok(); };
  if (item) s.querySelector('#buyDel').onclick = () => { BUY.items = BUY.items.filter(x => x.id !== item.id); DB.delBuy([item.id]).catch(fail); closeModal(); buyDraw(); buyBadge(); toast('ลบออกจากลิสต์แล้ว'); };
  if (innerWidth >= 900) q.focus();
}
function buyRow(it, info) {
  const r = document.createElement('div'); r.className = 'buyrow' + (it.done ? ' done' : '');
  r.innerHTML = `<input type="checkbox" ${it.done ? 'checked' : ''} aria-label="ซื้อแล้ว"><div class="nm">${esc(info.name)}${it.note ? `<div class="hint">${esc(it.note)}</div>` : ''}</div><b class="bqty">${esc(it.qty || '—')}</b>`;
  r.querySelector('input').onchange = e => { it.done = e.target.checked; DB.saveBuy({ id: it.id, done: it.done }).catch(fail); buyDraw(); buyBadge(); };
  r.querySelector('.nm').onclick = r.querySelector('.bqty').onclick = () => buyAsk(info.p, it.name, it);
  return r;
}
function buyDraw() {
  const open = BUY.items.filter(i => !i.done).map(it => [it, buyInfo(it)]);
  const done = BUY.items.filter(i => i.done).map(it => [it, buyInfo(it)]);
  // supplier filter chips (only suppliers that appear on the list)
  const sups = [...new Set(open.map(([, x]) => x.sup).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th'));
  if (BUY.sup && !sups.includes(BUY.sup)) BUY.sup = '';
  $('bSup').innerHTML = sups.length > 1 ? [['', 'ทุกร้าน'], ...sups.map(x => [x, x])].map(([v, l]) => `<button class="chip" data-v="${esc(v)}" aria-pressed="${BUY.sup === v}">${esc(l)}</button>`).join('') : '';
  $('bSup').querySelectorAll('.chip').forEach(c => c.onclick = () => { BUY.sup = c.dataset.v; buyDraw(); });
  const shown = open.filter(([, x]) => !BUY.sup || x.sup === BUY.sup);
  // group: brand → type (+animal) → name
  const tOrder = t => { const i = TYPES.findIndex(([v]) => v === t); return i < 0 ? 99 : i; };
  shown.sort(([, a], [, b]) => (a.brand === 'ไม่มียี่ห้อ') - (b.brand === 'ไม่มียี่ห้อ') || a.brand.localeCompare(b.brand, 'th') || tOrder(a.type) - tOrder(b.type) || a.name.localeCompare(b.name, 'th'));
  const box = $('bList'); box.innerHTML = '';
  let lastB = null, lastT = null, grp = null;
  for (const [it, x] of shown) {
    if (x.brand !== lastB) {
      grp = document.createElement('div'); grp.className = 'bgrp'; grp.innerHTML = `<h3><span>${esc(x.brand)}</span><button class="bdelall" title="ลบทุกรายการของยี่ห้อนี้">ลบทั้งหมด</button></h3>`; box.appendChild(grp);
      const brand = x.brand; grp.querySelector('.bdelall').onclick = () => {
        const ids = shown.filter(([, y]) => y.brand === brand).map(([i]) => i.id);
        confirmBox(`ลบ ${brand} ทั้งหมด ${ids.length} รายการออกจากของหมด?`, 'ลบ', () => { BUY.items = BUY.items.filter(i => !ids.includes(i.id)); DB.delBuy(ids).catch(fail); buyDraw(); buyBadge(); toast('ลบแล้ว'); });
      };
      lastB = x.brand; lastT = null;
    }
    const tl = typeLabel(x.type);
    if (tl !== lastT) { const h = document.createElement('div'); h.className = 'btype'; h.textContent = tl; grp.appendChild(h); lastT = tl; }
    grp.appendChild(buyRow(it, x));
  }
  $('bEmpty').hidden = shown.length > 0; $('bExp').hidden = !shown.length;
  $('bCount').textContent = open.length ? `${shown.length}${BUY.sup ? '/' + open.length : ''}` : ''; $('bCount').hidden = !open.length;
  $('bDoneBox').hidden = !done.length; $('bDoneCount').textContent = done.length + ' รายการ';
  const db = $('bDone'); db.innerHTML = ''; done.sort(([a], [b]) => a.name.localeCompare(b.name, 'th')).forEach(([it, x]) => db.appendChild(buyRow(it, x)));
}
/* export the list (what's on screen: open items, current shop filter) for ordering — no prices */
function loadLib(src, test) { if (test()) return Promise.resolve(); return new Promise((ok, no) => { const e = document.createElement('script'); e.src = src; e.onload = ok; e.onerror = no; document.head.appendChild(e); }); }
function buyExportRows() {
  const tOrder = t => { const i = TYPES.findIndex(([v]) => v === t); return i < 0 ? 99 : i; };
  return BUY.items.filter(i => !i.done).map(it => [it, buyInfo(it)]).filter(([, x]) => !BUY.sup || x.sup === BUY.sup)
    .sort(([, a], [, b]) => (a.brand === 'ไม่มียี่ห้อ') - (b.brand === 'ไม่มียี่ห้อ') || a.brand.localeCompare(b.brand, 'th') || tOrder(a.type) - tOrder(b.type) || a.name.localeCompare(b.name, 'th'))
    .map(([it, x]) => ({ brand: x.brand, type: typeLabel(x.type), code: it.code || '', name: x.name, qty: it.qty || '', note: it.note || '' }));
}
const expName = ext => `ของหมด${BUY.sup ? '_' + BUY.sup : ''}_${today()}.${ext}`;
$('bXls').onclick = async () => {
  const rows = buyExportRows(); if (!rows.length) return toast('ไม่มีรายการ');
  try { await loadLib('lib/exceljs.min.js', () => window.ExcelJS); } catch (e) { return toast('โหลดตัวสร้าง Excel ไม่ได้'); }
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('ของหมด', { views: [{ state: 'frozen', ySplit: 4 }], pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const F = (o = {}) => ({ name: 'Tahoma', size: 11, ...o }), thin = { style: 'thin', color: { argb: 'FFBFBFBF' } }, box = { top: thin, left: thin, bottom: thin, right: thin };
  ws.columns = [{ width: 7 }, { width: 17 }, { width: 52 }, { width: 9 }, { width: 9 }, { width: 34 }];
  ws.getCell('A1').value = `รายการสั่งของ — ${S.settings.shop}`; ws.getCell('A1').font = F({ size: 16, bold: true });
  ws.getCell('A2').value = `วันที่ ${today()}${BUY.sup ? ' · ร้าน ' + BUY.sup : ''} · ${rows.length} รายการ`; ws.getCell('A2').font = F({ size: 10, color: { argb: 'FF666666' } });
  const hr = ws.getRow(4); hr.values = ['ลำดับ', 'บาร์โค้ด', 'รายการ', 'จำนวน', 'หน่วย', 'หมายเหตุ'];
  hr.eachCell(c => { c.font = F({ bold: true, color: { argb: 'FFFFFFFF' } }); c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F6B3A' } }; c.alignment = { horizontal: 'center', vertical: 'middle' }; c.border = box; });
  ws.pageSetup.printTitlesRow = '4:4';
  let r = 5, last = null, n = 0;
  for (const x of rows) {
    const g = x.brand + ' › ' + x.type;
    if (g !== last) {
      ws.mergeCells(r, 1, r, 6); const c = ws.getCell(r, 1); c.value = g; c.font = F({ bold: true });
      for (let i = 1; i <= 6; i++) { const k = ws.getCell(r, i); k.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCEBDF' } }; k.border = box; }
      r++; last = g;
    }
    const m = String(x.qty).trim().match(/^(\d+(?:\.\d+)?)\s*(.*)$/), qn = m ? +m[1] : x.qty, qu = m ? m[2] : '';
    const row = ws.getRow(r); row.values = [++n, x.code, x.name, qn, qu, x.note];
    row.eachCell({ includeEmpty: true }, (c, i) => { c.font = F(i === 4 ? { bold: true } : {}); c.border = box; c.alignment = { vertical: 'middle', horizontal: [1, 4, 5].includes(i) ? 'center' : 'left', wrapText: i === 3 || i === 6 }; });
    row.getCell(2).numFmt = '@'; r++;
  }
  r++; ws.getCell(r, 3).value = `รวม ${n} รายการ`; ws.getCell(r, 3).font = F({ bold: true });
  const buf = await wb.xlsx.writeBuffer();
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); a.download = expName('xlsx');
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
};
$('bPdf').onclick = async () => {
  const rows = buyExportRows(); if (!rows.length) return toast('ไม่มีรายการ');
  toast('กำลังสร้าง PDF…', 4000);
  try {
    await loadLib('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', () => window.html2canvas);
    await loadLib('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', () => window.jspdf);
  } catch (e) { return toast('โหลดตัวสร้าง PDF ไม่ได้ ต้องต่อเน็ต'); }
  // lay rows out on A4-sized pages (794×1123 px), never splitting a row
  const host = document.createElement('div'); host.className = 'pdfhost'; document.body.appendChild(host);
  const head = `<h1>รายการสั่งของ — ${esc(S.settings.shop)}</h1><div class="psub">วันที่ ${today()}${BUY.sup ? ' · ร้าน ' + esc(BUY.sup) : ''} · ${rows.length} รายการ · ช่องขวาสุดไว้ติ๊กตอนรับของ</div>`;
  const th = '<tr><th>#</th><th>บาร์โค้ด</th><th>รายการ</th><th>จำนวน</th><th>✓</th></tr>';
  const pages = []; let page, tbody, last = null, n = 0;
  const newPage = first => { page = document.createElement('div'); page.className = 'pdfpage'; page.innerHTML = (first ? head : '') + `<table><thead>${th}</thead><tbody></tbody></table>`; host.appendChild(page); tbody = page.querySelector('tbody'); pages.push(page); };
  const add = html => { tbody.insertAdjacentHTML('beforeend', html); const tb = page.querySelector('table'); if (tb.offsetTop + tb.offsetHeight > 1123 - 60 && tbody.rows.length > 1) { const tr = tbody.lastElementChild; tr.remove(); newPage(false); tbody.appendChild(tr); } };
  newPage(true);
  for (const r of rows) {
    const g = r.brand + ' › ' + r.type;
    if (g !== last) { add(`<tr class="pg"><td colspan="5">${esc(g)}</td></tr>`); last = g; }
    add(`<tr><td class="c">${++n}</td><td class="bc">${esc(r.code)}</td><td>${esc(r.name)}${r.note ? `<div class="pn">${esc(r.note)}</div>` : ''}</td><td class="c"><b>${esc(r.qty)}</b></td><td class="ck"></td></tr>`);
  }
  // a group title left alone at the bottom of a page moves to the next page
  for (let i = 0; i < pages.length - 1; i++) { const tb = pages[i].querySelector('tbody'), l = tb.lastElementChild; if (l?.classList.contains('pg')) pages[i + 1].querySelector('tbody').prepend(l); }
  try {
    const pdf = new jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    for (let i = 0; i < pages.length; i++) {
      pages[i].insertAdjacentHTML('beforeend', `<div class="pfoot">${i + 1}/${pages.length}</div>`);
      const cv = await html2canvas(pages[i], { scale: 2, backgroundColor: '#ffffff' });
      if (i) pdf.addPage(); pdf.addImage(cv.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
    }
    pdf.save(expName('pdf'));
  } catch (e) { console.error(e); toast('สร้าง PDF ไม่สำเร็จ'); } finally { host.remove(); }
};
$('bClear').onclick = () => { const ids = BUY.items.filter(i => i.done).map(i => i.id); if (!ids.length) return;
  confirmBox(`ล้างรายการที่ซื้อแล้ว ${ids.length} รายการ?`, 'ล้าง', () => { BUY.items = BUY.items.filter(i => !i.done); DB.delBuy(ids).catch(fail); buyDraw(); }); };

/* ---------- modal helpers ---------- */
function openModal(html, cls = '') {
  const s = document.createElement('div'); s.className = 'scrim'; s.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  s.onclick = e => { if (e.target === s) closeModal(); }; $('modalRoot').replaceChildren(s); return s;
}
function closeModal() { const s = $('modalRoot').firstChild; $('modalRoot').innerHTML = ''; if (s && s.onclose) s.onclose(); focusQ(); }
function confirmBox(text, btn, fn) {
  const s = openModal(`<h2>${esc(text)}</h2><div class="mrow"><button class="ghost" id="cNo">ไม่ใช่</button><button class="primary" id="cYes">${esc(btn)}</button></div>`);
  s.querySelector('#cNo').onclick = closeModal; s.querySelector('#cYes').onclick = () => { closeModal(); fn(); }; s.querySelector('#cYes').focus();
}

/* ---------- PromptPay ---------- */
function crc16(s) { let c = 0xFFFF; for (let i = 0; i < s.length; i++) { c ^= s.charCodeAt(i) << 8; for (let j = 0; j < 8; j++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) : (c << 1); c &= 0xFFFF; } return c.toString(16).toUpperCase().padStart(4, '0'); }
const tlv = (id, v) => id + String(v.length).padStart(2, '0') + v;
function promptpay(id, amount) {
  id = id.replace(/\D/g, ''); let acc;
  if (id.length === 10) acc = tlv('01', '0066' + id.slice(1)); else if (id.length === 13) acc = tlv('02', id); else if (id.length === 15) acc = tlv('03', id); else return null;
  const p = tlv('00', '01') + tlv('01', '12') + tlv('29', tlv('00', 'A000000677010111') + acc) + tlv('58', 'TH') + tlv('53', '764') + tlv('54', amount.toFixed(2)) + '6304';
  return p + crc16(p);
}

/* ---------- payment ---------- */
function openPay(method) {
  if (!T().cart.length) return; const t = totals(); let body = '';
  if (method === 'cash') {
    const q = [t.net, ...[20, 50, 100, 500, 1000].filter(v => v > t.net).slice(0, 3)];
    body = `<div class="field"><label for="recv">รับเงินมา (Enter เปล่า = พอดี)</label><input id="recv" inputmode="decimal" value=""></div>
      <div class="quick">${[...new Set(q)].map(v => `<button data-v="${v}">${v === t.net ? 'พอดี' : fmt0(v)}</button>`).join('')}</div>
      <div class="change short" id="chg"><span>เงินทอน</span><b>−</b></div>`;
  } else if (method === 'transfer') {
    const payload = S.settings.pp ? promptpay(S.settings.pp, t.net) : null;
    body = payload ? `<div id="qr"></div><p class="hint" style="text-align:center">ให้ลูกค้าสแกนจ่าย ${fmt(t.net)} บาท เข้าพร้อมเพย์ ${esc(S.settings.pp)} แล้วเช็คยอดในแอปธนาคารก่อนกดยืนยัน</p>`
      : `<p class="notice" style="margin:12px 0 0">ยังไม่ได้ตั้งเบอร์พร้อมเพย์ ไปตั้งได้ที่แท็บ "บิลวันนี้" ตอนนี้ยืนยันรับโอนได้เลยโดยไม่มี QR</p>`;
  } else body = `<p>ลูกค้าจ่ายผ่านแอปเป๋าตัง ร้านได้รับเต็มจำนวน ${fmt(t.net)} บาท ตรวจยอดในแอปถุงเงินก่อนกดยืนยัน</p>`;
  const s = openModal(`<h2>${METHOD[method]}${S.tabs.length > 1 ? ' · บิล ' + (S.cur + 1) : ''}</h2><div class="hint">ยอดที่ต้องชำระ</div><div class="due">${fmt(t.net)}</div>${body}
    <div class="mrow"><button class="ghost" id="pCancel">กลับไปแก้บิล</button><button class="primary" id="pOk">ยืนยันรับเงิน (Enter)</button></div>`);
  const ok = s.querySelector('#pOk');
  if (method === 'cash') {
    const r = s.querySelector('#recv'), chg = s.querySelector('#chg');
    const upd = () => {
      const v = parseFloat(r.value); const c = isNaN(v) ? NaN : v - t.net;
      chg.className = 'change' + ((isNaN(c) || c < 0) ? ' short' : ''); chg.querySelector('b').textContent = isNaN(c) ? '−' : (c < 0 ? 'ขาด ' + fmt(-c) : fmt(c)); ok.disabled = isNaN(c) || c < 0;
    };
    r.oninput = upd; s.querySelectorAll('.quick button').forEach(b => b.onclick = () => { r.value = b.dataset.v; upd(); ok.focus(); });
    r.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); if (r.value === '') { r.value = t.net; upd(); } if (!ok.disabled) ok.click(); } };
    upd(); r.focus();
  } else {
    if (method === 'transfer' && S.settings.pp && window.QRCode) { const pl = promptpay(S.settings.pp, t.net); if (pl) new QRCode(s.querySelector('#qr'), { text: pl, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M }); }
    ok.focus();
  }
  s.querySelector('#pCancel').onclick = closeModal;
  ok.onclick = () => { ok.disabled = true; const recv = method === 'cash' ? parseFloat(s.querySelector('#recv').value) : t.net; finish(method, recv); };
}
document.querySelectorAll('.pay').forEach(b => b.onclick = () => openPay(b.dataset.m));
function newBillId() {
  const d = new Date(); const r = Math.random().toString(36).slice(2, 4).toUpperCase();
  return String(d.getFullYear()).slice(2) + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '-' + r;
}
function finish(method, recv) {
  const t = totals(); const d = new Date();
  const items = T().cart.map(i => { const p = P.get(i.code); return { code: i.code, name: i.name, unit: i.unit || '', price: i.price, qty: i.qty, ld: lineDisc(i), cost: p?.cost || 0, known: !!p, custom: !!i.custom }; });
  const bill = { id: newBillId(), date: today(), time: pad(d.getHours()) + ':' + pad(d.getMinutes()), ts: d.getTime(), seller: S.seller, method, items, sub: t.sub, ldisc: t.ldisc, disc: t.disc, net: t.net, recv, change: Math.round((recv - t.net) * 100) / 100, count: t.count, cancelled: false, email: S.user?.email || '' };
  DB.saveSale(bill).catch(fail);
  closeCurrentTab(); showReceipt(bill, true);
}
function receiptHTML(b) {
  const [y, m, d] = b.date.split('-'); const when = `${d}/${m}/${+y + 543} ${b.time}`;
  const money = n => fmt0(Math.round(n * 100) / 100);
  return `<div class="receipt"><div class="c"><b class="shop">${esc(S.settings.shop)}</b><br>ใบเสร็จรับเงิน</div><hr>
  <div>วันที่ ${when}</div><div class="small">เลขที่ ${esc(b.id)}</div><hr>
  ${b.items.map(i => `<div>${esc(i.name)}</div><div class="l"><span>&nbsp;${i.qty} x ${money(i.price)}</span><span>${money(i.qty * i.price)}</span></div>${i.ld ? `<div class="l"><span>&nbsp;ส่วนลด</span><span>-${money(i.ld)}</span></div>` : ''}`).join('')}<hr>
  <div class="l"><span>รวม ${b.count} ชิ้น</span><span>${money(b.sub - (b.ldisc || 0))}</span></div>
  ${b.disc ? `<div class="l"><span>ส่วนลดท้ายบิล</span><span>-${money(b.disc)}</span></div>` : ''}
  <div class="l big"><b>สุทธิ</b><b>${money(b.net)}</b></div>
  <div class="l"><span>${METHOD[b.method]}</span><span>${money(b.recv)}</span></div>
  ${b.method === 'cash' ? `<div class="l"><span>เงินทอน</span><span>${money(b.change)}</span></div>` : ''}<hr><div class="c">ขอบคุณที่อุดหนุนค่ะ</div></div>`;
}
function showReceipt(b, fresh) {
  const s = openModal(`<h2>${fresh ? (b.method === 'cash' ? 'ทอน ' + fmt(b.change) + ' บาท' : 'รับเงินแล้ว') : 'ใบเสร็จ ' + esc(b.id)}</h2>${receiptHTML(b)}
    <div class="mrow">${fresh ? '' : '<button class="ghost" id="rCopy">คัดลอกเป็นบิลใหม่</button>'}<button class="ghost" id="rPrint">พิมพ์ใบเสร็จ <kbd>F9</kbd></button><button class="primary" id="rOk">${fresh ? (S.tabs.length > 1 || T().cart.length ? 'กลับไปบิลที่ค้างอยู่ (Enter)' : 'บิลถัดไป (Enter)') : 'ปิด'}</button></div>`);
  s.querySelector('#rPrint').onclick = () => { printReceipt(b); if (fresh) closeModal(); };
  s.onkeydown = e => { if (e.key === 'F9') { e.preventDefault(); s.querySelector('#rPrint').click(); } };
  s.querySelector('#rCopy')?.addEventListener('click', () => copyBill(b));
  const ok = s.querySelector('#rOk'); ok.onclick = closeModal; ok.focus();
}
/* Thermal receipt: 58 mm paper, about 48 mm printable */
function printReceipt(b) {
  const fontUrl = new URL('fonts/GoogleSans.woff2', location.href).href;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face{font-family:"Google Sans";src:url(${fontUrl}) format("woff2");font-weight:400 700}
    html,body{margin:0;padding:0;background:#fff;color:#000}
    /* 58 mm paper prints about 48 mm; keep 3 mm spare on the right so nothing is cut */
    @page{margin:0}
    .receipt{width:41mm;margin:0;padding:1mm 0 5mm;font-family:"Google Sans",sans-serif;font-size:12px;line-height:1.4;font-weight:600;color:#000}
    .c{text-align:center}.l{display:flex;justify-content:space-between;gap:4px}.l span:last-child,.l b:last-child{white-space:nowrap;font-variant-numeric:tabular-nums}
    .shop{font-size:14px}.small{font-size:10px}.big{font-size:14px}
    hr{border:0;border-top:1px dashed #000;margin:4px 0} b{font-weight:700}
  </style></head><body>${receiptHTML(b)}</body></html>`;
  const f = document.createElement('iframe'); f.className = 'printframe'; document.body.appendChild(f);
  const d = f.contentDocument; d.open(); d.write(html); d.close();
  const go = () => {
    // page exactly as long as the receipt (an "auto" length makes Chrome show a blank, endless strip)
    try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast('สั่งพิมพ์ไม่ได้'); } setTimeout(() => f.remove(), 60000);
  };
  (d.fonts?.ready || Promise.resolve()).then(() => setTimeout(go, 50));
}

/* ---------- bills tab ---------- */
function renderBills() {
  const list = S.bills.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)), live = list.filter(b => !b.cancelled);
  const sum = f => live.filter(f).reduce((s, b) => s + b.net, 0);
  $('kpis').innerHTML = [['ยอดขายวันนี้', sum(() => true)], ['เงินสดเข้าลิ้นชัก', sum(b => b.method === 'cash')], ['โอน', sum(b => b.method === 'transfer')], ['คนละครึ่ง', sum(b => b.method === 'half')], ['จำนวนบิล', live.length, true]]
    .map(([k, v, i]) => `<div class="card kpi"><div class="k">${k}</div><div class="v">${i ? v : fmt0(v)}</div></div>`).join('');
  const tb = $('billRows'); tb.innerHTML = '';
  list.forEach(b => {
    const tr = document.createElement('tr'); if (b.cancelled) tr.className = 'cancel';
    tr.innerHTML = `<td class="num">${b.time}${b.pending ? ' <span class="hint">รอซิงก์</span>' : ''}</td><td class="num">${esc(b.id)}</td><td><span class="pill">${METHOD[b.method]}</span></td><td class="r num">${b.count}</td><td class="r num">${fmt(b.net)}</td>
      <td style="white-space:nowrap"><button class="ghost" data-a="v">ดู</button> ${b.cancelled ? '<span class="pill x">ยกเลิกแล้ว</span>' : '<button class="ghost bad" data-a="x">ยกเลิก</button>'}</td>`;
    tr.querySelector('[data-a="v"]').onclick = () => showReceipt(b, false);
    const x = tr.querySelector('[data-a="x"]'); if (x) x.onclick = () => confirmBox(`ยกเลิกบิล ${b.id} ยอด ${fmt(b.net)} บาท?`, 'ยกเลิกบิล', () => { DB.cancelSale(b).catch(fail); toast('ยกเลิกบิลแล้ว สต็อกคืนให้แล้ว'); });
    tb.appendChild(tr);
  });
  $('emptyBills').hidden = list.length > 0;
  const pr = $('priceRows'); pr.innerHTML = '';
  S.priceLog.forEach(l => {
    const d = l.new - l.old, tr = document.createElement('tr'); const at = l.at?.toDate ? l.at.toDate() : new Date();
    tr.innerHTML = `<td class="num">${at.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })} ${pad(at.getHours())}:${pad(at.getMinutes())}</td><td>${esc(l.name)}${l.kind === 'cost' ? ' <span class="hint">(ต้นทุน)</span>' : ''}</td><td class="r num">${fmt0(l.old)}</td><td class="r num">${fmt0(l.new)}</td><td class="r num" style="color:${d > 0 ? 'var(--bad)' : 'var(--accent)'}">${d > 0 ? '+' : ''}${fmt0(d)}</td>`;
    pr.appendChild(tr);
  });
  $('emptyPrices').hidden = S.priceLog.length > 0;
}
function tab(w) {
  for (const [vid, bid, name] of [['viewSell', 'tabSell', 'sell'], ['viewProd', 'tabProd', 'prod'], ['viewBuy', 'tabBuy', 'buy'], ['viewBills', 'tabBills', 'bills'], ['viewReport', 'tabReport', 'report']]) { $(vid).hidden = w !== name; $(bid).setAttribute('aria-selected', w === name); }
  if (typeof SC !== 'undefined' && SC.camOn) camStop();
  if (w === 'bills') renderBills(); else if (w === 'prod') prodOpen(); else if (w === 'buy') buyOpen(); else if (w === 'report') loadReport(); else focusQ();
}
$('tabSell').onclick = () => tab('sell'); $('tabProd').onclick = () => tab('prod'); $('tabBuy').onclick = () => tab('buy'); $('tabBills').onclick = () => tab('bills'); $('tabReport').onclick = () => tab('report');

/* ---------- settings ---------- */
function fillSettings() {
  $('setShop').value = S.settings.shop; $('setPP').value = S.settings.pp || ''; $('setSups').value = (S.settings.suppliers || []).join(', ');
  $('setStaff').value = S.staff.join(', ');
}
const splitList = v => v.split(',').map(s => s.trim()).filter(Boolean);
function saveSet() {
  const s = { ...S.settings, shop: $('setShop').value.trim() || 'หนองเป็ดเพ็ทชอป', pp: $('setPP').value.trim(), suppliers: splitList($('setSups').value) };
  S.settings = s; store.set('settingsCache', s); DB.saveMeta('settings', s).catch(fail); renderSellers();
}
['setShop', 'setPP', 'setSups'].forEach(id => $(id).onchange = () => { saveSet(); pfDrawChips(); toast('บันทึกแล้ว'); });
$('setStaff').onchange = e => { const emails = splitList(e.target.value).map(x => x.toLowerCase()); DB.saveMeta('staff', { emails }).then(() => toast('บันทึกรายชื่อแล้ว')).catch(fail); };
$('logoutBtn').onclick = () => confirmBox('ออกจากระบบเครื่องนี้?', 'ออกจากระบบ', () => DB.logout());

/* ---------- product page: form on top (add / edit / save / delete / cancel / print label), product table below ---------- */
const PTYPES = TYPES.filter(([v]) => v && v !== 'big');
const PANIMALS = ANIMALS.filter(([v]) => v);
const SIZEU = ['g', 'kg', 'ml', 'L', 'ชิ้น'];
const UNITS = ['ถุง', 'กระสอบ', 'ซอง', 'กระป๋อง', 'ถาด', 'ชิ้น', 'ขวด', 'แพ็ค', 'กล่อง', 'อัน', 'กระปุก'];
// mode: empty (nothing chosen) · view (row chosen, read-only) · edit (changing a product) · new (adding one)
const PF = { code: '', mode: 'empty', nameAuto: true };
const supList = () => S.settings.suppliers || [];
function brandIndex(v) { const n = norm(v); if (!n) return -1; return BRANDS.findIndex(b => norm(b[0]) === n || (b[1] && norm(b[1]) === n) || (b[3] || []).some(a => norm(a) === n)); }
const opt = (v, l, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(l)}</option>`;
function fillSelect(id, list, value, blank) {
  const items = list.map(x => Array.isArray(x) ? x : [x, x]);
  if (value && !items.some(([v]) => v === value)) items.push([value, value]);
  $(id).innerHTML = (blank ? opt('', blank, !value) : '') + items.map(([v, l]) => opt(v, l, v === value)).join('');
}
function pfDrawChips(vals = {}) {
  const cur = id => vals[id] ?? $(id).value;
  fillSelect('pfSizeU', SIZEU, cur('pfSizeU') || 'g');
  fillSelect('pfUnit', UNITS, cur('pfUnit'), '— เลือก —');
  fillSelect('pfAnimal', PANIMALS, cur('pfAnimal'), '— ไม่ระบุ —');
  fillSelect('pfType', PTYPES, cur('pfType'), '— ไม่ระบุ —');
  fillSelect('pfSup', supList(), cur('pfSup'), '— ไม่ระบุ —');
  $('pfSup').insertAdjacentHTML('beforeend', opt('__new', '+ เพิ่มร้านใหม่…') + opt('__edit', '✎ แก้ไขรายชื่อร้าน…'));
}
function addSupplier(name) {
  name = name.trim(); if (!name) return;
  if (!supList().includes(name)) { S.settings.suppliers = [...supList(), name]; store.set('settingsCache', S.settings); DB.saveMeta('settings', { suppliers: S.settings.suppliers }).catch(fail); $('setSups').value = S.settings.suppliers.join(', '); }
}
function askNewSupplier(done) {
  const s = openModal(`<h2>เพิ่มร้านที่รับของ</h2><input class="tin" id="newSup" placeholder="ชื่อร้าน"><div class="mrow"><button class="ghost" id="nsNo">ยกเลิก</button><button class="primary" id="nsOk">เพิ่ม</button></div>`);
  const inp = s.querySelector('#newSup'); inp.focus();
  const ok = () => { const v = inp.value.trim(); closeModal(); if (v) { addSupplier(v); done(v); } else done(''); };
  s.querySelector('#nsNo').onclick = () => { closeModal(); done(''); }; s.querySelector('#nsOk').onclick = ok; inp.onkeydown = e => { if (e.key === 'Enter') ok(); };
}
$('pfSup').dataset.prev = '';
$('pfSup').addEventListener('focus', () => { $('pfSup').dataset.prev = $('pfSup').value; });
$('pfSup').onchange = () => {
  const v = $('pfSup').value, prev = $('pfSup').dataset.prev || '';
  if (v === '__new') askNewSupplier(n => pfDrawChips({ pfSup: n || prev }));
  else if (v === '__edit') { pfDrawChips({ pfSup: prev }); manageSuppliers(); }
  else $('pfSup').dataset.prev = v;
};
// edit the supplier list: rename (products follow the new name), remove, add
function manageSuppliers() {
  const orig = supList().slice();
  const s = openModal(`<h2>รายชื่อร้านที่รับของ</h2><p class="hint" style="margin:0">แก้ชื่อในช่องได้เลย · กด ลบ เพื่อเอาออกจากรายการ</p>
    <div id="supRows" class="suprows"></div>
    <div class="suprow"><input class="tin" id="supNew" placeholder="เพิ่มร้านใหม่"><button class="ghost" id="supAdd">+ เพิ่ม</button></div>
    <div class="mrow"><button class="ghost" id="supNo">ยกเลิก</button><button class="primary" id="supOk">บันทึก</button></div>`);
  const rows = orig.map(n => ({ old: n, name: n, del: false }));
  const draw = () => {
    const box = s.querySelector('#supRows'); box.innerHTML = '';
    rows.forEach(r => {
      if (r.del) return;
      const used = r.old ? LIST.filter(p => p.supplier === r.old || p.sp?.[r.old]).length : 0;
      const d = document.createElement('div'); d.className = 'suprow';
      d.innerHTML = `<input class="tin" value="${esc(r.name)}"><span class="hint">${used ? used + ' สินค้า' : ''}</span><button class="ghost bad">ลบ</button>`;
      d.querySelector('input').oninput = e => { r.name = e.target.value; };
      d.querySelector('button').onclick = () => { r.del = true; draw(); };
      box.appendChild(d);
    });
  };
  draw();
  const add = () => { const v = s.querySelector('#supNew').value.trim(); if (!v) return; rows.push({ old: '', name: v, del: false }); s.querySelector('#supNew').value = ''; draw(); };
  s.querySelector('#supAdd').onclick = add; s.querySelector('#supNew').onkeydown = e => { if (e.key === 'Enter') add(); };
  s.querySelector('#supNo').onclick = closeModal;
  s.querySelector('#supOk').onclick = () => {
    const keep = rows.filter(r => !r.del && r.name.trim()), names = [];
    for (const r of keep) { const n = r.name.trim(); if (!names.includes(n)) names.push(n); }
    let moved = 0;
    for (const r of keep) {
      const n = r.name.trim(); if (!r.old || r.old === n) continue;
      const hit = LIST.filter(p => p.supplier === r.old || p.sp?.[r.old]);
      DB.renameSupplier(r.old, n, hit.map(p => ({ code: p.code, s: p.supplier === r.old, sp: p.sp?.[r.old] }))).catch(fail);
      for (const p of hit) { if (p.supplier === r.old) p.supplier = n; if (p.sp?.[r.old]) { p.sp = { ...p.sp, [n]: p.sp[r.old] }; delete p.sp[r.old]; } }
      moved += hit.length;
    }
    S.settings.suppliers = names; store.set('settingsCache', S.settings); DB.saveMeta('settings', { suppliers: names }).catch(fail); $('setSups').value = names.join(', ');
    closeModal(); pfDrawChips(); if (PF.code && P.get(PF.code)) pfShowInfo(P.get(PF.code));
    toast('บันทึกรายชื่อร้านแล้ว' + (moved ? ` (เปลี่ยนชื่อในสินค้า ${moved} รายการ)` : ''));
  };
}
function pfName() {
  const bi = brandIndex($('pfBrand').value); const b = bi >= 0 ? BRANDS[bi][0] : $('pfBrand').value.trim();
  const isNew = !!($('pfBrand').value.trim() && bi < 0);
  const [, en, , al] = bi >= 0 ? BRANDS[bi] : [];
  $('pfBrandMsg').textContent = isNew ? 'ยี่ห้อใหม่ จะเพิ่มให้ตอนบันทึก' : bi >= 0 ? [en && 'อังกฤษ: ' + en, al?.length && 'ค้นได้ด้วย: ' + al.slice(0, 4).join(', ')].filter(Boolean).join(' · ') : ''; $('pfBrandEn').hidden = !isNew;
  const size = $('pfSize').value.trim();
  if (PF.nameAuto && (PF.mode === 'new' || PF.mode === 'edit')) $('pfName').value = [b, $('pfVariant').value.trim(), size ? size + $('pfSizeU').value : ''].filter(Boolean).join(' ');
  $('pfAuto').hidden = PF.nameAuto || !(PF.mode === 'new' || PF.mode === 'edit');
  const pr = parseFloat($('pfPrice').value), co = parseFloat($('pfCost').value);
  $('pfMargin').textContent = pr > 0 && co > 0 ? `กำไรต่อหน่วย ${fmt0(pr - co)} บาท (${Math.round((pr - co) / pr * 100)}%)` : '';
}
function eanCheck(d12) { let s = 0; for (let i = 0; i < 12; i++) s += (+d12[i]) * (i % 2 ? 3 : 1); return (10 - s % 10) % 10; }
function randomCode() { for (; ;) { let d = '20'; for (let i = 0; i < 10; i++) d += Math.floor(Math.random() * 10); d += eanCheck(d); if (!P.has(d)) return d; } }

function pfSetMode(mode) {
  PF.mode = mode;
  $('pfFields').disabled = !(mode === 'edit' || mode === 'new');
  $('pfFields').hidden = mode === 'empty'; $('pfEmpty').hidden = mode !== 'empty';
  $('pfCode').readOnly = mode === 'edit';
  $('pfGen').hidden = mode !== 'new'; $('pfCam').hidden = mode !== 'new';
  const has = !!(PF.code && P.has(PF.code));
  $('pbAdd').disabled = mode === 'edit';
  $('pbEdit').disabled = mode !== 'view';
  $('pbSave').disabled = !(mode === 'edit' || mode === 'new'); $('pfBottom').hidden = $('pbSave').disabled;
  $('pbDel').disabled = !(has && (mode === 'view' || mode === 'edit'));
  $('pbCancel').disabled = !(mode === 'edit' || mode === 'new');
  $('pbLabel').disabled = !($('pfCode').value.trim()); $('pbBuy').disabled = !(has && mode === 'view');
  $('pfSizeU').style.visibility = (mode === 'view' && !$('pfSize').value) ? 'hidden' : '';
  $('pfTitle').textContent = { empty: 'ข้อมูลสินค้า', view: 'ข้อมูลสินค้า', edit: 'แก้ไขสินค้า', new: 'เพิ่มสินค้าใหม่' }[mode];
  $('pfState').textContent = { empty: 'เลือกสินค้าจากตาราง หรือกด เพิ่ม', view: 'กด แก้ไข เพื่อเปลี่ยนข้อมูล', edit: 'แก้แล้วกด บันทึก', new: 'ยิงบาร์โค้ด แล้วกรอกข้อมูล' }[mode];
  $('pfState').className = 'pstate ' + mode;
  $('pfAuto').hidden = PF.nameAuto || !(mode === 'new' || mode === 'edit');
  if (mode !== 'view') $('pfInfo').hidden = true;
}
function pfFill(p) {
  $('pfCode').value = p?.code || ''; $('pfName').value = p?.name || '';
  $('pfBrand').value = p && p.brand >= 0 && BRANDS[p.brand] ? BRANDS[p.brand][0] : ''; $('pfVariant').value = ''; $('pfSize').value = '';
  $('pfPrice').value = p?.price ?? ''; $('pfCost').value = p?.cost || ''; $('pfQty').value = p?.stock ?? '';
  pfDrawChips({ pfUnit: p?.unit || '', pfAnimal: p?.animal || '', pfType: p?.type && p.type !== 'other' ? p.type : '', pfSup: p?.supplier || '', pfSizeU: 'g' });
  $('pfCodeMsg').textContent = ''; $('pfErr').hidden = true; pfName();
}
function pfLoad(code) {   // show a product read-only
  const p = P.get(code); if (!p) return;
  PF.code = code; PF.nameAuto = false; pfFill(p); pfSetMode('view'); pfShowInfo(p); markRow(code);
}
function pfClear(keep) {  // start a new product
  const kept = keep ? { brand: $('pfBrand').value, size: $('pfSize').value, price: $('pfPrice').value, cost: $('pfCost').value,
    pfUnit: $('pfUnit').value, pfAnimal: $('pfAnimal').value, pfType: $('pfType').value, pfSup: $('pfSup').value, pfSizeU: $('pfSizeU').value } : null;
  PF.code = ''; PF.nameAuto = true; pfFill(null);
  if (kept) { $('pfBrand').value = kept.brand; $('pfSize').value = kept.size; $('pfPrice').value = kept.price; $('pfCost').value = kept.cost; pfDrawChips(kept); }
  pfSetMode('new'); markRow(''); pfName(); $('pfGenBox').hidden = true; $('pfCode').focus();
}
function pfCheckCode() {
  if (PF.mode !== 'new') return;
  const c = fixCode($('pfCode').value.trim()); if (!c) return; $('pfCode').value = c;
  if (P.has(c)) { toast('มีสินค้านี้อยู่แล้ว เปิดข้อมูลให้'); pfLoad(c); return; }
  PF.code = c; $('pfCodeMsg').className = 'hint msg-ok'; $('pfCodeMsg').textContent = 'รหัสใหม่ เพิ่มเป็นสินค้าใหม่ได้'; $('pbLabel').disabled = false; $('pfBrand').focus();
}
function pfSave() {
  if (PF.mode === 'new') pfCheckCode(); if (PF.mode === 'view') return;
  if (!$('pfName').value.trim()) { PF.nameAuto = true; pfName(); }
  const code = $('pfCode').value.trim(), name = $('pfName').value.trim(), price = parseFloat($('pfPrice').value);
  const errs = []; if (!code) errs.push('ยังไม่มีบาร์โค้ด (ยิง หรือกด "เพิ่มรหัสสินค้า")'); if (!name) errs.push('ยังไม่มีชื่อสินค้า'); if (!(price >= 0)) errs.push('ยังไม่ได้ใส่ราคาขาย'); else if (price > 99999) errs.push('ราคาขายเกิน 99,999 บาท ตรวจอีกที');
  if (name && !/[^\d\s.,-]/.test(name)) errs.push('ชื่อสินค้าเป็นตัวเลขอย่างเดียว ใส่ชื่อจริงก่อน');
  if (errs.length) { $('pfErr').textContent = errs.join(' · '); $('pfErr').hidden = false; return; }
  let bi = brandIndex($('pfBrand').value); const bv = $('pfBrand').value.trim();
  if (bi < 0 && !bv) bi = brandFromName(name);
  if (bi < 0 && bv) { const en = $('pfBrandEn').value.trim(); BRANDS.push([bv, en, 0, []]); bi = BRANDS.length - 1; DB.addBrand(bv, en).catch(fail); pfBrandList(); $('pfBrandEn').value = ''; }
  const size = parseFloat($('pfSize').value), su = $('pfSizeU').value; const kg = su === 'kg' ? size : (su === 'g' ? size / 1000 : 0);
  const cost = parseFloat($('pfCost').value), qty = parseInt($('pfQty').value), unit = $('pfUnit').value, sup = $('pfSup').value === '__new' ? '' : $('pfSup').value;
  const old = P.get(code), old_stock = old?.stock;
  const p = { ...(old || {}), code, name, price, unit, brand: bi, type: $('pfType').value || 'other', animal: $('pfAnimal').value, big: (unit === 'กระสอบ' || kg >= 5 || old?.big) ? 1 : 0,
    cost: cost >= 0 ? cost : (old?.cost || 0), supplier: sup, rank: old?.rank || 0, stock: isNaN(qty) ? old?.stock : qty };
  const by = { by: S.seller, email: S.user?.email || '' };
  if (old && old.price !== price) DB.logPrice({ code, name, kind: 'price', old: old.price, new: price, ...by }).catch(() => { });
  if (old && cost >= 0 && (old.cost || 0) !== cost) DB.logPrice({ code, name, kind: 'cost', old: old.cost || 0, new: cost, supplier: sup, ...by }).catch(() => { });
  p.key = mkKey(p); if (old) Object.assign(old, p); else { P.set(code, p); LIST.push(p); }
  for (const t of S.tabs) for (const i of t.cart) if (i.code === code && !i.custom) { i.price = price; i.name = name; }
  DB.saveProduct(p).catch(fail);
  if (old && !isNaN(qty) && qty !== old_stock) DB.setStock(code, name, old_stock ?? null, qty, S.user?.email || '').catch(() => { });
  if (sup && cost > 0) { p.sp = { ...(old?.sp || {}), [sup]: { c: cost, d: today() } }; if (old) old.sp = p.sp; DB.patchProduct(code, { sp: { [sup]: { c: cost, d: today() } } }).catch(() => { }); }
  S.recent = [{ code, isNew: !old, at: new Date().toISOString() }, ...S.recent.filter(r => r.code !== code)].slice(0, 50); store.set('recent', S.recent);
  toast(old ? 'บันทึกการแก้ไขแล้ว' : 'เพิ่มสินค้าแล้ว');
  if (!old && $('pfNext').checked) { pfClear(true); drawPList(); return; }
  drawPList(); pfLoad(code);
}
function pfDelete() {
  const p = P.get(PF.code); if (!p) return;
  confirmBox(`ลบสินค้า "${p.name}" ออกจากระบบ?`, 'ลบสินค้า', () => {
    DB.deleteProduct(p.code).catch(fail);
    P.delete(p.code); LIST = LIST.filter(x => x.code !== p.code); S.recent = S.recent.filter(r => r.code !== p.code); store.set('recent', S.recent);
    PF.code = ''; pfFill(null); pfSetMode('empty'); drawPList(); toast('ลบสินค้าแล้ว');
  });
}
function pfCancel() { if (PF.code && P.has(PF.code)) pfLoad(PF.code); else { PF.code = ''; pfFill(null); pfSetMode('empty'); } }
async function pfShowInfo(p) {
  const list = Object.entries(p.sp || {}).map(([n, v]) => ({ n, c: v.c, d: v.d })).sort((a, b) => a.c - b.c);
  const sup = list.length ? list.map((x, i) => `<span class="suptag${i === 0 && list.length > 1 ? ' best' : ''}">${esc(x.n)} ${fmt0(x.c)}฿${i === 0 && list.length > 1 ? ' · ถูกสุด' : ''}</span>`).join('') : '<span class="hint">ยังไม่มีต้นทุนแยกร้าน (เริ่มมีเมื่อรับของเข้า)</span>';
  $('pfInfo').innerHTML = `<div><b>ต้นทุนแต่ละร้าน</b> ${sup}</div><div><b>ประวัติราคา</b> <span id="pfHist" class="hint">กำลังโหลด…</span></div>`; $('pfInfo').hidden = false;
  try {
    const h = await DB.priceHistory(p.code); if (PF.code !== p.code || !$('pfHist')) return;
    $('pfHist').innerHTML = h.length ? h.slice(0, 6).map(x => { const at = x.at?.toDate ? x.at.toDate() : null; const d = x.new - x.old;
      return `<span class="histtag">${at ? at.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : ''} ${x.kind === 'cost' ? 'ทุน' : 'ขาย'} ${fmt0(x.old)}→${fmt0(x.new)} <span class="${d > 0 ? 'down' : 'up'}">${d > 0 ? '+' : ''}${fmt0(d)}</span></span>`; }).join('') : 'ยังไม่เคยเปลี่ยนราคาในระบบใหม่';
  } catch (e) { if ($('pfHist')) $('pfHist').textContent = 'โหลดไม่ได้'; }
}
function pfBrandList() { }
// brand box: suggestions drop down while typing; pick one and the Thai brand name is filled in
function pfBrandSug() {
  const v = $('pfBrand').value.trim(), box = $('pfBrandSug');
  const list = v && !BRANDS.some(b => b[0] === v) ? brandSuggest(v) : [];
  drawBrandSug(box, list, i => { if (i >= 0) $('pfBrand').value = BRANDS[i][0]; box.hidden = true; pfName(); $('pfVariant').focus(); }, -1);
}
$('pfBrand').addEventListener('input', pfBrandSug);
$('pfBrand').addEventListener('focus', pfBrandSug);
$('pfBrand').addEventListener('blur', () => setTimeout(() => { $('pfBrandSug').hidden = true; }, 200));
$('pfCode').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); pfCheckCode(); } });
$('pfCode').addEventListener('change', pfCheckCode);
$('pfGen').onclick = () => { $('pfGenBox').hidden = !$('pfGenBox').hidden; };
$('pfRand').onclick = () => { $('pfCode').value = randomCode(); $('pfGenBox').hidden = true; pfCheckCode(); $('pfCodeMsg').textContent += ' (กด พิมพ์บาร์โค้ด แล้วติดที่สินค้า)'; };
$('pfOwn').onclick = () => { $('pfGenBox').hidden = true; $('pfCode').value = ''; $('pfCode').placeholder = 'พิมพ์รหัสที่ต้องการ แล้วกด Enter'; $('pfCode').focus(); };
['pfBrand', 'pfVariant', 'pfSize', 'pfPrice', 'pfCost'].forEach(id => $(id).addEventListener('input', pfName));
$('pfSizeU').addEventListener('change', pfName);
$('pfName').addEventListener('input', () => { PF.nameAuto = !$('pfName').value.trim(); $('pfAuto').hidden = PF.nameAuto || !(PF.mode === 'new' || PF.mode === 'edit'); });
$('pfAuto').onclick = () => { PF.nameAuto = true; pfName(); };
$('pfPrice').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); pfSave(); } });
$('pbAdd').onclick = () => pfClear(false); $('pfEmptyAdd').onclick = () => pfClear(false);
$('pbEdit').onclick = () => { if (PF.mode !== 'view') return; pfSetMode('edit'); $('pfPrice').focus(); $('pfPrice').select(); };
$('pbSave').onclick = pfSave; $('pbDel').onclick = pfDelete; $('pbCancel').onclick = pfCancel;
$('pbBuy').onclick = () => { const p = P.get(PF.code); if (p) buyAsk(p); };
$('pbSave2').onclick = pfSave; $('pbCancel2').onclick = pfCancel;
$('pbLabel').onclick = () => { const code = $('pfCode').value.trim(); if (!code) return; openLabel(P.get(code) || { code, name: $('pfName').value.trim(), price: parseFloat($('pfPrice').value) || 0 }); };
function prodOpen() { drawPChips(); drawPList(); if (PF.mode === 'empty') $('pSearch').focus(); }
function editProduct(code) { closeModal(); tab('prod'); pMode('info'); pfLoad(code); $('pbEdit').click(); }

/* ---------- product table ---------- */
const PL = { sel: 0, rows: [], brand: -1, type: '', animal: '' };
// animal / type chips under the product search (same choices as the sell-screen finder)
function drawPChips() {
  for (const [id, list, key] of [['pAnimal', ANIMALS, 'animal'], ['pType', TYPES, 'type']]) {
    $(id).innerHTML = list.map(([v, l]) => `<button class="chip" data-v="${v}" aria-pressed="${PL[key] === v}">${l}</button>`).join('');
    $(id).querySelectorAll('.chip').forEach(c => c.onclick = () => { PL[key] = c.dataset.v; drawPChips(); drawPList(); });
  }
}
function pFilter() {
  const v = fixCode($('pSearch').value.trim()), sort = $('pSort').value;
  let r;
  const base = PL.brand >= 0 ? LIST.filter(p => p.brand === PL.brand) : LIST;
  if (sort === 'recent' && !v) r = S.recent.map(x => P.get(x.code)).filter(p => p && (PL.brand < 0 || p.brand === PL.brand));
  else if (/^\d{3,}$/.test(v)) r = findByDigits(v);
  else if (v.length) { const words = v.toLowerCase().split(/\s+/).filter(Boolean).map(norm); r = wordMatch(base, words); }
  else r = base.slice();
  if (PL.type) r = r.filter(p => PL.type === 'big' ? p.big : p.type === PL.type);
  if (PL.animal) r = r.filter(p => p.animal === PL.animal);
  if (sort === 'low') r = r.filter(p => p.rank > 0 && p.price > 0 && (!p.cost || (p.price - p.cost) / p.price < 0.10));
  if (sort === 'name') r.sort((a, b) => a.name.localeCompare(b.name, 'th'));
  else if (sort !== 'recent' || v) r.sort((a, b) => b.rank - a.rank);
  return r;
}
function drawPSug() {
  const v = $('pSearch').value.trim();
  drawBrandSug($('pBrandSug'), v && !/^\d+$/.test(fixCode(v)) ? brandSuggest(v, 6) : [], i => { PL.brand = i; if (i >= 0) $('pSearch').value = ''; drawPSug(); drawPList(); $('pSearch').focus(); }, PL.brand);
}
function drawPList() {
  PL.rows = pFilter(); const shown = PL.rows.slice(0, 300); const tb = $('pRows'); tb.innerHTML = '';
  for (const p of shown) {
    const tr = document.createElement('tr'); tr.dataset.code = p.code; if (p.code === PF.code) tr.className = 'on';
    tr.innerHTML = `<td class="num">${esc(p.code)}</td><td>${esc(p.name)}</td><td>${esc(p.unit)}</td><td class="r num">${fmt0(p.price)}</td><td class="r num">${p.cost ? fmt0(p.cost) : '—'}</td><td class="r num">${p.stock ?? '—'}</td>`;
    tr.onclick = () => handleCode(p.code); tb.appendChild(tr);
  }
  $('pCount').textContent = `${PL.rows.length.toLocaleString()} รายการ${PL.rows.length > 300 ? ' (แสดง 300 แรก พิมพ์ค้นหาให้แคบลง)' : ''}`;
}
function markRow(code) { $('pRows').querySelectorAll('tr').forEach(tr => tr.classList.toggle('on', tr.dataset.code === code)); $('pRows').querySelector('tr.on')?.scrollIntoView({ block: 'nearest' }); }
let pSearchT = null;
$('pSearch').addEventListener('input', () => { clearTimeout(pSearchT); pSearchT = setTimeout(() => { drawPSug(); drawPList(); }, 120); });
$('pSort').onchange = drawPList;
$('pSearch').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); const i = Math.max(0, Math.min(PL.rows.length - 1, PL.rows.findIndex(p => p.code === PF.code) + (e.key === 'ArrowDown' ? 1 : -1)));
    if (PL.rows[i]) handleCode(PL.rows[i].code); return;
  }
  if (e.key !== 'Enter') return; e.preventDefault();
  const v = fixCode(e.target.value.trim()); if (!v) return;
  if (P.has(v)) { e.target.value = ''; drawPList(); return handleCode(v); }
  drawPList();
  if (PL.rows.length === 1) { e.target.value = ''; const c = PL.rows[0].code; drawPList(); return handleCode(c); }
  if (!PL.rows.length && /^\d{8,}$/.test(v)) { e.target.value = ''; drawPList(); return handleCode(v); }
});

/* ---------- page modes: product info · receive goods · count stock ---------- */
const SC = { mode: 'info', cam: null, camOn: false, last: '', lastAt: 0, sup: store.get('rcvSup', ''), rcv: store.get('rcvList', []), counted: store.get('counted', { date: '', list: [] }) };
if (SC.counted.date !== today()) SC.counted = { date: today(), list: [] };
$('pMode').querySelectorAll('button').forEach(b => b.onclick = () => pMode(b.dataset.m));
function pMode(m) {
  SC.mode = m; $('pMode').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x.dataset.m === m));
  $('paneInfo').hidden = m !== 'info'; $('paneRecv').hidden = m !== 'recv'; $('paneCount').hidden = m !== 'count';
  $('scanMsg').textContent = ''; if (m === 'recv') drawRecv(); if (m === 'count') drawCounted();
}
// a barcode from the search box, the camera or a table click goes to whatever the page is doing
function handleCode(code) {
  const p = P.get(code);
  if (!p && SC.mode === 'info' && PF.mode !== 'edit' && PF.mode !== 'new') {
    camStop(); pfClear(false); $('pfCode').value = code; pfCheckCode();
    toast('ไม่พบบาร์โค้ดนี้ ใส่ข้อมูลเพื่อเพิ่มสินค้าใหม่ได้เลย');
    $('paneInfo').scrollIntoView({ behavior: 'smooth', block: 'start' }); return;
  }
  if (!p) {
    $('scanMsg').innerHTML = `ไม่พบสินค้าบาร์โค้ด <b class="num">${esc(code)}</b> <button class="ghost" id="scanAdd">เพิ่มเป็นสินค้าใหม่</button>`;
    $('scanAdd').onclick = () => { camStop(); pMode('info'); pfClear(false); $('pfCode').value = code; pfCheckCode(); $('scanMsg').textContent = ''; };
    return;
  }
  $('scanMsg').textContent = '';
  if (SC.mode === 'info') { if (PF.mode === 'edit' || PF.mode === 'new') { toast('บันทึกหรือยกเลิกการแก้ไขก่อน'); return; } pfLoad(code); if (innerWidth < 900) $('paneInfo').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  else if (SC.mode === 'recv') addRecv(p); else showCount(p);
}
function loadScanLib() {
  if (window.Html5Qrcode) return Promise.resolve();
  return new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js'; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
}
async function camStart() {
  try {
    $('camBtn').disabled = true; $('scanMsg').textContent = 'กำลังเปิดกล้อง…';
    await loadScanLib();
    const Fm = Html5QrcodeSupportedFormats;
    $('camOv').hidden = false; $('cam').hidden = false;
    SC.cam = new Html5Qrcode('cam', { formatsToSupport: [Fm.EAN_13, Fm.EAN_8, Fm.UPC_A, Fm.UPC_E, Fm.CODE_128, Fm.CODE_39, Fm.ITF], experimentalFeatures: { useBarCodeDetectorIfSupported: true }, verbose: false });
    await SC.cam.start({ facingMode: 'environment' }, { fps: 12, qrbox: (w, h) => ({ width: Math.min(w * .85, 340), height: Math.min(h * .45, 160) }) }, code => onScanned(code), () => { });
    SC.camOn = true; $('camLbl').textContent = 'ปิดกล้อง'; $('scanMsg').textContent = 'ส่องบาร์โค้ดให้อยู่ในกรอบ';
  } catch (e) {
    console.error(e); $('cam').hidden = true; $('camOv').hidden = true;
    $('scanMsg').textContent = 'เปิดกล้องไม่ได้ ตรวจว่าอนุญาตให้เว็บนี้ใช้กล้องแล้ว (หรือพิมพ์บาร์โค้ดในช่องค้นหาแทน)';
  } finally { $('camBtn').disabled = false; }
}
async function camStop() { try { await SC.cam?.stop(); SC.cam?.clear(); } catch (e) { } SC.camOn = false; $('cam').hidden = true; $('camOv').hidden = true; $('camLbl').textContent = 'สแกนด้วยกล้อง'; }
$('camBtn').onclick = () => { SC.target = ''; SC.camOn ? camStop() : camStart(); };
$('pfCam').onclick = () => { SC.target = 'pfCode'; if (!SC.camOn) camStart(); };
$('camClose').onclick = () => camStop();
$('camOv').addEventListener('click', e => { if (e.target === $('camOv')) camStop(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('camOv').hidden) camStop(); });
function onScanned(code) {
  code = String(code).trim(); const now = Date.now();
  if (code === SC.last && now - SC.lastAt < 2500) return;   // same barcode still in front of the camera
  SC.last = code; SC.lastAt = now;
  try { navigator.vibrate?.(60); } catch (e) { }
  camStop();   // got a barcode: close the camera, no need to press ปิดกล้อง
  if (SC.target === 'buy') { SC.target = ''; buyScan(fixCode(code)); return; }
  if (SC.target === 'pfCode') { SC.target = ''; const c = fixCode(code); $('pfCode').value = c; pfCheckCode(); return; }
  handleCode(code);
}

/* receive goods */
function drawRecvSup() {
  const box = $('rcvSup'); box.innerHTML = '';
  const list = supList().slice(); if (SC.sup && !list.includes(SC.sup)) list.push(SC.sup);
  for (const n of list) { const b = document.createElement('button'); b.className = 'chip'; b.textContent = n; b.setAttribute('aria-pressed', SC.sup === n); b.onclick = () => { SC.sup = n; store.set('rcvSup', n); drawRecv(); }; box.appendChild(b); }
  const a = document.createElement('button'); a.className = 'chip add'; a.textContent = '+ ร้านอื่น';
  a.onclick = () => askNewSupplier(v => { if (v) { SC.sup = v; store.set('rcvSup', v); } drawRecv(); });
  box.appendChild(a);
}
function addRecv(p) {
  if (!SC.sup) { $('scanMsg').textContent = 'เลือกร้านที่รับของมาก่อน'; return; }
  const ex = SC.rcv.find(i => i.code === p.code);
  if (ex) ex.qty++; else SC.rcv.unshift({ code: p.code, name: p.name, qty: 1, cost: p.sp?.[SC.sup]?.c || p.cost || 0, oldCost: p.cost || 0 });
  store.set('rcvList', SC.rcv); drawRecv(); toast(`${p.name.slice(0, 22)} ${ex ? '+1' : 'เพิ่มแล้ว'}`);
}
function drawRecv() {
  drawRecvSup();
  const box = $('rcvList'); box.innerHTML = '';
  SC.rcv.forEach((it, idx) => {
    const p = P.get(it.code); const best = p ? Object.entries(p.sp || {}).filter(([n]) => n !== SC.sup).sort((a, b) => a[1].c - b[1].c)[0] : null;
    const row = document.createElement('div'); row.className = 'rrow';
    row.innerHTML = `<div class="nm">${esc(it.name)}<div class="hint num">${esc(it.code)}${p?.cost ? ' · ต้นทุนเดิม ' + fmt0(p.cost) : ''}</div>${best && it.cost > best[1].c ? `<div class="cheaper">ร้าน ${esc(best[0])} ถูกกว่า (${fmt0(best[1].c)} ฿)</div>` : ''}</div>
      <div class="rinputs"><label>จำนวน<input class="num" data-f="qty" inputmode="numeric" value="${it.qty}"></label><label>ต้นทุน/ชิ้น<input class="num" data-f="cost" inputmode="decimal" value="${it.cost || ''}"></label><button class="del" aria-label="ลบ">×</button></div>`;
    row.querySelectorAll('input').forEach(inp => inp.onchange = () => { const v = parseFloat(inp.value); it[inp.dataset.f] = inp.dataset.f === 'qty' ? Math.max(1, Math.round(v) || 1) : (v >= 0 ? v : 0); store.set('rcvList', SC.rcv); drawRecv(); });
    row.querySelector('.del').onclick = () => { SC.rcv.splice(idx, 1); store.set('rcvList', SC.rcv); drawRecv(); };
    box.appendChild(row);
  });
  $('rcvEmpty').hidden = SC.rcv.length > 0; $('rcvFoot').hidden = !SC.rcv.length;
  $('rcvTotal').textContent = fmt0(SC.rcv.reduce((s, i) => s + i.qty * (i.cost || 0), 0)); $('rcvCount').textContent = SC.rcv.length;
}
$('rcvClear').onclick = () => confirmBox('ล้างรายการรับของที่ยังไม่บันทึก?', 'ล้าง', () => { SC.rcv = []; store.set('rcvList', []); drawRecv(); });
$('rcvSave').onclick = () => {
  if (!SC.sup) { toast('เลือกร้านก่อน'); return; }
  const items = SC.rcv.map(i => ({ ...i })); const total = items.reduce((s, i) => s + i.qty * (i.cost || 0), 0);
  confirmBox(`บันทึกรับของจาก ${SC.sup} ${items.length} รายการ รวม ${fmt0(total)} บาท?`, 'บันทึก', () => {
    DB.receiveGoods({ date: today(), supplier: SC.sup, items, total, email: S.user?.email || '' }).catch(fail);
    for (const i of items) { const p = P.get(i.code); if (p) { p.stock = (p.stock || 0) + i.qty; if (i.cost > 0) { p.cost = i.cost; p.sp = { ...(p.sp || {}), [SC.sup]: { c: i.cost, d: today() } }; } } }
    SC.rcv = []; store.set('rcvList', []); drawRecv(); drawPList(); toast('บันทึกรับของแล้ว สต็อกเพิ่มแล้ว');
  });
};

/* count stock */
function showCount(p) {
  const box = $('cntCard');
  box.innerHTML = `<div class="pcard"><h3>${esc(p.name)}</h3><div class="hint num">${esc(p.code)} · สต็อกในระบบ ${p.stock ?? '—'}</div>
    <div class="inrow"><input class="cntnum num" id="cntQty" inputmode="numeric" placeholder="0" aria-label="จำนวนที่นับได้"><button class="primary" id="cntSave">บันทึก</button></div></div>`;
  const q = $('cntQty'); q.focus();
  const save = () => { const v = parseInt(q.value); if (isNaN(v) || v < 0) { toast('ใส่จำนวนที่นับได้'); return; }
    DB.setStock(p.code, p.name, p.stock ?? null, v, S.user?.email).catch(fail);
    SC.counted.list = [{ code: p.code, name: p.name, old: p.stock ?? null, n: v }, ...SC.counted.list.filter(x => x.code !== p.code)]; store.set('counted', SC.counted);
    p.stock = v; box.innerHTML = `<div class="empty">บันทึก ${esc(p.name.slice(0, 30))} = ${v} แล้ว ยิงตัวต่อไปได้เลย</div>`; drawCounted(); drawPList(); $('pSearch').focus(); };
  $('cntSave').onclick = save; q.onkeydown = e => { if (e.key === 'Enter') save(); };
}
function drawCounted() {
  $('cntDoneCount').textContent = `(${SC.counted.list.length})`;
  $('cntDone').innerHTML = SC.counted.list.map(x => `<div class="recent"><span class="nm">${esc(x.name)}<div class="hint num">${esc(x.code)}</div></span><span class="num">${x.old ?? '—'} → <b>${x.n}</b></span></div>`).join('') || '<div class="hint" style="padding:8px">ยังไม่ได้นับ</div>';
}

/* ---------- barcode stickers (XP-420B) ---------- */
const LABEL_SIZES = [['32x25', '32 × 25 มม.'], ['40x30', '40 × 30 มม.'], ['50x30', '50 × 30 มม.'], ['30x20', '30 × 20 มม.']];
function loadBarcodeLib() {
  if (window.JsBarcode) return Promise.resolve();
  return new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js'; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
}
// bars sized in whole printer dots (203 dpi ≈ 8 dots/mm) so the scanner reads them; digits drawn as text, not stretched
function barcodeSVG(code, availMm = 29, hMm = 9) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const ean = /^\d{13}$/.test(code) && +code[12] === eanCheck(code.slice(0, 12));
  try { JsBarcode(svg, code, { format: ean ? 'EAN13' : 'CODE128', displayValue: false, margin: 0, height: 10, width: 1, flat: true }); }
  catch (e) { JsBarcode(svg, code, { format: 'CODE128', displayValue: false, margin: 0, height: 10, width: 1 }); }
  const modules = parseFloat(svg.getAttribute('width')) || 95;
  const dot = 25.4 / 203, k = Math.max(1, Math.min(3, Math.floor(availMm / (modules * dot))));   // dots per bar module
  svg.setAttribute('viewBox', `0 0 ${modules} 10`); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('shape-rendering', 'crispEdges');
  svg.style.width = (modules * k * dot).toFixed(3) + 'mm'; svg.style.height = hMm + 'mm';
  svg.removeAttribute('width'); svg.removeAttribute('height');
  return svg.outerHTML;
}
async function openLabel(p) {
  try { await loadBarcodeLib(); } catch (e) { toast('โหลดตัวสร้างบาร์โค้ดไม่ได้ ต้องต่อเน็ตครั้งแรก'); return; }
  const L = { size: '32x25', price: true, shop: false, cols: 3, dx: 0, ...store.get('label', {}) };
  const s = openModal(`<h2>พิมพ์สติกเกอร์บาร์โค้ด</h2><p style="margin:0 0 8px">${esc(p.name)}</p>
    <div class="lblopts">
      <label>จำนวนดวง<input class="tin num" id="lbN" inputmode="numeric" value="1"></label>
      <label>ขนาดสติกเกอร์<select class="tin" id="lbSize">${LABEL_SIZES.map(([v, l]) => opt(v, l, v === L.size)).join('')}</select></label>
      <label>แถวละ<select class="tin" id="lbCols">${[1, 2, 3].map(c => opt(String(c), c + ' ดวง', c === +L.cols)).join('')}</select></label>
      <label>เลื่อนซ้าย/ขวา (มม.)<input class="tin num" id="lbDx" inputmode="decimal" value="${L.dx || 0}" title="ติดลบ = เลื่อนไปทางซ้าย"></label>
      <label class="check"><input type="checkbox" id="lbPrice" ${L.price ? 'checked' : ''}> พิมพ์ราคา</label>
      <label class="check"><input type="checkbox" id="lbShop" ${L.shop ? 'checked' : ''}> พิมพ์ชื่อร้าน</label>
    </div>
    <div class="lblprev" id="lbPrev"></div>
    <p class="hint" style="margin:8px 0 0">กดพิมพ์แล้วจะเปิดหน้าสติกเกอร์ขึ้นมาพร้อมหน้าต่างพิมพ์ เลือกเครื่อง <b>Xprinter XP-420B</b> แล้วกดพิมพ์ (ใบเสร็จยังออกอัตโนมัติเหมือนเดิม)</p>
    <div class="mrow"><button class="ghost" id="lbNo">ยกเลิก</button><button class="primary" id="lbGo">พิมพ์</button></div>`);
  const get = () => ({ n: Math.max(1, Math.min(300, parseInt(s.querySelector('#lbN').value) || 1)), size: s.querySelector('#lbSize').value, price: s.querySelector('#lbPrice').checked, shop: s.querySelector('#lbShop').checked, cols: +s.querySelector('#lbCols').value || 1, dx: parseFloat(s.querySelector('#lbDx').value) || 0 });
  const prev = () => { const o = get(); const [w, h] = o.size.split('x').map(Number); s.querySelector('#lbPrev').innerHTML = `<div class="lbl" style="width:${w}mm;height:${h}mm;zoom:2">${labelInner(p, o, w, h)}</div>`; };
  s.querySelectorAll('#lbSize,#lbPrice,#lbShop').forEach(x => x.onchange = prev); prev();
  s.querySelector('#lbNo').onclick = closeModal;
  s.querySelector('#lbGo').onclick = () => { const o = get(); store.set('label', { size: o.size, price: o.price, shop: o.shop, cols: o.cols, dx: o.dx }); closeModal(); printLabels(p, o); };
}
function labelInner(p, o, w, h) {
  const small = h <= 20;
  const bh = Math.max(5, h * 0.36 - (o.shop ? 1.5 : 0));
  return `${o.shop ? `<div class="ls">${esc(S.settings.shop)}</div>` : ''}<div class="ln${small ? ' one' : ''}">${esc(p.name)}</div><div class="lb">${barcodeSVG(p.code, w - 3, bh)}<div class="lc">${esc(p.code)}</div></div>${o.price ? `<div class="lp">${fmt0(p.price)} บาท</div>` : ''}`;
}
// The till's Chrome prints silently to the receipt printer, so labels open as their own page in Edge,
// which shows the normal print dialog (pick Xprinter XP-420B once; Edge remembers it).
function printLabels(p, o) {
  const data = { c: p.code, name: p.name, n: o.n, s: o.size, p: o.price ? p.price : '', shop: o.shop ? S.settings.shop : '', cols: o.cols, dx: o.dx };
  const url = new URL('label.html', location.href).href + '#' + encodeURIComponent(JSON.stringify(data));
  const win = /Windows/.test(navigator.userAgent);
  const a = document.createElement('a'); a.href = win ? 'microsoft-edge:' + url : url; a.target = '_blank'; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  if (win) toast('เปิดหน้าพิมพ์สติกเกอร์ใน Edge แล้ว เลือกเครื่อง XP-420B แล้วกดพิมพ์', 6000);
}

/* ---------- keys & clock ---------- */
document.addEventListener('keydown', e => {
  if ($('appRoot').hidden) return;
  if (e.key === 'Escape' && modalOpen()) { closeModal(); return; }
  if (modalOpen() || $('viewSell').hidden) return;
  if (e.key === 'F1') { e.preventDefault(); openFinder(''); return; }
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const a = document.activeElement, q = $('q');
    if (a !== q) {
      const inNum = a && a.matches('#cart input, #disc');
      const other = a && a.matches('input, textarea, select') && !inNum;
      const numKey = /[\d.*\-]/.test(thaiDigits(e.key));
      if (!other && !(inNum && numKey)) { e.preventDefault(); q.focus(); q.value += e.key; q.dispatchEvent(new Event('input')); }
    }
  }
  if (e.key === 'F6') { e.preventDefault(); holdBill(); return; }
  const map = { F2: 'cash', F3: 'transfer', F4: 'half' }; if (map[e.key]) { e.preventDefault(); openPay(map[e.key]); }
});
document.addEventListener('click', e => {
  const a = document.activeElement;
  if (a && a !== $('q') && a.matches('input,select,textarea')) return;      // typing elsewhere (e.g. a drag-select ended outside the box)
  if (String(getSelection?.() || '')) return;
  if (!e.target.closest('input,button,select,.modal,summary,label')) focusQ();
});
// number boxes: select the whole value on click so typing replaces it; Thai-layout digits become numbers
document.addEventListener('focusin', e => { if (e.target.matches('.qty input, .ld input, input.price, #disc, .rinputs input, #recv, #chkPrice, #cntQty, #pdQtyEdit')) setTimeout(() => { try { e.target.select(); } catch (x) { } }, 0); });
document.addEventListener('input', e => {
  const el = e.target; if (!el.matches('[inputmode="numeric"], [inputmode="decimal"]') || el.id === 'q' || el.id === 'pSearch' || el.id === 'pfCode') return;
  const v = el.value; if (!/[\u0E00-\u0E7F\/\-]/.test(v)) return;   // number boxes never need letters, "/" or "-"
  const c = thaiDigits(v); if (c !== v) el.value = c;
});
let salesDate = null, unsubSales = null;
function watchToday() {
  const d = today(); if (d === salesDate) return; salesDate = d; unsubSales?.();
  unsubSales = DB.watchSales(d, list => { S.bills = list; pendingSales = list.some(b => b.pending); setSync(); if (!$('viewBills').hidden) renderBills(); }, e => console.error(e));
}
const tick = () => { const d = new Date(); $('clock').textContent = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); if (S.user) watchToday(); };

/* ---------- reports ---------- */
const R = { mode: 'month', data: null, bills: null, busy: 0 };
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const be = y => +y + 543;
function rInit() {
  const now = new Date();
  const years = Array.from({ length: now.getFullYear() - 2022 }, (_, i) => now.getFullYear() - i);
  $('rYear').innerHTML = years.map(y => `<option value="${y}">ปี ${be(y)}</option>`).join('');
  $('rMonYear').innerHTML = years.map(y => `<option value="${y}">${be(y)}</option>`).join('');
  $('rMon').innerHTML = TH_MON.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
  $('rMon').value = now.getMonth() + 1; $('rMonYear').value = now.getFullYear();
  $('rTo').value = today(); const f = new Date(now); f.setDate(f.getDate() - 6); $('rFrom').value = ymd(f);
  $('rMode').querySelectorAll('button').forEach(b => b.onclick = () => { R.mode = b.dataset.m; $('rMode').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); rControls(); loadReport(); });
  ['rMon', 'rMonYear', 'rYear', 'rFrom', 'rTo'].forEach(id => $(id).onchange = loadReport);
  $('rMethod').onchange = drawReport;
  $('rExport').onclick = exportReport; rControls();
}
function rControls() { $('rMonthBox').hidden = R.mode !== 'month'; $('rYear').hidden = R.mode !== 'year'; $('rRange').hidden = R.mode !== 'range'; }
function rPeriod() {
  if (R.mode === 'today') { const d = today(); return { from: d, to: d, title: 'วันนี้' }; }
  if (R.mode === 'month') { const y = +$('rMonYear').value, m = +$('rMon').value; const last = new Date(y, m, 0).getDate(); return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}`, title: `${TH_MON[m - 1]} ${be(y)}` }; }
  if (R.mode === 'year') { const y = +$('rYear').value; return { from: `${y}-01-01`, to: `${y}-12-31`, title: `ปี ${be(y)}` }; }
  let a = $('rFrom').value, b = $('rTo').value; if (a > b) [a, b] = [b, a];
  return { from: a, to: b, title: `${a.split('-').reverse().join('/')} – ${b.split('-').reverse().join('/')}` };
}
const shiftYear = s => (+s.slice(0, 4) - 1) + s.slice(4);
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5) + 1;
async function loadReport() {
  const per = rPeriod(); const ticket = ++R.busy;
  $('rKpis').innerHTML = '<div class="hint">กำลังโหลด…</div>';
  try {
    const span = daysBetween(per.from, per.to);
    const [days, prev, bills] = await Promise.all([
      DB.getDaily(per.from, per.to), DB.getDaily(shiftYear(per.from), shiftYear(per.to)),
      span <= 62 ? DB.getSalesRange(per.from, per.to) : Promise.resolve(null)]);
    if (ticket !== R.busy) return;
    R.data = { per, days, prev, span }; R.bills = bills; drawReport();
  } catch (e) { console.error(e); $('rKpis').innerHTML = `<div class="notice">โหลดรายงานไม่สำเร็จ ${e.code === 'permission-denied' ? '(ต้องอัปเดตกฎความปลอดภัยใน Firebase ให้มีส่วน daily)' : ''}</div>`; }
}
// one day's figures, combining live totals and the old program's history
function dayVal(d, method, seller) {
  const lg = d.lg || {};
  if (seller) { const v = d.s?.[seller] || 0; return { net: v, cost: null, bills: null }; }
  if (method) { const v = (d.m?.[method] || 0) + (lg.m?.[method] || 0); return { net: v, cost: null, bills: null }; }
  return { net: (d.net || 0) + (lg.net || 0), cost: (d.cost || 0) + (lg.cost || 0), bills: (d.bills || 0) + (lg.bills || 0) };
}
function sumDays(days, method, seller) {
  let net = 0, cost = 0, bills = 0, costKnown = true, billsKnown = true;
  for (const d of days) { const v = dayVal(d, method, seller); net += v.net; if (v.cost === null) costKnown = false; else cost += v.cost; if (v.bills === null) billsKnown = false; else bills += v.bills; }
  return { net, cost: costKnown ? cost : null, bills: billsKnown ? bills : null };
}
function drawReport() {
  if (!R.data) return; const { per, days, prev, span } = R.data;
  const method = $('rMethod').value, seller = '';
  let t = sumDays(days, method, seller);
  // with a seller or method chosen and bills loaded, count from the bills themselves (gives cost too)
  const fb = R.bills ? R.bills.filter(b => !b.cancelled && (!method || b.method === method) && (!seller || b.seller === seller)) : null;
  if ((method || seller) && fb && !(method === 'other')) {
    const lgNet = method ? days.reduce((s, d) => s + (d.lg?.m?.[method] || 0), 0) : 0;
    t = { net: fb.reduce((s, b) => s + b.net, 0), cost: fb.reduce((s, b) => s + b.items.reduce((x, i) => x + (i.cost || 0) * i.qty, 0), 0), bills: fb.length };
    if (lgNet) { t.net += lgNet; t.cost = null; t.bills = null; }
  }
  // compare like with like: if the period runs past today, compare only up to the same date last year
  const upto = shiftYear(per.to < today() ? per.to : today());
  const pv = sumDays(prev.filter(d => d.date <= upto), method, seller).net;
  const profit = t.cost === null ? null : t.net - t.cost;
  const pct = pv ? Math.round((t.net - pv) / pv * 100) : null;
  $('rKpis').innerHTML = [
    ['ยอดขาย ' + per.title, fmt0(t.net), pct === null ? '' : `<div class="sub ${pct >= 0 ? 'up' : 'down'}">${pct >= 0 ? '+' : ''}${pct}% จากปีก่อน ช่วงวันเดียวกัน</div>`],
    ['ต้นทุน', t.cost === null ? '—' : fmt0(t.cost), ''],
    ['กำไร', profit === null ? '—' : fmt0(profit), profit === null || !t.net ? '' : `<div class="sub">${Math.round(profit / t.net * 100)}% ของยอดขาย</div>`],
    ['จำนวนบิล', t.bills === null ? '—' : t.bills.toLocaleString(), t.bills ? `<div class="sub">เฉลี่ย ${fmt0(Math.round(t.net / t.bills))} บาท/บิล</div>` : '']
  ].map(([k, v, s]) => `<div class="card kpi"><div class="k">${k}</div><div class="v">${v}</div>${s}</div>`).join('');
  $('rCompare').textContent = pv ? `ปีก่อน ช่วงวันเดียวกัน ${fmt0(pv)} บาท` : '';
  drawChart(per, days, prev, method, seller, span);
  drawTop(fb, span); drawBillList(fb, span); drawLow();
}
function drawChart(per, days, prev, method, seller, span) {
  const byMonth = span > 62; const buckets = [];
  if (byMonth) { let y = +per.from.slice(0, 4), m = +per.from.slice(5, 7); const ey = +per.to.slice(0, 4), em = +per.to.slice(5, 7); while (y < ey || (y === ey && m <= em)) { buckets.push({ key: `${y}-${pad(m)}`, label: TH_MON[m - 1] }); m++; if (m > 12) { m = 1; y++; } } }
  else { const d = new Date(per.from); for (let i = 0; i < span; i++) { buckets.push({ key: ymd(d), label: String(d.getDate()) }); d.setDate(d.getDate() + 1); } }
  const val = {}, pval = {}; const k = s => byMonth ? s.slice(0, 7) : s;
  for (const d of days) val[k(d.date)] = (val[k(d.date)] || 0) + dayVal(d, method, seller).net;
  for (const d of prev) { const key = k((+d.date.slice(0, 4) + 1) + d.date.slice(4)); pval[key] = (pval[key] || 0) + dayVal(d, method, seller).net; }
  const max = Math.max(...buckets.map(b => Math.max(val[b.key] || 0, pval[b.key] || 0)), 0);
  if (!max) { $('rChartTitle').textContent = 'ยอดขาย'; $('rChart').innerHTML = '<div class="empty">ยังไม่มียอดขายในช่วงนี้ ถ้าเพิ่งเริ่มใช้ระบบ นำเข้ายอดย้อนหลังได้ที่แท็บบิลวันนี้</div>'; return; }
  const W = Math.max(560, buckets.length * 26), H = 200, padL = 52, padB = 22, bw = (W - padL - 8) / buckets.length;
  const y = v => H - padB - (v / max) * (H - padB - 10);
  const ticks = [0, max / 2, max].map(v => `<line x1="${padL}" x2="${W - 4}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${v >= 1000 ? Math.round(v / 1000) + 'k' : Math.round(v)}</text>`).join('');
  const bars = buckets.map((b, i) => { const v = val[b.key] || 0, pvv = pval[b.key] || 0, x = padL + i * bw;
    return `<g><title>${b.label}: ${fmt0(v)} บาท${pvv ? ` (ปีก่อน ${fmt0(pvv)})` : ''}</title>
      ${pvv ? `<rect x="${x + bw * .12}" y="${y(pvv)}" width="${bw * .76}" height="${H - padB - y(pvv)}" fill="var(--line)" rx="2"/>` : ''}
      <rect x="${x + bw * .26}" y="${y(v)}" width="${bw * .48}" height="${H - padB - y(v)}" fill="var(--accent)" rx="2"/>
      ${buckets.length <= 31 || i % 2 === 0 ? `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle" font-size="11" fill="var(--muted)">${b.label}</text>` : ''}</g>`; }).join('');
  $('rChartTitle').textContent = byMonth ? 'ยอดขายรายเดือน (สีเทา = ปีก่อน)' : 'ยอดขายรายวัน (สีเทา = ปีก่อน)';
  $('rChart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="กราฟยอดขาย">${ticks}${bars}</svg>`;
}
function drawTop(fb, span) {
  const tb = $('rTop'); tb.innerHTML = '';
  if (!fb) { $('rTopNote').textContent = 'เลือกช่วงไม่เกิน 62 วันเพื่อดูสินค้าขายดี'; return; }
  const agg = {};
  for (const b of fb) for (const i of b.items) { const a = agg[i.code] ||= { name: i.name, qty: 0, net: 0, profit: 0, costOk: true }; a.qty += i.qty; a.net += i.price * i.qty - (i.ld || 0); a.profit += (i.price - (i.cost || 0)) * i.qty - (i.ld || 0); if (!i.cost) a.costOk = false; }
  const top = Object.values(agg).sort((a, b) => b.net - a.net).slice(0, 15);
  $('rTopNote').textContent = top.length ? 'เฉพาะบิลในระบบใหม่' : 'ยังไม่มีบิลในช่วงนี้';
  for (const a of top) tb.insertAdjacentHTML('beforeend', `<tr><td>${esc(a.name)}</td><td class="r num">${a.qty}</td><td class="r num">${fmt0(a.net)}</td><td class="r num">${a.costOk ? fmt0(a.profit) : '<span class="hint">ไม่มีต้นทุน</span>'}</td></tr>`);
}
function drawBillList(fb, span) {
  const tb = $('rBills'); tb.innerHTML = '';
  if (!R.bills) { $('rBillNote').textContent = 'เลือกช่วงไม่เกิน 62 วันเพื่อดูรายบิล'; return; }
  const method = $('rMethod').value, seller = '';
  const list = R.bills.filter(b => (!method || b.method === method) && (!seller || b.seller === seller)).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  $('rBillNote').textContent = `${list.length.toLocaleString()} บิล (บิลจากโปรแกรมเดิมดูได้ที่โปรแกรมเดิม)`;
  for (const b of list.slice(0, 400)) {
    const tr = document.createElement('tr'); if (b.cancelled) tr.className = 'cancel';
    tr.innerHTML = `<td class="num">${b.date.slice(8)}/${b.date.slice(5, 7)} ${b.time}</td><td class="num">${esc(b.id)}</td><td><span class="pill">${METHOD[b.method] || b.method}</span></td><td class="r num">${fmt(b.net)}</td><td><button class="ghost">ดู</button></td>`;
    tr.querySelector('button').onclick = () => showReceipt(b, false); tb.appendChild(tr);
  }
}
function drawLow() {
  const low = LIST.filter(p => p.rank > 0 && p.price > 0 && (!p.cost || (p.price - p.cost) / p.price < 0.10)).sort((a, b) => b.rank - a.rank);
  $('rLowCount').textContent = `(${low.length} รายการ)`;
  const tb = $('rLow'); tb.innerHTML = '';
  for (const p of low.slice(0, 150)) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${esc(p.name)}<div class="hint num">${esc(p.code)}</div></td><td class="r num">${p.cost ? fmt0(p.cost) : '<span class="hint">ไม่มี</span>'}</td><td class="r num">${fmt0(p.price)}</td><td class="r num">${p.cost ? Math.round((p.price - p.cost) / p.price * 100) + '%' : '—'}</td><td><button class="editb">แก้</button></td>`;
    tr.querySelector('button').onclick = () => editProduct(p.code); tb.appendChild(tr);
  }
}
function exportReport() {
  if (!R.data) return; const { per, days } = R.data;
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['รายงานยอดขาย', per.title], [], ['วันที่', 'จำนวนบิล', 'ยอดขาย', 'ต้นทุน', 'กำไร', 'เงินสด', 'โอน', 'คนละครึ่ง', 'อื่นๆ']];
  for (const d of days.slice().sort((a, b) => a.date.localeCompare(b.date))) {
    const v = dayVal(d, '', ''); const m = k => (d.m?.[k] || 0) + (d.lg?.m?.[k] || 0);
    rows.push([d.date, v.bills, v.net, v.cost, Math.round((v.net - v.cost) * 100) / 100, m('cash'), m('transfer'), m('half'), m('other')]);
  }
  if (R.bills) {
    rows.push([], ['รายบิล'], ['วันที่', 'เวลา', 'เลขบิล', 'คนขาย', 'วิธีจ่าย', 'ยอด', 'ต้นทุน', 'สถานะ', 'รายการ']);
    for (const b of R.bills.slice().sort((a, c) => (a.ts || 0) - (c.ts || 0)))
      rows.push([b.date, b.time, b.id, b.seller, METHOD[b.method] || b.method, b.net, b.items.reduce((x, i) => x + (i.cost || 0) * i.qty, 0), b.cancelled ? 'ยกเลิก' : '', b.items.map(i => `${i.name} x${i.qty}`).join(' | ')]);
  }
  const csv = '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `รายงานยอดขาย_${per.from}_${per.to}.csv`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

rInit();

/* ---------- copy an old bill into a new one ---------- */
function copyBill(b) {
  if (T().cart.length) { S.tabs.push(newTab()); S.cur = S.tabs.length - 1; }
  for (const i of b.items) { const p = P.get(i.code); T().cart.push({ code: i.code, name: p?.name || i.name, unit: p?.unit || i.unit, price: p ? p.price : i.price, qty: i.qty, ld: i.ld || 0 }); }
  closeModal(); tab('sell'); render(); toast('คัดลอกบิลแล้ว ราคาเป็นราคาปัจจุบัน');
}

/* ---------- history import (owner) ---------- */
$('histFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const data = JSON.parse(await f.text()); if (data.kind !== 'history' || !Array.isArray(data.days)) throw new Error('ไฟล์ไม่ใช่ยอดขายย้อนหลัง');
    await DB.importHistory(data.days, (n, all) => $('histMsg').textContent = `กำลังนำเข้า ${n}/${all} วัน…`);
    $('histMsg').textContent = `นำเข้ายอดขายย้อนหลัง ${data.days.length.toLocaleString()} วันเรียบร้อย ดูได้ที่แท็บรายงาน`;
  } catch (err) { console.error(err); $('histMsg').textContent = 'นำเข้าไม่สำเร็จ: ' + (err.code === 'permission-denied' ? 'ต้องอัปเดตกฎความปลอดภัยใน Firebase ก่อน' : (err.code || err.message)); }
};

/* ---------- print-now toggle on the sell screen ---------- */
function setAutoPrint() { S.autoPrint = false; store.set('autoPrint', false); }

/* ---------- one-time brand clean-up: add Thai/English names and spellings, tag products that had no brand ---------- */
function brandFromName(name) { const r = detectBrand(name); if (r < 0) return -1; const [th, en] = BRAND_RULES[r]; return BRANDS.findIndex(b => norm(b[0]) === norm(th) || (en && norm(b[1]) === norm(en))); }
// one-time cost update from a supplier catalog (owner's device only; runs once, recorded in meta/info)
async function applyCostUpdate() {
  if (!S.isOwner) return;
  try {
    const { COSTS, COST_UPDATE_ID, COST_LABEL } = await import('./costs-pet8.js?v=69');
    const info = await DB.getMeta('info'); if ((info?.costs || []).includes(COST_UPDATE_ID)) return;
    const patch = {}; let changed = 0, loss = 0;
    for (const [code, c] of Object.entries(COSTS)) {
      const p = P.get(code); if (!p || !(c > 0) || p.cost === c) continue;
      DB.logPrice({ code, name: p.name, kind: 'cost', old: p.cost || 0, new: c, supplier: COST_LABEL, email: S.user?.email || '' }).catch(() => { });
      patch[code] = { c }; p.cost = c; changed++; if (p.price && c >= p.price) loss++;
    }
    if (changed) await DB.patchMany(patch);
    await DB.saveMeta('info', { costs: [...(info?.costs || []), COST_UPDATE_ID] });
    if (changed) toast(`บันทึกต้นทุนจาก${COST_LABEL} แล้ว ${changed} รายการ` + (loss ? ` (มี ${loss} ตัวที่ทุนสูงกว่าราคาขาย ดูที่ รายงาน › ควรเช็คราคา)` : ''), 9000);
  } catch (e) { console.warn('cost update', e); }
}
// one-time list additions shipped with the app (e.g. a restock order written down for the owner)
async function applySeeds() {
  if (!S.isOwner) return;
  if (!BUY.loaded) { setTimeout(applySeeds, 5000); return; }   // wait for the list itself before clearing from it
  try {
    const { SEEDS, CLEARS = [], FIXES = [] } = await import('./seeds.js?v=69');
    const info = await DB.getMeta('info'); const done = info?.seeds || []; let n = 0, cleared = 0;
    let fixed = 0;
    for (const fx of FIXES) {
      if (done.includes(fx.id)) continue;
      const bi = fx.brand ? BRANDS.findIndex(b => b[0] === fx.brand) : -1;
      for (const x of fx.items) {
        const p = P.get(x.code); if (!p) continue;
        const f = {}; if (x.name) { f.n = x.name; p.name = x.name; } if (bi >= 0) { f.b = bi; p.brand = bi; }
        if (fx.t) { f.t = fx.t; p.type = fx.t; } if (fx.a) { f.a = fx.a; p.animal = fx.a; }
        p.key = mkKey(p); DB.patchProduct(x.code, f).catch(() => { }); fixed++;
      }
      done.push(fx.id);
    }
    if (fixed) { await DB.saveMeta('info', { seeds: done }); toast(`แก้ข้อมูลสินค้าแล้ว ${fixed} รายการ`, 5000); if (!$('viewBuy').hidden) buyDraw(); }
    for (const c of CLEARS) {
      if (done.includes(c.id)) continue;
      const re = c.match ? new RegExp(c.match, 'i') : null;
      const ids = c.items ? c.items.slice() : BUY.items.filter(i => { const x = buyInfo(i); return x.brand.split(' · ')[0] === c.brand || (re && re.test(x.name)); }).map(i => i.id);
      BUY.items = BUY.items.filter(i => !ids.includes(i.id));
      for (let k = 0; k < ids.length; k += 400) await DB.delBuy(ids.slice(k, k + 400)).catch(() => { });
      for (const sid of [c.id, ...(c.seeds || [])]) if (!done.includes(sid)) done.push(sid);
      cleared += ids.length;
    }
    for (const sd of SEEDS) {
      if (done.includes(sd.id)) continue;
      for (const x of sd.items) {
        const p = P.get(x.code);
        if (p && sd.fix) {   // fill in missing type/animal on the product too (e.g. dog cans saved as "อื่นๆ")
          const f = {}; if (!p.type || p.type === 'other' || (sd.fix.force && p.type !== sd.fix.t)) { f.t = sd.fix.t; p.type = sd.fix.t; } if (!p.animal || (sd.fix.force && p.animal !== sd.fix.a)) { f.a = sd.fix.a; p.animal = sd.fix.a; }
          const fb = sd.fix.brand ? BRANDS.findIndex(b => b[0] === sd.fix.brand) : -1; if (fb >= 0 && !(p.brand >= 0)) { f.b = fb; p.brand = fb; }
          if (Object.keys(f).length) { p.key = mkKey(p); DB.patchProduct(p.code, f).catch(() => { }); }
        }
        const it = { id: x.id, code: p ? x.code : '', name: p?.name || x.name, qty: x.qty || sd.qty, note: x.note || sd.note || '', done: false, at: Date.now(), by: S.user?.email || '',
          bt: p && p.brand >= 0 && BRANDS[p.brand] ? BRANDS[p.brand][0] : (sd.fix?.brand || ''), t: p?.type || sd.fix?.t || 'other', a: p?.animal || sd.fix?.a || '', s: p?.supplier || '' };
        if (!BUY.items.some(i => i.id === it.id)) BUY.items.push(it);
        DB.saveBuy(it).catch(() => { }); n++;
      }
      done.push(sd.id);
    }
    if (n || cleared) { await DB.saveMeta('info', { seeds: done }); buyBadge(); if (!$('viewBuy').hidden) buyDraw(); toast(cleared ? 'ล้างรายการ Pet8 ที่สั่งแล้วออกจากของหมดแล้ว' : `เพิ่มในลิสต์ของหมดแล้ว ${n} รายการ`, 6000); }
  } catch (e) { console.warn('seeds', e); }
}
async function migrateBrands() {
  try {
    if (!S.isOwner || !BRANDS.length) return;
    const info = await DB.getMeta('info'); if ((info?.brandV || 0) >= BRAND_RULES_VERSION) return;
    const list = BRANDS.map(b => ({ th: b[0], en: b[1] || '', al: b[3] || [] }));
    const map = BRAND_RULES.map(([th, en, al]) => {
      const names = [th, en, ...al].filter(Boolean).map(norm);
      let i = list.findIndex(x => names.includes(norm(x.th)) || (x.en && names.includes(norm(x.en))));
      if (i < 0) { list.push({ th, en, al }); i = list.length - 1; }
      else {
        const x = list[i];
        if (!hasThai(x.th) && hasThai(th)) { al = [...al, x.th]; x.th = th; }   // brand someone typed in English only → give it its Thai name
        x.en = x.en || en; x.al = [...new Set([...(x.al || []), ...al])];
      }
      return i;
    });
    const patch = {};
    const prevV = info?.brandV || 0, NEW_FROM = { 4: BRAND_RULES.findIndex(r => r[0] === 'อีซี่แคท') };
    const forceFrom = Object.entries(NEW_FROM).filter(([v]) => +v > prevV && prevV > 0).reduce((m, [, i]) => Math.min(m, i < 0 ? Infinity : i), Infinity);
    for (const p of LIST) {
      const r = detectBrand(p.name); if (r < 0) continue;
      if (!(p.brand >= 0 && p.brand < BRANDS.length) || (r >= forceFrom && p.brand !== map[r])) patch[p.code] = { b: map[r] };
    }
    await DB.setBrands(list); await DB.patchMany(patch); await DB.saveMeta('info', { brandV: BRAND_RULES_VERSION });
    toast(`จัดยี่ห้อสินค้าเพิ่ม ${Object.keys(patch).length} รายการแล้ว`);
  } catch (e) { console.error('brand update', e); }
}

/* ---------- start-up: sign in, check access, first import, then load ---------- */
const gate = (msg, { login = false, importer = false, logout = false } = {}) => {
  $('gate').hidden = false; $('appRoot').hidden = true; $('gateMsg').textContent = msg;
  $('loginBtn').hidden = !login; $('importBox').hidden = !importer; $('gateLogout').hidden = !logout;
};
$('loginBtn').onclick = () => DB.login().catch(e => gate('เข้าสู่ระบบไม่สำเร็จ: ' + (e.code || e.message), { login: true }));
$('gateLogout').onclick = () => DB.logout();
$('importFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    $('importMsg').textContent = 'กำลังอ่านไฟล์…';
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data.p) || !Array.isArray(data.b)) throw new Error('ไฟล์ไม่ถูกต้อง');
    data.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
    await DB.importCatalog(data, S.user.email, (n, all) => $('importMsg').textContent = `กำลังนำเข้า ${n}/${all}…`);
    await DB.saveMeta('staff', { emails: [] });
    $('importMsg').textContent = `นำเข้าสินค้า ${data.p.length.toLocaleString()} รายการเรียบร้อย`; startData();
  } catch (err) { console.error(err); $('importMsg').textContent = 'นำเข้าไม่สำเร็จ: ' + (err.code || err.message); }
};

let unsubs = [];
function startData() {
  gate('กำลังโหลดข้อมูลสินค้า…');
  unsubs.forEach(u => u()); unsubs = [];
  unsubs.push(DB.watchMeta('brands', d => { const list = d?.list || []; BRANDS = list.map(b => [b.th, b.en || '', 0, b.al || []]); rebuildCatalog(); pfBrandList(); }));
  unsubs.push(DB.watchMeta('settings', d => { if (d) { S.settings = { ...DEFAULT_SETTINGS, ...d }; store.set('settingsCache', S.settings); }
    if (d && (!d.shop || d.shop === 'ร้านเพ็ทช็อป')) DB.saveMeta('settings', { shop: DEFAULT_SETTINGS.shop }).catch(() => { }); renderSellers(); pfDrawChips(); fillSettings(); }));
  if (S.isOwner) unsubs.push(DB.watchMeta('staff', d => { S.staff = d?.emails || []; fillSettings(); }, () => { }));
  unsubs.push(DB.watchCatalog(onChunk, e => { console.error(e); loadErrors.push(e.code || e.message); if (e.code === 'permission-denied') noAccess(); }));
  clearTimeout(startData.t);
  startData.t = setTimeout(() => {   // still not loaded: show what we have, or explain and offer a reset
    if (appShown) return;
    if (chunksSeen.size >= DB.CHUNKS / 2) return showApp();
    gate(`โหลดข้อมูลไม่ครบ (${chunksSeen.size}/${DB.CHUNKS})${loadErrors.length ? ' · ' + [...new Set(loadErrors)].join(', ') : ''}`, { logout: true });
    const box = $('gateLogout').parentNode; if (!$('gateRetry')) box.insertAdjacentHTML('beforeend',
      `<button class="primary" id="gateRetry">โหลดใหม่</button><button class="ghost" id="gateReset">ล้างข้อมูลในเครื่องนี้แล้วโหลดใหม่</button><p class="hint">ล้างข้อมูลในเครื่องไม่ทำให้ข้อมูลร้านหาย ข้อมูลทั้งหมดอยู่บนคลาวด์</p>`);
    $('gateRetry').onclick = () => location.reload();
    $('gateReset').onclick = async () => { $('gateReset').disabled = true; await DB.resetLocalCache(); location.reload(); };
  }, 15000);
  unsubs.push(DB.watchBuy(list => { BUY.items = list; BUY.loaded = true; if (!$('viewBuy').hidden) buyDraw(); buyBadge(); }, e => console.warn('buylist', e)));
  unsubs.push(DB.watchPriceLog(list => { S.priceLog = list; if (!$('viewBills').hidden) renderBills(); }));
  salesDate = null; watchToday();
}
function showApp() {
  appShown = true; store.set('ready', true);
  $('gate').hidden = true; $('appRoot').hidden = false;
  rebuildCatalog(); renderSellers(); pfDrawChips(); pfSetMode('empty'); fillSettings(); setAutoPrint(S.autoPrint); render(); setSync();
  if (matchMedia('(max-width: 700px)').matches) tab('prod'); else focusQ();
  setTimeout(migrateBrands, 2500); setTimeout(applyCostUpdate, 6000); setTimeout(applySeeds, 9000);
}
function noAccess() {
  unsubs.forEach(u => u()); unsubs = [];
  gate(`บัญชี ${S.user?.email} ยังไม่ได้รับสิทธิ์ใช้ระบบ ให้เจ้าของร้านเพิ่มอีเมลนี้ในหน้าตั้งค่า`, { logout: true });
}
window.__appStarted = true;
DB.watchAuth(async user => {
  S.user = user; appShown = false; chunksSeen = new Set();
  if (!user) { unsubs.forEach(u => u()); unsubs = []; gate('เข้าสู่ระบบด้วยบัญชี Google ของร้าน', { login: true }); return; }
  S.isOwner = (user.email || '').toLowerCase() === OWNER_EMAIL.toLowerCase();
  $('whoami').textContent = 'เข้าสู่ระบบเป็น ' + user.email; $('staffBox').hidden = !S.isOwner;
  gate('กำลังตรวจสอบสิทธิ์…');
  let ready = store.get('ready', false);
  try { ready = await DB.catalogReady(); }
  catch (e) { if (e.code === 'permission-denied') return noAccess(); /* offline: trust the last known state */ }
  if (!ready) {
    if (S.isOwner) return gate('ยังไม่มีข้อมูลสินค้าในระบบ', { importer: true, logout: true });
    return gate('ระบบยังไม่พร้อม ให้เจ้าของร้านเข้าสู่ระบบเพื่อนำเข้าข้อมูลสินค้าก่อน', { logout: true });
  }
  startData();
});
tick(); setInterval(tick, 15000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
/* tell the user when a newer version has been published, and update with one click */
const APP_VERSION = '69';
async function checkUpdate() {
  try {
    const v = (await (await fetch('version.txt?t=' + Date.now(), { cache: 'no-store' })).text()).trim();
    if (v && v !== APP_VERSION && !document.getElementById('updBar')) {
      document.body.insertAdjacentHTML('afterbegin', '<div id="updBar" class="updbar">มีเวอร์ชันใหม่ <button id="updBtn">อัปเดตเลย</button></div>');
      document.getElementById('updBtn').onclick = async () => {
        try { const rs = await navigator.serviceWorker?.getRegistrations?.() || []; await Promise.all(rs.map(r => r.update())); const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); } catch (e) { }
        location.reload();
      };
    }
  } catch (e) { }
}
setTimeout(checkUpdate, 3000); setInterval(checkUpdate, 5 * 60 * 1000); addEventListener('focus', checkUpdate);
