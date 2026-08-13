// 沿用 test-render.js 的手法：抽出 customs.html 的 inline <script> 在 Node 裡 eval，
// 測到的是真正會跑的程式碼，不需要建置流程或測試框架。
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = path.join(__dirname, '..', 'customs.html');
const src = fs.readFileSync(SRC, 'utf8');

// 帶 src 屬性的 <script src="..."> 不會被這個 regex 匹配到，抓到的是 inline 那段
const blocks = [];
const re = /<script>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(src))) blocks.push(m[1]);
if (!blocks.length) { console.error('FAIL: 找不到 <script> 區塊'); process.exit(1); }
const app = blocks[0];

// ---- DOM stub ----
const els = {};
const mkEl = id => ({
  id, textContent: '', innerHTML: '', style: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  addEventListener() {},
});
global.document = {
  documentElement: mkEl('html'),
  getElementById: id => els[id] || (els[id] = mkEl(id)),
  addEventListener() {},
};
global.window = { TRIP_CONFIG: undefined, addEventListener() {} };
global.navigator = {};

// FB_READY 會是 false（沒有 window.TRIP_CONFIG、沒有 firebase），走「連不上」分支
let ranWithoutThrow = true, thrown = null, R = null;
try {
  R = eval(app + '\n;({groupStays,renderStays,renderFlights,STAY_INFO,FLIGHTS,t,esc})');
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

check('整段 script 載入並執行不拋錯', () => {
  assert.ok(ranWithoutThrow, '拋錯: ' + (thrown && thrown.stack));
});

check('五間住宿都有地址與電話，溫暖的家標記為 skip', () => {
  ['名古屋花園皇宮飯店', '富山地鐵飯店', '東橫INN 松本站東口',
   'Tabino Hotel Satellite', '東橫INN 名古屋丸之內'].forEach(n => {
    const i = R.STAY_INFO[n];
    assert.ok(i, '缺少 ' + n);
    assert.ok(i.en && i.ja, n + ' 缺英文或日文名');
    assert.ok(i.addr && i.addr.length > 5, n + ' 缺地址');
    assert.ok(i.tel && /\d/.test(i.tel), n + ' 缺電話');
    // 骨架階段的佔位值（〒000-0000 / 052-000-0000）必須被換掉，
    // 否則假地址會一路留到印出來的那張紙上，而測試還是綠的
    assert.ok(!/000-0000/.test(i.addr), n + ' 的地址還是佔位值');
    assert.ok(!/000-0000/.test(i.tel), n + ' 的電話還是佔位值');
    assert.ok(/〒\d{3}-\d{4}/.test(i.addr), n + ' 的地址缺郵遞區號');
  });
  assert.strictEqual(R.STAY_INFO['溫暖的家'].skip, true);
});

check('航班有進出境兩筆', () => {
  assert.strictEqual(R.FLIGHTS.length, 2);
  assert.strictEqual(R.FLIGHTS[0].no, 'CX530');
  assert.strictEqual(R.FLIGHTS[1].no, 'CX531');
});

console.log(`\n${passed}/${total} passed`);
