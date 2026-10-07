import * as DB from './db.js?v=10';
import { OWNER_EMAIL } from './config.js?v=10';

/* ---------- state ---------- */
const P = new Map(); let LIST = [];
let BRANDS = [];                          // [th, en, count]
const norm = s => String(s ?? '').toLowerCase().replace(/\s+/g, '');
function mkKey(o) { const b = BRANDS[o.brand]; return norm(o.name + ' ' + o.code + (b ? ' ' + b[0] + ' ' + b[1] : '')); }

const store = {
  get(k, d) { try { const v = localStorage.getItem('pos.' + k); return v ? JSON.parse(v) : d } catch (e) { return d } },
  set(k, v) { try { localStorage.setItem('pos.' + k, JSON.stringify(v)) } catch (e) { } }
};
const DEFAULT_SETTINGS = { shop: 'ร้านเพ็ทช็อป', pp: '', sellers: ['พ่อ', 'ไหม'], suppliers: ['ชินจิ', 'ฟู้ดอินโนว่า', 'แอลเคมาร์เก็ตติ้ง', 'เพอร์เฟคคอมพาเนียน'] };
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

function toast(t) { const el = document.createElement('div'); el.className = 'toast'; el.textContent = t; $('toastRoot').replaceChildren(el); setTimeout(() => el.remove(), 2200); }
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
  if (appShown) { render(); if (!$('viewBills').hidden) renderBills(); }
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
function totals(t = T()) {
  const sub = t.cart.reduce((s, i) => s + i.price * i.qty, 0);
  let d = t.discMode === 'pct' ? sub * Math.min(t.disc, 100) / 100 : Math.min(t.disc, sub); d = Math.round(d * 100) / 100;
  return { sub, disc: d, net: Math.round((sub - d) * 100) / 100, count: t.cart.reduce((s, i) => s + i.qty, 0) };
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
    const tr = document.createElement('tr'); if (it.code === lastAdded) tr.className = 'flash';
    tr.innerHTML = `<td class="num">${idx + 1}</td>
      <td style="min-width:180px">${esc(it.name)}<div class="hint num">${esc(it.code)} · ${esc(it.unit)}${it.custom ? ' <span class="changed">ราคาพิเศษบิลนี้</span>' : ''}</div></td>
      <td><span class="qty"><button aria-label="ลด">−</button><input class="num" value="${it.qty}" inputmode="numeric" aria-label="จำนวน"><button aria-label="เพิ่ม">+</button></span></td>
      <td class="r"><input class="price" value="${it.price}" inputmode="decimal" aria-label="ราคา"></td>
      <td class="r num">${fmt(it.price * it.qty)}</td>
      <td><button class="del" aria-label="ลบรายการ">×</button></td>`;
    const [minus, plus] = tr.querySelectorAll('.qty button'); const qi = tr.querySelector('.qty input');
    minus.onclick = () => { if (it.qty > 1) it.qty--; else cart.splice(idx, 1); render(); };
    plus.onclick = () => { it.qty++; render(); };
    qi.onchange = () => { it.qty = Math.max(1, parseInt(qi.value) || 1); render(); focusQ(); };
    qi.onkeydown = e => { if (e.key === 'Enter') qi.blur(); };
    const pi = tr.querySelector('.price');
    pi.onkeydown = e => { if (e.key === 'Enter') pi.blur(); };
    pi.onchange = () => { const v = parseFloat(pi.value); if (!(v >= 0) || v === it.price) { pi.value = it.price; return; } askPrice(it, Math.round(v * 100) / 100); };
    tr.querySelector('.del').onclick = () => { cart.splice(idx, 1); render(); focusQ(); };
    tb.appendChild(tr);
  });
  $('emptyCart').hidden = cart.length > 0;
}
function render() {
  renderTabs(); renderCart();
  const t = totals(), tab = T();
  $('subtotal').textContent = fmt(t.sub); $('discAmt').textContent = fmt(t.disc);
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
function addItem(p, qty = 1) {
  const cart = T().cart; const ex = cart.find(i => i.code === p.code);
  if (ex) { ex.qty += qty; cart.splice(cart.indexOf(ex), 1); cart.unshift(ex); }
  else cart.unshift({ code: p.code, name: p.name, unit: p.unit, price: p.price, qty });
  lastAdded = p.code; $('notice').innerHTML = ''; render();
}
function notFound(code) {
  $('notice').innerHTML = `<div class="notice">ไม่พบสินค้าบาร์โค้ด <b class="num">${esc(code)}</b> เพิ่มเป็นสินค้าใหม่ได้เลย
    <form id="addForm"><input id="nName" placeholder="ชื่อสินค้า" required style="flex:2 1 200px">
    <input id="nUnit" placeholder="หน่วย" style="flex:0 1 90px"><input id="nPrice" placeholder="ราคา" inputmode="decimal" required style="flex:0 1 90px">
    <button class="primary" style="padding:8px 14px;font-size:15px">เพิ่มและขาย</button></form></div>`;
  $('nName').focus();
  $('addForm').onsubmit = e => {
    e.preventDefault();
    const p = { code, name: $('nName').value.trim(), unit: $('nUnit').value.trim(), price: parseFloat($('nPrice').value) || 0, rank: 0, brand: -1, type: 'other', animal: '', big: 0, cost: 0, supplier: '' };
    p.key = mkKey(p); P.set(code, p); LIST.push(p); DB.saveProduct(p).catch(fail);
    addItem(p); toast('เพิ่มสินค้าใหม่แล้ว'); focusQ();
  };
}
$('q').addEventListener('input', e => { const v = e.target.value; if (/[^\d\s*\-]/.test(v)) { e.target.value = ''; openFinder(v); } });
$('q').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return; e.preventDefault();
  const v = e.target.value.trim(); if (!v) return; e.target.value = '';
  const cart = T().cart;
  const m = v.match(/^\*(\d+)$/); if (m) { if (cart[0]) { cart[0].qty = Math.max(1, +m[1]); render(); } return; }
  if (v === '-') { const it = cart[0]; if (it) { if (it.qty > 1) { it.qty--; toast('ลดเหลือ ' + it.qty + ' ชิ้น'); } else { cart.shift(); toast('เอารายการล่าสุดออกแล้ว'); } render(); } return; }
  if (P.has(v)) { addItem(P.get(v)); return; }
  if (/^\d{4,}$/.test(v)) { notFound(v); return; }
  openFinder(v);
});
$('findBtn').onclick = () => openFinder('');

