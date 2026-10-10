// Data layer: Firebase Auth + Firestore (works offline, syncs when back online).
// Catalog is stored in 16 "chunk" documents (catalog/c00..c15), each holding a map of products,
// so a device loads the whole catalog with 16 reads instead of 6,000.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut }
  from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, persistentSingleTabManager, memoryLocalCache, doc, collection, onSnapshot,
  setDoc, deleteDoc, writeBatch, increment, serverTimestamp, query, where, orderBy, limit, addDoc, getDoc, getDocs, arrayUnion, deleteField }
  from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './config.js?v=65';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// iPhone/iPad Safari is more reliable with a single-tab offline cache; if the offline cache can't start, run without it
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let db;
try {
  db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true,
    localCache: persistentLocalCache({ tabManager: isIOS ? persistentSingleTabManager({}) : persistentMultipleTabManager() }) });
} catch (e) {
  console.warn('offline cache unavailable', e);
  db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true, localCache: memoryLocalCache() });
}
// wipe this device's offline copy (used by the "reset" button when loading gets stuck)
export async function resetLocalCache() {
  try { const dbs = await indexedDB.databases?.() || []; await Promise.all(dbs.filter(d => d.name?.startsWith('firestore')).map(d => new Promise(r => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = r; }))); } catch (e) { }
}

export const CHUNKS = 16;
export function chunkOf(code) { let h = 0; for (const ch of String(code)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return 'c' + String(h % CHUNKS).padStart(2, '0'); }
const chunkRef = code => doc(db, 'catalog', chunkOf(code));

/* product <-> stored short form */
export function packProduct(p) {
  const o = { n: p.name, u: p.unit || '', p: +p.price || 0, c: +p.cost || 0, b: p.brand ?? -1, t: p.type || 'other', a: p.animal || '', g: p.big ? 1 : 0, s: p.supplier || '', r: p.rank || 0 };
  if (p.stock !== undefined && p.stock !== null && !Number.isNaN(p.stock)) o.st = p.stock;
  return o;
}
export function unpackProduct(code, o) {
  return { code, name: o.n, unit: o.u, price: o.p, cost: o.c, brand: o.b, type: o.t, animal: o.a, big: o.g, supplier: o.s, rank: o.r || 0, stock: o.st, sp: o.sp || {} };
}

/* ---------- auth ---------- */
export function watchAuth(cb) { return onAuthStateChanged(auth, cb); }
export async function login() {
  const pr = new GoogleAuthProvider(); pr.setCustomParameters({ prompt: 'select_account' });
  try { await signInWithPopup(auth, pr); }
  catch (e) { if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') await signInWithRedirect(auth, pr); else throw e; }
}
export const logout = () => signOut(auth);

/* ---------- catalog ---------- */
// cb(chunkId, items:{code:obj}, fromCache, hasPendingWrites)
export function watchCatalog(cb, onErr) {
  const unsubs = [];
  for (let i = 0; i < CHUNKS; i++) {
    const id = 'c' + String(i).padStart(2, '0');
    unsubs.push(onSnapshot(doc(db, 'catalog', id), { includeMetadataChanges: true },
      s => cb(id, (s.exists() && s.data().items) || {}, s.metadata.fromCache, s.metadata.hasPendingWrites), onErr));
  }
  return () => unsubs.forEach(u => u());
}
export function saveProduct(p) { return setDoc(chunkRef(p.code), { items: { [p.code]: packProduct(p) } }, { merge: true }); }
export function deleteProduct(code) { return setDoc(chunkRef(code), { items: { [code]: deleteField() } }, { merge: true }); }
export function patchProduct(code, fields) { return setDoc(chunkRef(code), { items: { [code]: fields } }, { merge: true }); }
export function logPrice(entry) { return addDoc(collection(db, 'priceLog'), { ...entry, at: serverTimestamp() }); }
export function watchPriceLog(cb) {
  return onSnapshot(query(collection(db, 'priceLog'), orderBy('at', 'desc'), limit(100)), s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))));
}

