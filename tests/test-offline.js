// 離線時要看得到上次載入的行程，但不能編輯。
// 這條路徑最危險：畫面上的快取若被當成真資料寫回 Firebase，會蓋掉同行者的內容。
// 所以除了「畫得出來」，更要釘住「dataLoaded 不會被誤設成 true」。
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = path.join(__dirname, '..', 'index.html');
const src = fs.readFileSync(SRC, 'utf8');
const grab = (re, label) => {
  const m = src.match(re);
  if (!m) { console.error('FAIL: 找不到 ' + label); process.exit(1); }
  return m[0];
};

const dataBlock = src.slice(src.indexOf('const WD='), src.indexOf('const SEED_TOTAL='));

// ---- 環境替身 ----
const store = {};
let localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
const els = {};
let document = {
  getElementById: id => els[id] || (els[id] = { id, value: '', textContent: '', innerHTML: '', style: {}, className: '' }),
};

// ---- 受測程式碼會用到的全域 ----
let expenses = [], todoState = {}, rate = 0.21, itinerary = [], members = [], dataLoaded = false;
let renderCount = 0;
let renderAll = () => { renderCount++; };

const FN = eval([
  dataBlock,
  grab(/const mem=\{\};/, 'mem'),
  grab(/const HAS_LS=[^\n]*/, 'HAS_LS'),
  grab(/function lsGet\(k,fb\)\{[^\n]*/, 'lsGet()'),
  grab(/function lsSet\(k,v\)\{[^\n]*/, 'lsSet()'),
  grab(/function clone\(x\)\{[^\n]*/, 'clone()'),
  grab(/function applySnapshot\(d\)\{[\s\S]*?\n\}/, 'applySnapshot()'),
  grab(/function cacheSnapshot\(v\)\{[\s\S]*?\n\}/, 'cacheSnapshot()'),
  grab(/function showCachedIfAny\(\)\{[\s\S]*?\n\}/, 'showCachedIfAny()'),
  ';({cacheSnapshot,showCachedIfAny,lsGet,DEFAULT_DAYS})',
].join('\n'));

let passed = 0, total = 0;
const check = (name, fn) => {
  total++;
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; }
};
const reset = () => {
  Object.keys(store).forEach(k => delete store[k]);
  expenses = []; todoState = {}; itinerary = []; members = [];
  dataLoaded = false; renderCount = 0;
};

const SNAP = {
  itinerary: [{ date: '10/21', dest: '快取裡的目的地', trans: 'T', stay: 'S' }],
  expenses: [{ id: 'e1', amount: 100, cur: 'JPY', cat: 'transport', date: '2026-10-21' }],
  todos: { tk: true },
  settings: { rate: 0.22 },
};

check('cacheSnapshot：把 Firebase 快照鏡射到 localStorage', () => {
  reset();
  FN.cacheSnapshot(SNAP);
  assert.deepStrictEqual(FN.lsGet('trip:shared', null), SNAP);
});

check('cacheSnapshot：null 不寫入，避免用空值蓋掉既有快取', () => {
  reset();
  FN.cacheSnapshot(SNAP);
  FN.cacheSnapshot(null);
  assert.deepStrictEqual(FN.lsGet('trip:shared', null), SNAP, '既有快取不該被清掉');
});

check('showCachedIfAny：有快取時畫出快取的行程並回傳 true', () => {
  reset();
  FN.cacheSnapshot(SNAP);
  const used = FN.showCachedIfAny();
  assert.strictEqual(used, true);
  assert.strictEqual(itinerary.length, 1);
  assert.strictEqual(itinerary[0].dest, '快取裡的目的地');
  assert.strictEqual(renderCount, 1, '應該重畫一次');
});

check('★ showCachedIfAny：畫出快取後 dataLoaded 仍為 false（寫入鎖不能被解開）', () => {
  reset();
  FN.cacheSnapshot(SNAP);
  FN.showCachedIfAny();
  assert.strictEqual(dataLoaded, false,
    '快取只能看不能寫——解開鎖會讓離線編輯把快取寫回 Firebase 蓋掉同行者的資料');
});

check('★ showCachedIfAny：沒快取時回傳 false，不能拿 DEFAULT_DAYS 頂替', () => {
  reset();
  const used = FN.showCachedIfAny();
  assert.strictEqual(used, false);
  assert.deepStrictEqual(itinerary, [],
    'applySnapshot(null) 會退回 DEFAULT_DAYS，畫出來會讓人以為是自己的行程');
  assert.strictEqual(renderCount, 0, '沒東西可畫就不該重畫');
});

check('showCachedIfAny：快取是壞掉的 JSON 時當作沒有快取', () => {
  reset();
  store['trip:shared'] = '{壞掉的';
  assert.strictEqual(FN.showCachedIfAny(), false);
  assert.deepStrictEqual(itinerary, []);
});

console.log(`\n${passed}/${total} passed`);