/* ---------- finder popup ---------- */
const TYPES = [['', 'ทั้งหมด'], ['dry', 'อาหารเม็ด'], ['big', 'กระสอบ / 5 กก.+'], ['wet', 'อาหารเปียก'], ['lick', 'แมวเลีย'], ['treat', 'ขนม'], ['litter', 'ทราย'], ['med', 'ยา/อาหารเสริม'], ['groom', 'อาบน้ำ/ดูแลขน'], ['gear', 'อุปกรณ์/ของเล่น'], ['other', 'อื่นๆ']];
const ANIMALS = [['', 'ทุกสัตว์'], ['cat', 'แมว'], ['dog', 'สุนัข'], ['other', 'นก/กระต่าย/หนู/ปลา']];
const F = { q: '', brand: '', type: '', animal: '', sort: 'rank', sel: 0, res: [], added: 0 };
function filterF() {
  const words = F.q.toLowerCase().split(/\s+/).filter(Boolean).map(norm);
  const r = LIST.filter(p => (F.brand === '' || p.brand === +F.brand) && (F.type === '' || (F.type === 'big' ? p.big : p.type === F.type)) && (F.animal === '' || p.animal === F.animal) && words.every(w => p.key.includes(w)));
  const cmp = { rank: (a, b) => b.rank - a.rank, name: (a, b) => a.name.localeCompare(b.name, 'th'), price: (a, b) => a.price - b.price, pricedesc: (a, b) => b.price - a.price }[F.sort];
  F.res = r.sort(cmp); F.sel = 0;
}
function chipRow(list, key) { return list.map(([v, l]) => `<button class="chip" data-k="${key}" data-v="${v}" aria-pressed="${F[key] === v}">${l}</button>`).join(''); }
function openFinder(q) {
  Object.assign(F, { q, brand: '', type: '', animal: '', sel: 0, added: 0 });
  const nq = norm(q); const bi = nq.length >= 2 ? BRANDS.findIndex(b => norm(b[0]).startsWith(nq) || (b[1] && norm(b[1]).startsWith(nq))) : -1;
  if (bi >= 0) { F.brand = String(bi); F.q = ''; }
  const opts = BRANDS.map((b, i) => [i, b]).filter(([, b]) => b[2]).sort((a, b) => a[1][0].localeCompare(b[1][0], 'th')).map(([i, b]) => `<option value="${i}">${esc(b[0])} ${esc(b[1])} (${b[2]})</option>`).join('');
  const s = openModal(`<div class="fhead">
      <div class="frow"><input type="search" id="fq" placeholder="พิมพ์ชื่อ ยี่ห้อ หรือบาร์โค้ด" autocomplete="off" value="${esc(F.q)}">
        <select id="fb" aria-label="ยี่ห้อ"><option value="">ทุกยี่ห้อ</option>${opts}</select>
        <select id="fs" aria-label="เรียงตาม"><option value="rank">เรียง: ขายดี</option><option value="name">เรียง: ชื่อ</option><option value="price">เรียง: ราคาน้อย→มาก</option><option value="pricedesc">เรียง: ราคามาก→น้อย</option></select>
        <button class="ghost" id="fclose">ปิด <kbd>Esc</kbd></button></div>
      <div class="frow"><span class="flabel">ประเภท</span><div class="fchips">${chipRow(TYPES, 'type')}</div></div>
      <div class="frow"><span class="flabel">สัตว์</span><div class="fchips">${chipRow(ANIMALS, 'animal')}</div></div>
    </div>
    <div class="fbody"><table><thead><tr><th>สินค้า</th><th>หน่วย</th><th class="r">ราคา (แก้ได้)</th><th></th></tr></thead><tbody id="fr"></tbody></table><div class="empty" id="fempty" hidden>ไม่พบสินค้า ลองพิมพ์สั้นลง หรือเปลี่ยนตัวกรอง</div></div>
    <div class="ffoot"><span class="hint" id="fcount"></span><span class="hint">↑↓ เลือก · Enter ใส่บิลแล้วปิด · ปุ่ม "ใส่บิล" ใส่ต่อได้หลายตัว</span></div>`, 'finder');
  s.querySelector('#fb').value = F.brand;
  const draw = () => { filterF(); drawRows(); };
  s.querySelector('#fq').oninput = e => { F.q = e.target.value; draw(); };
  s.querySelector('#fb').onchange = e => { F.brand = e.target.value; draw(); s.querySelector('#fq').focus(); };
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
  const items = T().cart.map(i => { const p = P.get(i.code); return { code: i.code, name: i.name, unit: i.unit || '', price: i.price, qty: i.qty, cost: p?.cost || 0, known: !!p, custom: !!i.custom }; });
  const bill = { id: newBillId(), date: today(), time: pad(d.getHours()) + ':' + pad(d.getMinutes()), ts: d.getTime(), seller: S.seller, method, items, sub: t.sub, disc: t.disc, net: t.net, recv, change: Math.round((recv - t.net) * 100) / 100, count: t.count, cancelled: false, email: S.user?.email || '' };
  DB.saveSale(bill).catch(fail);
  closeCurrentTab(); showReceipt(bill, true);
  if (S.autoPrint) printReceipt(bill);
}
function receiptHTML(b) {
  return `<div class="receipt"><div class="c"><b>${esc(S.settings.shop)}</b><br>ใบเสร็จรับเงิน</div><hr>
  <div class="l"><span>${esc(b.id)}</span><span>${b.date.split('-').reverse().join('/')} ${b.time}</span></div><hr>
  ${b.items.map(i => `<div>${esc(i.name)}</div><div class="l"><span>&nbsp;&nbsp;${i.qty} x ${fmt0(i.price)}</span><span>${fmt(i.qty * i.price)}</span></div>`).join('')}<hr>
  <div class="l"><span>รวม ${b.count} ชิ้น</span><span>${fmt(b.sub)}</span></div>
  ${b.disc ? `<div class="l"><span>ส่วนลด</span><span>-${fmt(b.disc)}</span></div>` : ''}
  <div class="l"><b>สุทธิ</b><b>${fmt(b.net)}</b></div><div class="l"><span>${METHOD[b.method]}</span><span>${fmt(b.recv)}</span></div>
  ${b.method === 'cash' ? `<div class="l"><span>เงินทอน</span><span>${fmt(b.change)}</span></div>` : ''}<hr><div class="c">ขอบคุณที่อุดหนุนค่ะ</div></div>`;
}
function showReceipt(b, fresh) {
  const s = openModal(`<h2>${fresh ? (b.method === 'cash' ? 'ทอน ' + fmt(b.change) + ' บาท' : 'รับเงินแล้ว') : 'ใบเสร็จ ' + esc(b.id)}</h2>${receiptHTML(b)}
    <div class="mrow">${fresh ? '' : '<button class="ghost" id="rCopy">คัดลอกเป็นบิลใหม่</button>'}<button class="ghost" id="rPrint">พิมพ์ใบเสร็จ</button><button class="primary" id="rOk">${fresh ? (S.tabs.length > 1 || T().cart.length ? 'กลับไปบิลที่ค้างอยู่ (Enter)' : 'บิลถัดไป (Enter)') : 'ปิด'}</button></div>`);
  s.querySelector('#rPrint').onclick = () => printReceipt(b);
  s.querySelector('#rCopy')?.addEventListener('click', () => copyBill(b));
  const ok = s.querySelector('#rOk'); ok.onclick = closeModal; ok.focus();
}
/* Thermal receipt: 58 mm paper, about 48 mm printable */
function printReceipt(b) {
  const fontUrl = new URL('fonts/GoogleSans.woff2', location.href).href;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face{font-family:"Google Sans";src:url(${fontUrl}) format("woff2");font-weight:400 700}
    @page{size:58mm auto;margin:0}
    html,body{margin:0;padding:0;background:#fff;color:#000}
    .receipt{width:48mm;margin:0 auto;padding:2mm 0 6mm;font-family:"Google Sans",sans-serif;font-size:11.5px;line-height:1.35;font-weight:500}
    .c{text-align:center}.l{display:flex;justify-content:space-between;gap:4px}.l span:last-child{white-space:nowrap;font-variant-numeric:tabular-nums}
    hr{border:0;border-top:1px dashed #000;margin:4px 0} b{font-weight:700}
  </style></head><body>${receiptHTML(b)}</body></html>`;
  const f = document.createElement('iframe'); f.className = 'printframe'; document.body.appendChild(f);
  const d = f.contentDocument; d.open(); d.write(html); d.close();
  const go = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast('สั่งพิมพ์ไม่ได้'); } setTimeout(() => f.remove(), 60000); };
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
  for (const [vid, bid, name] of [['viewSell', 'tabSell', 'sell'], ['viewScan', 'tabScan', 'scan'], ['viewProd', 'tabProd', 'prod'], ['viewBills', 'tabBills', 'bills'], ['viewReport', 'tabReport', 'report']]) { $(vid).hidden = w !== name; $(bid).setAttribute('aria-selected', w === name); }
  if (w !== 'scan' && typeof SC !== 'undefined' && SC.camOn) camStop();
  if (w === 'scan') scanMode(SC.mode);
  if (w === 'bills') renderBills(); else if (w === 'prod') prodOpen(); else if (w === 'report') loadReport(); else focusQ();
}
$('tabSell').onclick = () => tab('sell'); $('tabProd').onclick = () => tab('prod'); $('tabBills').onclick = () => tab('bills'); $('tabReport').onclick = () => tab('report'); $('tabScan').onclick = () => tab('scan');

/* ---------- settings ---------- */
function fillSettings() {
  $('setShop').value = S.settings.shop; $('setPP').value = S.settings.pp || ''; $('setSups').value = (S.settings.suppliers || []).join(', ');
  $('setAutoPrint').checked = !!S.autoPrint; $('setStaff').value = S.staff.join(', ');
}
const splitList = v => v.split(',').map(s => s.trim()).filter(Boolean);
function saveSet() {
  const s = { ...S.settings, shop: $('setShop').value.trim() || 'ร้านเพ็ทช็อป', pp: $('setPP').value.trim(), suppliers: splitList($('setSups').value) };
  S.settings = s; store.set('settingsCache', s); DB.saveMeta('settings', s).catch(fail); renderSellers();
}
['setShop', 'setPP', 'setSups'].forEach(id => $(id).onchange = () => { saveSet(); pfDrawChips(); toast('บันทึกแล้ว'); });
$('setAutoPrint').onchange = e => { setAutoPrint(e.target.checked); toast(S.autoPrint ? 'เครื่องนี้จะพิมพ์ใบเสร็จอัตโนมัติ' : 'ปิดพิมพ์อัตโนมัติที่เครื่องนี้แล้ว'); };
$('setStaff').onchange = e => { const emails = splitList(e.target.value).map(x => x.toLowerCase()); DB.saveMeta('staff', { emails }).then(() => toast('บันทึกรายชื่อแล้ว')).catch(fail); };
$('logoutBtn').onclick = () => confirmBox('ออกจากระบบเครื่องนี้?', 'ออกจากระบบ', () => DB.logout());

/* ---------- product form ---------- */
const PTYPES = TYPES.filter(([v]) => v && v !== 'big');
const PANIMALS = ANIMALS.filter(([v]) => v);
const SIZEU = ['g', 'kg', 'ml', 'L', 'ชิ้น'];
const UNITS = ['ถุง', 'กระสอบ', 'ซอง', 'กระป๋อง', 'ถาด', 'ชิ้น', 'ขวด', 'แพ็ค', 'อัน', 'กระปุก'];
const PF = { code: '', editing: false, animal: '', type: '', sizeU: 'g', unit: '', sup: '', nameAuto: true };
const supList = () => S.settings.suppliers || [];
function brandIndex(v) { const n = norm(v); if (!n) return -1; return BRANDS.findIndex(b => norm(b[0]) === n || (b[1] && norm(b[1]) === n)); }
function pfChips(id, list, key) {
  const box = $(id); box.innerHTML = '';
  for (const it of list) {
    const [v, l] = Array.isArray(it) ? it : [it, it]; const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = l; b.setAttribute('aria-pressed', PF[key] === v);
    b.onclick = () => { PF[key] = PF[key] === v && key !== 'sizeU' ? '' : v; pfChips(id, list, key); pfName(); }; box.appendChild(b);
  }
}
function pfDrawChips() {
  pfChips('pfAnimal', PANIMALS, 'animal'); pfChips('pfType', PTYPES, 'type'); pfChips('pfSizeU', SIZEU, 'sizeU'); pfChips('pfUnit', UNITS, 'unit');
  const sl = supList().slice(); if (PF.sup && !sl.includes(PF.sup)) sl.push(PF.sup); pfChips('pfSup', sl, 'sup');
  const a = document.createElement('button'); a.type = 'button'; a.className = 'chip add'; a.textContent = '+ ร้านอื่น'; a.onclick = () => { $('pfSupNewBox').hidden = false; $('pfSupNew').focus(); }; $('pfSup').appendChild(a);
}
function addSupplier(name) {
  name = name.trim(); if (!name) return;
  if (!supList().includes(name)) { S.settings.suppliers = [...supList(), name]; store.set('settingsCache', S.settings); DB.saveMeta('settings', { suppliers: S.settings.suppliers }).catch(fail); $('setSups').value = S.settings.suppliers.join(', '); }
  PF.sup = name; $('pfSupNew').value = ''; $('pfSupNewBox').hidden = true; pfDrawChips();
}
function pfName() {
  const bi = brandIndex($('pfBrand').value); const b = bi >= 0 ? BRANDS[bi][0] : $('pfBrand').value.trim();
  $('pfBrandMsg').textContent = $('pfBrand').value.trim() && bi < 0 ? 'ยี่ห้อใหม่ จะเพิ่มเข้ารายการให้ตอนบันทึก' : '';
  const size = $('pfSize').value.trim();
  if (PF.nameAuto) $('pfName').value = [b, $('pfVariant').value.trim(), size ? size + PF.sizeU : ''].filter(Boolean).join(' ');
  $('pfAuto').hidden = PF.nameAuto;
  const pr = parseFloat($('pfPrice').value), co = parseFloat($('pfCost').value);
  $('pfMargin').textContent = pr > 0 && co > 0 ? `กำไรต่อหน่วย ${fmt0(pr - co)} บาท (${Math.round((pr - co) / pr * 100)}%)` : '';
}
function eanCheck(d12) { let s = 0; for (let i = 0; i < 12; i++) s += (+d12[i]) * (i % 2 ? 3 : 1); return (10 - s % 10) % 10; }
function randomCode() { for (; ;) { let d = '20'; for (let i = 0; i < 10; i++) d += Math.floor(Math.random() * 10); d += eanCheck(d); if (!P.has(d)) return d; } }
function pfClear(keep) {
  const kept = keep ? { brand: $('pfBrand').value, size: $('pfSize').value, price: $('pfPrice').value, cost: $('pfCost').value } : {};
  Object.assign(PF, { code: '', editing: false, nameAuto: true }); if (!keep) Object.assign(PF, { animal: '', type: '', sizeU: 'g', unit: '', sup: '' });
  $('pfCode').value = ''; $('pfVariant').value = ''; $('pfQty').value = ''; $('pfName').value = '';
  $('pfBrand').value = kept.brand || ''; $('pfSize').value = kept.size || ''; $('pfPrice').value = kept.price || ''; $('pfCost').value = kept.cost || '';
  $('pfTitle').textContent = 'เพิ่มสินค้าใหม่'; $('pfCodeMsg').textContent = ''; $('pfErr').hidden = true; $('pfGenBox').hidden = true;
  pfDrawChips(); pfName(); $('pfCode').focus();
}
function pfLoad(code) {
  const p = P.get(code); if (!p) return;
  Object.assign(PF, { code, editing: true, animal: p.animal || '', type: p.type || '', unit: p.unit || '', sup: p.supplier || '', nameAuto: false });
  $('pfCode').value = code; $('pfBrand').value = p.brand >= 0 && BRANDS[p.brand] ? BRANDS[p.brand][0] : ''; $('pfVariant').value = ''; $('pfSize').value = '';
  $('pfName').value = p.name; $('pfPrice').value = p.price; $('pfCost').value = p.cost || ''; $('pfQty').value = p.stock ?? '';
  $('pfTitle').textContent = 'แก้ไขสินค้า'; $('pfCodeMsg').className = 'hint msg-edit'; $('pfCodeMsg').textContent = 'มีสินค้านี้อยู่แล้ว กำลังแก้ไขตัวเดิม';
  $('pfErr').hidden = true; pfDrawChips(); pfName(); $('pfPrice').focus(); $('pfPrice').select();
}
function pfCheckCode() {
  const c = $('pfCode').value.trim(); if (!c) return;
  if (P.has(c) && c !== PF.code) { pfLoad(c); return; }
  if (!P.has(c)) { PF.code = c; PF.editing = false; $('pfTitle').textContent = 'เพิ่มสินค้าใหม่'; $('pfCodeMsg').className = 'hint msg-ok'; $('pfCodeMsg').textContent = 'รหัสนี้ยังไม่มีในร้าน เพิ่มเป็นสินค้าใหม่ได้'; $('pfBrand').focus(); }
}
function pfSave(next) {
  pfCheckCode();
  const code = $('pfCode').value.trim(), name = $('pfName').value.trim(), price = parseFloat($('pfPrice').value);
  const errs = []; if (!code) errs.push('ยังไม่มีบาร์โค้ด (ยิง หรือกด "เพิ่มรหัสสินค้า")'); if (!name) errs.push('ยังไม่มีชื่อสินค้า'); if (!(price >= 0)) errs.push('ยังไม่ได้ใส่ราคาขาย');
  if (errs.length) { $('pfErr').textContent = errs.join(' · '); $('pfErr').hidden = false; return; }
  let bi = brandIndex($('pfBrand').value); const bv = $('pfBrand').value.trim();
  if (bi < 0 && bv) { BRANDS.push([bv, '', 0]); bi = BRANDS.length - 1; DB.addBrand(bv).catch(fail); pfBrandList(); }
  const size = parseFloat($('pfSize').value); const kg = PF.sizeU === 'kg' ? size : (PF.sizeU === 'g' ? size / 1000 : 0);
  const cost = parseFloat($('pfCost').value), qty = parseInt($('pfQty').value);
  const old = P.get(code);
  const p = { code, name, price, unit: PF.unit, brand: bi, type: PF.type || 'other', animal: PF.animal, big: (PF.unit === 'กระสอบ' || kg >= 5) ? 1 : 0, cost: cost >= 0 ? cost : (old?.cost || 0), supplier: PF.sup, rank: old?.rank || 0, stock: isNaN(qty) ? old?.stock : qty };
  const by = { by: S.seller, email: S.user?.email || '' };
  if (old && old.price !== price) DB.logPrice({ code, name, kind: 'price', old: old.price, new: price, ...by }).catch(() => { });
  if (old && cost >= 0 && (old.cost || 0) !== cost) DB.logPrice({ code, name, kind: 'cost', old: old.cost || 0, new: cost, supplier: PF.sup, ...by }).catch(() => { });
  p.key = mkKey(p); P.set(code, p); if (!old) LIST.push(p); else Object.assign(old, p);
  DB.saveProduct(p).catch(fail);
  S.recent = [{ code, isNew: !old, at: new Date().toISOString() }, ...S.recent.filter(r => r.code !== code)].slice(0, 50); store.set('recent', S.recent);
  renderRecent(); toast(old ? 'บันทึกการแก้ไขแล้ว' : 'เพิ่มสินค้าแล้ว');
  pfClear(!!next);
}
function renderRecent() {
  const box = $('recentList'); box.innerHTML = '';
  for (const r of S.recent) {
    const p = P.get(r.code); if (!p) continue; const b = document.createElement('button'); b.className = 'recent';
    b.innerHTML = `<span class="nm">${esc(p.name)}<div class="hint num">${esc(p.code)} · ${r.isNew ? 'เพิ่มใหม่' : 'แก้ไข'}</div></span><span class="num">${fmt0(p.price)} ฿</span>`;
    b.onclick = () => pfLoad(r.code); box.appendChild(b);
  }
  $('emptyRecent').hidden = S.recent.length > 0; $('recentCount').textContent = S.recent.length ? `(${S.recent.length})` : '';
}
function pfBrandList() { $('brandList').innerHTML = BRANDS.map(b => `<option value="${esc(b[0])}">${esc(b[1])}</option>`).join(''); }
$('pfCode').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); pfCheckCode(); } });
$('pfCode').addEventListener('change', pfCheckCode);
$('pfGen').onclick = () => { $('pfGenBox').hidden = !$('pfGenBox').hidden; };
$('pfRand').onclick = () => { $('pfCode').value = randomCode(); $('pfGenBox').hidden = true; pfCheckCode(); $('pfCodeMsg').textContent += ' (ติดสติกเกอร์บาร์โค้ดนี้ที่สินค้า)'; };
$('pfOwn').onclick = () => { $('pfGenBox').hidden = true; $('pfCode').value = ''; $('pfCode').placeholder = 'พิมพ์รหัสที่ต้องการ แล้วกด Enter'; $('pfCode').focus(); };
['pfBrand', 'pfVariant', 'pfSize', 'pfPrice', 'pfCost'].forEach(id => $(id).addEventListener('input', pfName));
$('pfName').addEventListener('input', () => { PF.nameAuto = false; $('pfAuto').hidden = false; });
$('pfAuto').onclick = () => { PF.nameAuto = true; pfName(); };
$('pfPrice').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); pfSave(false); } });
$('pfSupAdd').onclick = () => addSupplier($('pfSupNew').value); $('pfSupNew').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); addSupplier($('pfSupNew').value); } };
$('pfSave').onclick = () => pfSave(false); $('pfSaveNext').onclick = () => pfSave(true); $('pfReset').onclick = () => pfClear(false);
function prodOpen() { if (!PF.editing && !$('pfCode').value) $('pfCode').focus(); }
function editProduct(code) { closeModal(); tab('prod'); pfLoad(code); }

/* ---------- keys & clock ---------- */
document.addEventListener('keydown', e => {
  if ($('appRoot').hidden) return;
  if (e.key === 'Escape' && modalOpen()) { closeModal(); return; }
  if (modalOpen() || $('viewSell').hidden) return;
  if (e.key === 'F1') { e.preventDefault(); openFinder(''); return; }
  if (e.key === 'F6') { e.preventDefault(); holdBill(); return; }
  const map = { F2: 'cash', F3: 'transfer', F4: 'half' }; if (map[e.key]) { e.preventDefault(); openPay(map[e.key]); }
});
document.addEventListener('click', e => { if (!e.target.closest('input,button,select,.modal,summary,label')) focusQ(); });
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
  for (const b of fb) for (const i of b.items) { const a = agg[i.code] ||= { name: i.name, qty: 0, net: 0, profit: 0, costOk: true }; a.qty += i.qty; a.net += i.price * i.qty; a.profit += (i.price - (i.cost || 0)) * i.qty; if (!i.cost) a.costOk = false; }
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
  for (const i of b.items) { const p = P.get(i.code); T().cart.push({ code: i.code, name: p?.name || i.name, unit: p?.unit || i.unit, price: p ? p.price : i.price, qty: i.qty }); }
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
function setAutoPrint(v) { S.autoPrint = v; store.set('autoPrint', v); $('autoPrintSell').checked = v; $('setAutoPrint').checked = v; }
$('autoPrintSell').onchange = e => { setAutoPrint(e.target.checked); focusQ(); };

/* ---------- scan view (phone): check price, receive goods, count stock ---------- */
const SC = { mode: 'check', cam: null, camOn: false, last: '', lastAt: 0, sup: store.get('rcvSup', ''), rcv: store.get('rcvList', []), counted: store.get('counted', { date: '', list: [] }) };
if (SC.counted.date !== today()) SC.counted = { date: today(), list: [] };
$('scanMode').querySelectorAll('button').forEach(b => b.onclick = () => scanMode(b.dataset.m));
function scanMode(m) {
  SC.mode = m; $('scanMode').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x.dataset.m === m));
  $('modeCheck').hidden = m !== 'check'; $('modeRecv').hidden = m !== 'recv'; $('modeCount').hidden = m !== 'count';
  $('scanMsg').textContent = ''; if (m === 'recv') drawRecv(); if (m === 'count') drawCounted();
}
function loadScanLib() {
  if (window.Html5Qrcode) return Promise.resolve();
  return new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js'; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
}
async function camStart() {
  try {
    $('camBtn').disabled = true; $('scanMsg').textContent = 'กำลังเปิดกล้อง…';
    await loadScanLib();
    const F = Html5QrcodeSupportedFormats;
    $('cam').hidden = false;
    SC.cam = new Html5Qrcode('cam', { formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.ITF], experimentalFeatures: { useBarCodeDetectorIfSupported: true }, verbose: false });
    await SC.cam.start({ facingMode: 'environment' }, { fps: 12, qrbox: (w, h) => ({ width: Math.min(w * .85, 340), height: Math.min(h * .45, 160) }) }, code => onScanned(code), () => { });
    SC.camOn = true; $('camBtn').textContent = 'ปิดกล้อง'; $('scanMsg').textContent = 'ส่องบาร์โค้ดให้อยู่ในกรอบ';
  } catch (e) {
    console.error(e); $('cam').hidden = true;
    $('scanMsg').textContent = 'เปิดกล้องไม่ได้ ตรวจว่าอนุญาตให้เว็บนี้ใช้กล้องแล้ว (หรือพิมพ์บาร์โค้ดในช่องแทน)';
  } finally { $('camBtn').disabled = false; }
}
async function camStop() { try { await SC.cam?.stop(); SC.cam?.clear(); } catch (e) { } SC.camOn = false; $('cam').hidden = true; $('camBtn').textContent = 'เปิดกล้องสแกน'; }
$('camBtn').onclick = () => SC.camOn ? camStop() : camStart();
function onScanned(code) {
  code = String(code).trim(); const now = Date.now();
  if (code === SC.last && now - SC.lastAt < 2500) return;   // same barcode still in front of the camera
  SC.last = code; SC.lastAt = now;
  try { navigator.vibrate?.(60); } catch (e) { }
  handleCode(code);
}
$('scanInput').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return; e.preventDefault();
  const v = e.target.value.trim(); if (!v) return; e.target.value = '';
  if (P.has(v) || /^\d{4,}$/.test(v)) return handleCode(v);
  // a name: pick from the finder, then come back here
  openPicker(v);
});
function openPicker(q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean).map(norm);
  const res = LIST.filter(p => words.every(w => p.key.includes(w))).slice(0, 30);
  const s = openModal(`<h2>เลือกสินค้า</h2>${res.length ? '' : '<p class="hint">ไม่พบสินค้า</p>'}<div class="sups">${res.map((p, i) => `<button class="recent" data-i="${i}"><span class="nm">${esc(p.name)}<div class="hint num">${esc(p.code)}</div></span><span class="num">${fmt0(p.price)} ฿</span></button>`).join('')}</div><div class="mrow"><button class="ghost" id="pkClose">ปิด</button></div>`);
  s.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { closeModal(); handleCode(res[+b.dataset.i].code); });
  s.querySelector('#pkClose').onclick = closeModal;
}
function handleCode(code) {
  const p = P.get(code);
  if (!p) {
    $('scanMsg').innerHTML = `ไม่พบสินค้าบาร์โค้ด <b class="num">${esc(code)}</b> <button class="ghost" id="scanAdd">เพิ่มสินค้าใหม่</button>`;
    $('scanAdd').onclick = () => { camStop(); tab('prod'); pfClear(false); $('pfCode').value = code; pfCheckCode(); };
    return;
  }
  $('scanMsg').textContent = '';
  if (SC.mode === 'check') showCheck(p); else if (SC.mode === 'recv') addRecv(p); else showCount(p);
}

/* check price */
function supRows(p) {
  const list = Object.entries(p.sp || {}).map(([n, v]) => ({ n, c: v.c, d: v.d })).sort((a, b) => a.c - b.c);
  if (!list.length) return '<div class="hint">ยังไม่มีบันทึกต้นทุนแยกร้าน (จะเริ่มมีเมื่อรับของเข้าผ่านหน้านี้)</div>';
  return list.map((x, i) => `<div class="suprow${i === 0 && list.length > 1 ? ' best' : ''}"><span>${esc(x.n)}${i === 0 && list.length > 1 ? ' · ถูกสุด' : ''}</span><span class="num">${fmt0(x.c)} ฿ <span class="hint">${x.d ? x.d.slice(8) + '/' + x.d.slice(5, 7) : ''}</span></span></div>`).join('');
}
async function showCheck(p) {
  $('chkEmpty').hidden = true; const box = $('chkCard'); box.hidden = false;
  const margin = p.cost ? Math.round((p.price - p.cost) / p.price * 100) : null;
  box.innerHTML = `<div class="pcard">
    <h3>${esc(p.name)}</h3><div class="hint num">${esc(p.code)} · ${esc(p.unit)}</div>
    <div class="bigprice num">${fmt0(p.price)} <span style="font-size:20px">บาท</span></div>
    <div class="facts">
      <div class="fact"><div class="k">ต้นทุน</div><div class="v num">${p.cost ? fmt0(p.cost) : '—'}</div></div>
      <div class="fact"><div class="k">กำไร</div><div class="v num">${margin === null ? '—' : margin + '%'}</div></div>
      <div class="fact"><div class="k">สต็อกในระบบ</div><div class="v num">${p.stock ?? '—'}</div></div>
    </div>
    <div class="inrow"><input class="tin num" id="chkPrice" inputmode="decimal" value="${p.price}" style="flex:0 1 140px" aria-label="ราคาใหม่"><button class="ghost" id="chkSave">บันทึกราคาใหม่</button><button class="ghost" id="chkEdit">แก้ข้อมูลสินค้า</button></div>
    <strong>ต้นทุนแต่ละร้าน</strong><div class="sups">${supRows(p)}</div>
    <strong>ประวัติราคา</strong><div class="hist" id="chkHist"><span class="hint">กำลังโหลด…</span></div>
  </div>`;
  $('chkSave').onclick = () => { const v = Math.round(parseFloat($('chkPrice').value) * 100) / 100; if (!(v >= 0) || v === p.price) return; const old = p.price; setProductPrice(p.code, v); toast(`บันทึกราคา ${fmt0(old)} → ${fmt0(v)} บาท`); showCheck(p); };
  $('chkEdit').onclick = () => { camStop(); editProduct(p.code); };
  try {
    const h = await DB.priceHistory(p.code); if ($('chkCard').innerHTML.indexOf(p.code) < 0) return;
    $('chkHist').innerHTML = h.length ? h.slice(0, 12).map(x => { const at = x.at?.toDate ? x.at.toDate() : null; const d = x.new - x.old;
      return `<div class="l" style="display:flex;justify-content:space-between;gap:8px"><span>${at ? at.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : ''} ${x.kind === 'cost' ? 'ต้นทุน' + (x.supplier ? ' (' + esc(x.supplier) + ')' : '') : 'ราคาขาย'}</span><span class="num">${fmt0(x.old)} → ${fmt0(x.new)} <span class="${d > 0 ? 'down' : 'up'}">${d > 0 ? '+' : ''}${fmt0(d)}</span></span></div>`; }).join('')
      : '<span class="hint">ยังไม่เคยเปลี่ยนราคาในระบบใหม่</span>';
  } catch (e) { $('chkHist').innerHTML = '<span class="hint">โหลดประวัติไม่ได้</span>'; }
}

/* receive goods */
function drawRecvSup() {
  const box = $('rcvSup'); box.innerHTML = '';
  const list = supList().slice(); if (SC.sup && !list.includes(SC.sup)) list.push(SC.sup);
  for (const n of list) { const b = document.createElement('button'); b.className = 'chip'; b.textContent = n; b.setAttribute('aria-pressed', SC.sup === n); b.onclick = () => { SC.sup = n; store.set('rcvSup', n); drawRecv(); }; box.appendChild(b); }
  const a = document.createElement('button'); a.className = 'chip add'; a.textContent = '+ ร้านอื่น';
  a.onclick = () => { const s = openModal(`<h2>เพิ่มร้าน</h2><input class="tin" id="newSup" placeholder="ชื่อร้าน"><div class="mrow"><button class="ghost" id="nsNo">ยกเลิก</button><button class="primary" id="nsOk">เพิ่ม</button></div>`);
    s.querySelector('#nsNo').onclick = closeModal; s.querySelector('#newSup').focus();
    s.querySelector('#nsOk').onclick = () => { const v = s.querySelector('#newSup').value.trim(); if (v) { addSupplier(v); SC.sup = v; store.set('rcvSup', v); } closeModal(); drawRecv(); }; };
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
    SC.rcv = []; store.set('rcvList', []); drawRecv(); toast('บันทึกรับของแล้ว สต็อกเพิ่มแล้ว');
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
    p.stock = v; box.innerHTML = `<div class="empty">บันทึก ${esc(p.name.slice(0, 30))} = ${v} แล้ว สแกนตัวต่อไปได้เลย</div>`; drawCounted(); };
  $('cntSave').onclick = save; q.onkeydown = e => { if (e.key === 'Enter') save(); };
}
function drawCounted() {
  $('cntDoneCount').textContent = `(${SC.counted.list.length})`;
  $('cntDone').innerHTML = SC.counted.list.map(x => `<div class="recent"><span class="nm">${esc(x.name)}<div class="hint num">${esc(x.code)}</div></span><span class="num">${x.old ?? '—'} → <b>${x.n}</b></span></div>`).join('') || '<div class="hint" style="padding:8px">ยังไม่ได้นับ</div>';
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
  unsubs.push(DB.watchMeta('brands', d => { const list = d?.list || []; BRANDS = list.map(b => [b.th, b.en || '', 0]); rebuildCatalog(); pfBrandList(); }));
  unsubs.push(DB.watchMeta('settings', d => { if (d) { S.settings = { ...DEFAULT_SETTINGS, ...d }; store.set('settingsCache', S.settings); } renderSellers(); pfDrawChips(); fillSettings(); }));
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
  unsubs.push(DB.watchPriceLog(list => { S.priceLog = list; if (!$('viewBills').hidden) renderBills(); }));
  salesDate = null; watchToday();
}
function showApp() {
  appShown = true; store.set('ready', true);
  $('gate').hidden = true; $('appRoot').hidden = false;
  rebuildCatalog(); renderSellers(); pfDrawChips(); renderRecent(); fillSettings(); setAutoPrint(S.autoPrint); render(); setSync();
  if (matchMedia('(max-width: 700px)').matches) tab('scan'); else focusQ();
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
