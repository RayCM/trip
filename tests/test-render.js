// 用 DOM stub 在 Node 裡真的跑一次整段主 script（含 init IIFE 與 renderAll），
// 檢查三個分頁的渲染輸出。取代無法執行的瀏覽器驗證。
const fs = require('fs');
const assert = require('assert');

const path = require('path');
const SRC = path.join(__dirname, '..', 'index.html');
const src = fs.readFileSync(SRC, 'utf8');

// 抽出第一個 <script> 區塊（app 主邏輯；第二個是 PWA service worker 註冊）
const blocks = [];
const re = /<script>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(src))) blocks.push(m[1]);
if (!blocks.length) { console.error('FAIL: 找不到 <script> 區塊'); process.exit(1); }
const app = blocks[0];

// ---- DOM stub ----
const els = {};
const mkEl = id => ({
  id, value: '', checked: false, readOnly: false, disabled: false,
  textContent: '', innerHTML: '', lang: '',
  style: {}, dataset: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  addEventListener() {}, setAttribute() {}, getAttribute: () => null,
  appendChild() {}, querySelectorAll: () => [], querySelector: () => null,
});
const store = {};

global.document = {
  documentElement: mkEl('html'),
  getElementById: id => els[id] || (els[id] = mkEl(id)),
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener() {},
};
global.window = { TRIP_CONFIG: undefined, addEventListener() {} };
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
global.alert = () => {};
global.confirm = () => true;
global.navigator = {};

// ---- 執行整段 app script ----
// FB_READY 會是 false（沒有 window.TRIP_CONFIG、沒有 firebase），走本機模式分支
let ranWithoutThrow = true, thrown = null, R = null;
try {
  // 尾端運算式把要檢查的東西交出來
  R = eval(app + '\n;({renderAll,renderTimeline,renderTodos,renderExpenses,applyStatic,updateSeed,itinerary,cd,seedSubHtml,t})');
} catch (e) {
  ranWithoutThrow = false;
  thrown = e;
}

let passed = 0, total = 0;
const check = (name, fn) => {
  total++;
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; }
};

const html = id => (els[id] && els[id].innerHTML) || '';
const text = id => (els[id] && els[id].textContent) || '';

// itinerary 只能就地改動（外部拿到的是同一個陣列引用，重新指派不會影響 eval 作用域內的變數）。
// 跑完復原，否則後面檢查真實 15 天資料的測試會受影響。
const withDays = (days, fn) => {
  const saved = R.itinerary.slice();
  R.itinerary.length = 0;
  days.forEach(d => R.itinerary.push(d));
  R.renderTimeline();
  try { fn(); }
  finally {
    R.itinerary.length = 0;
    saved.forEach(d => R.itinerary.push(d));
    R.renderTimeline();
  }
};

check('整段 script 載入並執行 init 不拋錯', () => {
  assert.ok(ranWithoutThrow, '拋錯: ' + (thrown && thrown.stack));
});

check('頁首：標題與路線列是中文', () => {
  assert.ok(text('eyebrow').length > 0, 'eyebrow 是空的');
  assert.ok(/[一-鿿]/.test(text('eyebrow')), 'eyebrow 沒有中文: ' + text('eyebrow'));
  const route = html('route');
  ['名古屋', '北陸', '信州', '飛驒'].forEach(w =>
    assert.ok(route.includes(w), '路線列缺少 ' + w));
});

check('頁首：地區圖例是中文', () => {
  const rk = html('region-key');
  ['名古屋', '北陸（富山）', '信州（松本）', '飛驒（高山）', '紅葉重點'].forEach(w =>
    assert.ok(rk.includes(w), '地區圖例缺少 ' + w));
});

check('分頁標籤是中文', () => {
  ['tab-trip', 'tab-exp', 'tab-todo'].forEach(id =>
    assert.ok(/[一-鿿]/.test(text(id)), id + ' 沒有中文: ' + text(id)));
});

check('行程頁：15 天都渲染出來', () => {
  const tl = html('timeline');
  assert.ok(tl.length > 1000, '時間軸內容過短: ' + tl.length);
  ['10/21', '10/23', '11/04'].forEach(d =>
    assert.ok(tl.includes(d), '缺少日期 ' + d));
  assert.strictEqual((tl.match(/class="card"/g) || []).length, 15, '卡片數不是 15');
});

check('行程頁：星期標籤正確（10/23 是五、10/24 是六）', () => {
  const tl = html('timeline');
  const wdOf = date => {
    const i = tl.indexOf(date);
    const seg = tl.slice(Math.max(0, i - 200), i);
    const mm = seg.match(/class="wd"[^>]*>([^<]+)</);
    return mm && mm[1];
  };
  assert.strictEqual(wdOf('10/23'), '五');
  assert.strictEqual(wdOf('10/24'), '六');
});

