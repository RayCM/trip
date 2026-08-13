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
  R = eval(app + '\n;({groupStays,renderStays,renderFlights,renderAll,STAY_INFO,FLIGHTS,t,esc})');
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

// 15 天的真實行程形狀（只留分組需要的欄位）
const DAYS = [
  { date: '10/21', stay: '名古屋花園皇宮飯店' }, { date: '10/22', stay: '名古屋花園皇宮飯店' },
  { date: '10/23', stay: '富山地鐵飯店' }, { date: '10/24', stay: '富山地鐵飯店' },
  { date: '10/25', stay: '東橫INN 松本站東口' }, { date: '10/26', stay: '東橫INN 松本站東口' },
  { date: '10/27', stay: '東橫INN 松本站東口' }, { date: '10/28', stay: '東橫INN 松本站東口' },
  { date: '10/29', stay: 'Tabino Hotel Satellite' }, { date: '10/30', stay: 'Tabino Hotel Satellite' },
  { date: '10/31', stay: 'Tabino Hotel Satellite' },
  { date: '11/01', stay: '東橫INN 名古屋丸之內' }, { date: '11/02', stay: '東橫INN 名古屋丸之內' },
  { date: '11/03', stay: '東橫INN 名古屋丸之內' },
  { date: '11/04', stay: '溫暖的家' },
];

check('連續住同一間併成一段，晚數正確', () => {
  const g = R.groupStays(DAYS);
  assert.strictEqual(g.length, 5, '應該是 5 段（溫暖的家不算），實際 ' + g.length);
  assert.deepStrictEqual(g.map(x => x.nights), [2, 2, 4, 3, 3]);
  assert.strictEqual(g[0].from, '10/21');
  assert.strictEqual(g[0].to, '10/22');
  assert.strictEqual(g[2].from, '10/25');
  assert.strictEqual(g[2].to, '10/28');
});

check('11/04 溫暖的家不列入宿泊先', () => {
  const g = R.groupStays(DAYS);
  assert.ok(!g.some(x => x.name === '溫暖的家'), '溫暖的家不該出現');
});

check('同一間飯店分成不相鄰的兩段時不會被併起來', () => {
  const g = R.groupStays([
    { date: '10/21', stay: 'A' }, { date: '10/22', stay: 'B' }, { date: '10/23', stay: 'A' },
  ]);
  assert.strictEqual(g.length, 3);
  assert.deepStrictEqual(g.map(x => x.nights), [1, 1, 1]);
});

check('住宿名稱是舊的 {zh,url} 物件時也能分組', () => {
  const g = R.groupStays([
    { date: '10/21', stay: { zh: '富山地鐵飯店', url: 'https://maps.example/x' } },
    { date: '10/22', stay: '富山地鐵飯店' },
  ]);
  assert.strictEqual(g.length, 1, '物件與字串是同一間，應該併成一段');
  assert.strictEqual(g[0].nights, 2);
});

check('住宿欄空白的日子被略過，不產生無名分段', () => {
  const g = R.groupStays([
    { date: '10/21', stay: '富山地鐵飯店' }, { date: '10/22', stay: '' }, { date: '10/23' },
  ]);
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].nights, 1);
});

check('住宿列印出英日名、地址與電話', () => {
  const h = R.renderStays(R.groupStays(DAYS));
  assert.ok(h.includes('Nagoya Garden Palace Hotel'), '缺英文名');
  assert.ok(h.includes('名古屋ガーデンパレス'), '缺日文名');
  assert.ok(h.includes(R.STAY_INFO['名古屋花園皇宮飯店'].addr), '缺地址');
  assert.ok(h.includes(R.STAY_INFO['名古屋花園皇宮飯店'].tel), '缺電話');
});

check('日期區間與晚數都印出來', () => {
  const h = R.renderStays(R.groupStays(DAYS));
  assert.ok(h.includes('10/25 – 10/28'), '缺日期區間');
  assert.ok(h.includes('4 nights'), '缺晚數');
  assert.ok(h.includes('4泊'), '缺日文晚數');
});

check('只住一晚時用單數 night 且不印區間', () => {
  const h = R.renderStays(R.groupStays([{ date: '10/21', stay: '富山地鐵飯店' }]));
  assert.ok(h.includes('1 night ／ 1泊'), '單數形式不對: ' + h);
  assert.ok(!h.includes('–'), '單日不該印日期區間');
});

check('飯店沒登記在 STAY_INFO 時仍列出該段並標未登録', () => {
  const h = R.renderStays(R.groupStays([
    { date: '10/21', stay: '某某新飯店' }, { date: '10/22', stay: '某某新飯店' },
  ]));
  assert.ok(h.includes('某某新飯店'), '飯店名不該消失');
  assert.ok(h.includes('未登録'), '應該標示未登録');
  assert.ok(h.includes('2 nights'), '晚數仍要算');
});

check('飯店名有 HTML 特殊字元時被跳脫', () => {
  const h = R.renderStays(R.groupStays([{ date: '10/21', stay: '<script>x</script>' }]));
  assert.ok(!h.includes('<script>x'), '沒有跳脫: ' + h);
  assert.ok(h.includes('&lt;script&gt;'), '應該跳脫成實體');
});

check('航班兩行都印出班次、日期、時間、機場', () => {
  const h = R.renderFlights();
  assert.ok(h.includes('CX530') && h.includes('CX531'), '缺班次');
  assert.ok(h.includes('10/21') && h.includes('11/04'), '缺日期');
  assert.ok(h.includes('15:30') && h.includes('16:40'), '缺時間');
  assert.ok(h.includes('NGO'), '缺機場');
  assert.ok(h.includes('ARRIVAL') && h.includes('到着'), '缺雙語標籤');
});

check('沒有 Firebase 設定時顯示錯誤，且不產生任何住宿列', () => {
  // eval 當下 FB_READY 就是 false，init 已經跑過
  assert.ok(els['status'], '沒有 status 元素');
  assert.ok(/連不上|設定/.test(els['status'].innerHTML), '錯誤訊息不明確: ' + els['status'].innerHTML);
  assert.strictEqual((els['stays'] && els['stays'].innerHTML) || '', '', '不該印出住宿列');
});

check('renderAll 收到空陣列時顯示錯誤且不印表格', () => {
  R.renderAll([]);
  assert.strictEqual(els['stays'].innerHTML, '', '空資料不該印出住宿列');
  assert.ok(els['status'].innerHTML.length > 0, '空資料應該有錯誤訊息');
});

check('renderAll 收到正常資料時印出住宿與期間', () => {
  R.renderAll(DAYS);
  assert.ok(els['stays'].innerHTML.includes('Nagoya Garden Palace Hotel'), '沒印出住宿');
  assert.ok(els['period'].textContent.includes('10/21'), '期間缺開始日');
  assert.ok(els['period'].textContent.includes('11/04'), '期間缺結束日');
  assert.ok(/15\s*days/.test(els['period'].textContent), '期間缺天數: ' + els['period'].textContent);
});

console.log(`\n${passed}/${total} passed`);