/* ---------- meta: settings, brands, staff ---------- */
export function watchMeta(name, cb, onErr) { return onSnapshot(doc(db, 'meta', name), s => cb(s.exists() ? s.data() : null), onErr); }
export function saveMeta(name, data) { return setDoc(doc(db, 'meta', name), data, { merge: true }); }
export function addBrand(th, en) { return setDoc(doc(db, 'meta', 'brands'), { list: arrayUnion({ th, en: en || '', al: [] }) }, { merge: true }); }
export function setBrands(list) { return setDoc(doc(db, 'meta', 'brands'), { list }); }
export async function getMeta(name) { const s = await getDoc(doc(db, 'meta', name)); return s.exists() ? s.data() : null; }
// several product fields at once, grouped into one write per catalog chunk
export async function patchMany(map) {
  const byChunk = {};
  for (const [code, f] of Object.entries(map)) (byChunk[chunkOf(code)] ||= {})[code] = f;
  for (const [c, items] of Object.entries(byChunk)) await setDoc(doc(db, 'catalog', c), { items }, { merge: true });
}
// rename a supplier on every product that uses it (main supplier and per-supplier cost list)
export function renameSupplier(oldN, newN, list) {
  const map = {};
  for (const it of list) { const f = {}; if (it.s) f.s = newN; if (it.sp) f.sp = { [newN]: it.sp, [oldN]: deleteField() }; map[it.code] = f; }
  return patchMany(map);
}
export async function catalogReady() { const s = await getDoc(doc(db, 'meta', 'info')); return s.exists() && !!s.data().imported; }

/* ---------- shopping list (ของหมด) ---------- */
export function watchBuy(cb, onErr) { return onSnapshot(collection(db, 'buylist'), s => cb(s.docs.map(d => ({ ...d.data(), id: d.id }))), onErr); }
export function saveBuy(item) { const { id, ...rest } = item; return setDoc(doc(db, 'buylist', id), rest, { merge: true }); }
export function delBuy(ids) { const b = writeBatch(db); for (const id of ids) b.delete(doc(db, 'buylist', id)); return b.commit(); }

/* ---------- sales ---------- */
// daily/{date} keeps running totals so month/year reports read one doc per day, not every bill
function dailyDelta(bill, sign) {
  const cost = bill.items.reduce((s, i) => s + (i.cost || 0) * i.qty, 0);
  return { date: bill.date, bills: increment(sign), net: increment(sign * bill.net), cost: increment(sign * cost),
    m: { [bill.method]: increment(sign * bill.net) }, s: { [bill.seller || '-']: increment(sign * bill.net) } };
}
export function saveSale(bill) {
  const b = writeBatch(db);
  b.set(doc(db, 'sales', bill.id), { ...bill, createdAt: serverTimestamp() });
  b.set(doc(db, 'daily', bill.date), dailyDelta(bill, 1), { merge: true });
  const byChunk = {};
  for (const it of bill.items) { if (!it.known) continue; const c = chunkOf(it.code); (byChunk[c] ||= {})[it.code] = { st: increment(-it.qty) }; }
  for (const [c, items] of Object.entries(byChunk)) b.set(doc(db, 'catalog', c), { items }, { merge: true });
  return b.commit();
}
export function cancelSale(bill) {
  const b = writeBatch(db);
  b.set(doc(db, 'sales', bill.id), { cancelled: true, cancelledAt: serverTimestamp() }, { merge: true });
  b.set(doc(db, 'daily', bill.date), dailyDelta(bill, -1), { merge: true });
  const byChunk = {};
  for (const it of bill.items) { if (!it.known) continue; const c = chunkOf(it.code); (byChunk[c] ||= {})[it.code] = { st: increment(it.qty) }; }
  for (const [c, items] of Object.entries(byChunk)) b.set(doc(db, 'catalog', c), { items }, { merge: true });
  return b.commit();
}
export function watchSales(date, cb, onErr) {
  return onSnapshot(query(collection(db, 'sales'), where('date', '==', date)), { includeMetadataChanges: true },
    s => cb(s.docs.map(d => ({ ...d.data(), id: d.id, pending: d.metadata.hasPendingWrites }))), onErr);
}