check('行程頁：住宿 Google Maps 連結還在（STAY.url 沒被壓平弄丟）', () => {
  const tl = html('timeline');
  const links = tl.match(/class="stay-link" href="https:\/\/maps\.app\.goo\.gl\/[^"]+"/g) || [];
  assert.ok(links.length >= 14, '住宿連結只有 ' + links.length + ' 個，應該至少 14 個（15 天扣掉最後一天「溫暖的家」）');
});

check('行程頁：住宿名稱是中文', () => {
  const tl = html('timeline');
  ['名古屋花園皇宮飯店', '富山地鐵飯店', '東橫 INN 松本站東口', '溫暖的家 ♡'].forEach(n =>
    assert.ok(tl.includes(n), '缺少住宿 ' + n));
});

check('行程卡片：有雨天備案時顯示該列', () => {
  withDays([{ date: '10/21', dest: 'A', trans: 'T', stay: 'S', rain: '逛地下街' }], () => {
    const tl = html('timeline');
    assert.ok(tl.includes('逛地下街'), '雨天備案內容沒有渲染出來');
    assert.ok(tl.includes('雨天備案'), '標籤要是看得懂的文字，不是只有符號');
  });
});

check('行程卡片：沒有雨天備案時不渲染空列', () => {
  withDays([{ date: '10/21', dest: 'A', trans: 'T', stay: 'S' }], () => {
    assert.ok(!html('timeline').includes('雨天備案'), '空值不能渲染出空白列');
  });
});

check('行程卡片：備註列的標籤是文字而非符號', () => {
  withDays([{ date: '10/21', dest: 'A', trans: 'T', stay: 'S', note: '記得帶護照' }], () => {
    const tl = html('timeline');
    assert.ok(tl.includes('記得帶護照'));
    assert.ok(tl.includes('備註'), '備註標籤要是文字');
    assert.ok(!tl.includes('✿'), '符號看不出是備註，已改成文字標籤');
  });
});

check('行程卡片：參考資料渲染成連結', () => {
  withDays([{ date: '10/21', dest: 'A', trans: 'T', stay: 'S', ref: 'https://ref.com' }], () => {
    const tl = html('timeline');
    assert.ok(tl.includes('href="https://ref.com"'));
    assert.ok(tl.includes('參考資料'));
  });
});

check('行程卡片：沒有參考資料時不渲染按鈕', () => {
  withDays([{ date: '10/21', dest: 'A', trans: 'T', stay: 'S' }], () => {
    assert.ok(!html('timeline').includes('reflink'), '空值不能渲染出空按鈕');
  });
});

check('記帳頁：分類名稱是中文', () => {
  const opts = html('e-cat');
  ['交通', '住宿', '餐飲', '門票・活動', '購物', '其他'].forEach(n =>
    assert.ok(opts.includes(n), '分類選單缺少 ' + n));
});

check('記帳頁：交通預估說明文字正常且金額有算出來', () => {
  const sub = html('seed-sub') || text('seed-sub');
  assert.ok(sub.includes('依官網最新票價估算 17 段交通'), '預估說明文字不對: ' + sub.slice(0, 80));
  assert.ok(/¥[\d,]+/.test(sub), '預估說明沒有算出金額: ' + sub.slice(0, 120));
});

check('待辦頁：9 項待辦都是中文', () => {
  const td = html('todo-list');
  ['立山黑部 早鳥票（官網）', 'JR 特急飛驒 3 號（名古屋→富山）', '馬籠・妻籠 VIP LINER 一日遊'].forEach(n =>
    assert.ok(td.includes(n), '待辦缺少 ' + n));
  assert.strictEqual((td.match(/class="ti-ttl"/g) || []).length, 9, '待辦數不是 9');
});

check('待辦頁：倒數文字是中文', () => {
  const td = html('todo-list');
  assert.ok(/剩 \d+ 天|明天|今天！|已過 \d+ 天/.test(td), '找不到中文倒數文字');
});

check('html lang 屬性是 zh-Hant', () => {
  assert.strictEqual(document.documentElement.lang, 'zh-Hant');
});

check('全部渲染輸出裡沒有殘留的英文介面文字', () => {
  const all = ['timeline', 'todo-list', 'route', 'region-key', 'e-cat', 'seed-sub']
    .map(id => html(id) + ' ' + text(id)).join(' ');
  ['Nagoya', 'Hokuriku', 'Transport', 'Lodging', 'Book on JR', 'days left', 'Tomorrow']
    .forEach(w => assert.ok(!all.includes(w), '渲染輸出殘留英文: ' + w));
});

console.log(`\n${passed}/${total} passed`);
