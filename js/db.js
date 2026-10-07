// Data layer: Firebase Auth + Firestore (works offline, syncs when back online).
// Catalog is stored in 16 "chunk" documents (catalog/c00..c15), each holding a map of products,
// so a device loads the whole catalog with 16 reads instead of 6,000.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut }
  from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, onSnapshot,
  setDoc, writeBatch, increment, serverTimestamp, query, where, orderBy, limit, addDoc, getDoc, getDocs, arrayUnion }
  from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './config.js?v=7';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

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
  return { code, name: o.n, unit: o.u, price: o.p, cost: o.c, brand: o.b, type: o.t, animal: o.a, big: o.g, supplier: o.s, rank: o.r || 0, stock: o.st };
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
export function patchProduct(code, fields) { return setDoc(chunkRef(code), { items: { [code]: fields } }, { merge: true }); }
export function logPrice(entry) { return addDoc(collection(db, 'priceLog'), { ...entry, at: serverTimestamp() }); }
export function watchPriceLog(cb) {
  return onSnapshot(query(collection(db, 'priceLog'), orderBy('at', 'desc'), limit(100)), s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))));
}

/* ---------- meta: settings, brands, staff ---------- */
export function watchMeta(name, cb, onErr) { return onSnapshot(doc(db, 'meta', name), s => cb(s.exists() ? s.data() : null), onErr); }
export function saveMeta(name, data) { return setDoc(doc(db, 'meta', name), data, { merge: true }); }
export function addBrand(th, en) { return setDoc(doc(db, 'meta', 'brands'), { list: arrayUnion({ th, en: en || '' }) }, { merge: true }); }
export async function catalogReady() { const s = await getDoc(doc(db, 'meta', 'info')); return s.exists() && !!s.data().imported; }

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