export async function getSalesRange(from, to) {
  const s = await getDocs(query(collection(db, 'sales'), where('date', '>=', from), where('date', '<=', to)));
  return s.docs.map(d => ({ ...d.data(), id: d.id }));
}
export async function getDaily(from, to) {
  const s = await getDocs(query(collection(db, 'daily'), where('date', '>=', from), where('date', '<=', to)));
  return s.docs.map(d => d.data());
}
// old program's history, stored apart from live totals (field "lg") so importing twice never double-counts
export async function importHistory(days, progress) {
  for (let i = 0; i < days.length; i += 400) {
    const b = writeBatch(db);
    for (const d of days.slice(i, i + 400)) b.set(doc(db, 'daily', d.date), { date: d.date, lg: { bills: d.bills, net: d.net, cost: d.cost, m: d.m || {} } }, { merge: true });
    await b.commit(); progress?.(Math.min(i + 400, days.length), days.length);
  }
  await setDoc(doc(db, 'meta', 'info'), { history: days.length, historyFrom: days[0]?.date || '' }, { merge: true });
}

/* ---------- receiving goods & stock counts ---------- */
// one delivery from one supplier: adds stock, records this supplier's cost, logs cost changes
export function receiveGoods(rec) {
  const b = writeBatch(db);
  const id = rec.date.replace(/-/g, '') + '-' + Date.now().toString(36);
  b.set(doc(db, 'receipts', id), { ...rec, createdAt: serverTimestamp() });
  const byChunk = {};
  for (const it of rec.items) {
    const c = chunkOf(it.code);
    const f = { st: increment(it.qty) };
    if (it.cost > 0) { f.c = it.cost; f.s = rec.supplier; f.sp = { [rec.supplier]: { c: it.cost, d: rec.date } }; }
    (byChunk[c] ||= {})[it.code] = f;
    if (it.cost > 0 && it.cost !== it.oldCost) b.set(doc(collection(db, 'priceLog')), { code: it.code, name: it.name, kind: 'cost', old: it.oldCost || 0, new: it.cost, supplier: rec.supplier, email: rec.email || '', at: serverTimestamp() });
  }
  for (const [c, items] of Object.entries(byChunk)) b.set(doc(db, 'catalog', c), { items }, { merge: true });
  return b.commit();
}
export function setStock(code, name, oldQty, newQty, email) {
  const b = writeBatch(db);
  b.set(chunkRef(code), { items: { [code]: { st: newQty, sc: new Date().toISOString().slice(0, 10) } } }, { merge: true });
  b.set(doc(collection(db, 'stockLog')), { code, name, old: oldQty ?? null, new: newQty, email: email || '', at: serverTimestamp() });
  return b.commit();
}
export async function priceHistory(code) {
  const s = await getDocs(query(collection(db, 'priceLog'), where('code', '==', code)));
  return s.docs.map(d => d.data()).sort((a, b) => (b.at?.seconds || 0) - (a.at?.seconds || 0));
}

/* ---------- first-time import ---------- */
export async function importCatalog(data, ownerEmail, progress) {
  const chunks = {};
  for (const r of data.p) {
    const [code, name, unit, price, rank, brand, type, animal, big, cost, sup] = r;
    const p = { code, name, unit, price, rank, brand, type, animal, big, cost, supplier: data.s[sup] || '' };
    (chunks[chunkOf(code)] ||= {})[code] = packProduct(p);
  }
  let n = 0;
  for (const [c, items] of Object.entries(chunks)) {
    await setDoc(doc(db, 'catalog', c), { items }); n++; progress?.(n, Object.keys(chunks).length);
  }
  await setDoc(doc(db, 'meta', 'brands'), { list: data.b.map(([th, en]) => ({ th, en: en || '' })) });
  await setDoc(doc(db, 'meta', 'settings'), data.settings || {}, { merge: true });
  await setDoc(doc(db, 'meta', 'info'), { imported: true, at: serverTimestamp(), by: ownerEmail, count: data.p.length });
}
