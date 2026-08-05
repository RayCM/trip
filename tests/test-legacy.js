// 兩個線上資料才會遇到、其他測試沒涵蓋的情境：
// 1. Firebase 上的舊資料是 {zh,en,ja} 物件形狀（t() 的 o.zh fallback 是刻意保留的相容層，要有測試守著）
// 2. 第 1 天日期是非 MM/DD 的舊格式（有些能正確解析，有些會被誤讀成別的月份）
const fs = require('fs');
const assert = require('assert');

const path = require('path');
const SRC = path.join(__dirname, '..', 'index.html');
const src = fs.readFileSync(SRC, 'utf8');

const grab = (re, label) => {
  const m = src.match(re);
  if (!m) { console.error('FAIL: 找不到 ' + label); process.exit(1); }
  return m[0];
};

let itinerary = [];
function pushField() {}
function renderTimeline() {}
const warns = [];
const origWarn = console.warn;

const bundle = [
  grab(/const t=o=>[^\n]*/, 't()'),
  grab(/(function parseMD\(str\)\{[\s\S]*?\n\}\n)?function wdFromDate\(str\)\{[\s\S]*?\n\}/, 'wdFromDate()'),
  grab(/function resequenceDates\(\)\{[\s\S]*?\n\}/, 'resequenceDates()'),
  grab(/function moveDay\(i,dir\)\{[\s\S]*?\n\}/, 'moveDay()'),
  ';({t,wdFromDate,resequenceDates,moveDay})',
].join('\n');

// 外層變數名不能與被 eval 的函式同名：direct eval 會把宣告提升到這個作用域而撞名
const FN = eval(bundle);
const tFn = FN.t, wdFn = FN.wdFromDate, moveDayFn = FN.moveDay;

let passed = 0, total = 0;
const check = (name, fn) => {
  total++;
  warns.length = 0;
  console.warn = m => warns.push(m);
  try { fn(); console.warn = origWarn; console.log('  ✓ ' + name); passed++; }
  catch (e) { console.warn = origWarn; console.log('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; }
};

// ---- 1. 舊資料形狀相容性 ----

check('t() 讀得懂 Firebase 上的 {zh,en,ja} 舊資料', () => {
  assert.strictEqual(tFn({ zh: '雨晴海岸', en: 'Amaharashi Coast', ja: '雨晴海岸' }), '雨晴海岸');
  assert.strictEqual(tFn({ zh: '富山地鐵飯店', url: 'https://maps.app.goo.gl/x' }), '富山地鐵飯店');
  assert.strictEqual(tFn("已經是純字串的新資料"), '已經是純字串的新資料');
  assert.strictEqual(tFn(null), '');
  assert.strictEqual(tFn(undefined), '');
});

check('新舊形狀混雜的行程，移動後內容不遺失、日期正確', () => {
  itinerary = [
    { date: '10/21', dest: { zh: '名古屋', en: 'Nagoya', ja: '名古屋' } },
    { date: '10/22', dest: '犬山城' },
    { date: '10/23', dest: { zh: '富山', en: 'Toyama', ja: '富山' } },
  ];
  moveDayFn(1, 1);
  assert.deepStrictEqual(itinerary.map(d => d.date), ['10/21', '10/22', '10/23']);
  assert.deepStrictEqual(itinerary.map(d => tFn(d.dest)), ['名古屋', '富山', '犬山城']);
  // 物件形狀的那一天搬動後仍是物件，沒有被壓成字串或弄丟
  assert.strictEqual(typeof itinerary[1].dest, 'object');
  assert.strictEqual(itinerary[1].dest.zh, '富山');
});

// ---- 2. 錨點日期的舊格式 ----

const anchorCase = (input, expectDates) => {
  itinerary = [{ date: input }, { date: 'x' }, { date: 'x' }];
  FN.resequenceDates();
  return itinerary.map(d => d.date);
};

check('這些舊格式能被正確解析並正規化', () => {
  [['10/21'], ['10-21'], ['10.21'], ['10月21日'], ['10/21(三)']].forEach(([s]) => {
    assert.deepStrictEqual(anchorCase(s), ['10/21', '10/22', '10/23'], '格式 ' + JSON.stringify(s) + ' 解析錯誤');
  });
});

check('會被誤讀成別的月份的格式必須被擋下，不可靜默改寫全部日期', () => {
  // '2026-10-21' 從位置 2 起會匹配成 26 與 10 → new Date(2026,25,10) 滾成 2028-02-10
  ['2026-10-21', '2026/10/21', '21/10'].forEach(s => {
    const got = anchorCase(s);
    assert.deepStrictEqual(got, [s, 'x', 'x'],
      '格式 ' + JSON.stringify(s) + ' 應被擋下保持原樣，實際變成 ' + JSON.stringify(got));
  });
});

check('錨點無法解析時有 console.warn 提示', () => {
  itinerary = [{ date: '2026-10-21' }, { date: 'x' }];
  FN.resequenceDates();
  assert.ok(warns.length > 0, '沒有發出警告');
  assert.ok(/第 1 天/.test(warns[0]), '警告訊息應提到第 1 天，實際: ' + warns[0]);
});

check('星期：無法解析的日期不應顯示成「一」', () => {
  assert.strictEqual(wdFn('10/21'), 2, '10/21 應為週三（索引 2）');
  assert.ok(wdFn('') < 0, '空字串應回傳負值代表無效，實際: ' + wdFn(''));
  assert.ok(wdFn('abc') < 0, '亂碼應回傳負值代表無效，實際: ' + wdFn('abc'));
  assert.ok(wdFn('2026-10-21') < 0, '會被誤讀的格式應回傳負值，實際: ' + wdFn('2026-10-21'));
});

check('渲染時無效星期不會取到 WD 的第一個值', () => {
  const line = grab(/const wd=wdFromDate\(d\.date\);/, 'renderTimeline 的星期取值');
  const usage = src.match(/\$\{WD\[wd\][^}]*\}/);
  assert.ok(usage, '找不到 WD[wd] 的使用處');
  assert.ok(/\|\|\s*''/.test(usage[0]), 'WD[wd] 應有 ||\'\' 保護，實際: ' + usage[0]);
});

console.log(`\n${passed}/${total} passed`);
