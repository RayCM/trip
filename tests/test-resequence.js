const fs = require('fs');
const assert = require('assert');

const path = require('path');
const SRC = path.join(__dirname, '..', 'index.html');
const src = fs.readFileSync(SRC, 'utf8');

const m = src.match(/function resequenceDates\(\)\{[\s\S]*?\n\}/);
if (!m) {
  console.error('FAIL: 在 index.html 找不到 resequenceDates()');
  process.exit(1);
}

// 直接 eval，讓函式綁到本檔案的 itinerary（sloppy mode 下 direct eval 共用作用域）
let itinerary = [];
const pm = src.match(/function parseMD\(str\)\{[\s\S]*?\n\}/);
if (!pm) { console.error('FAIL: 找不到 parseMD()'); process.exit(1); }
eval(pm[0]);
eval(m[0]);

const dates = () => itinerary.map(d => d.date);
let passed = 0;
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; }
}

check('15 天從 10/21 起連續編號，跨月進位正確', () => {
  itinerary = Array.from({ length: 15 }, (_, i) => ({ date: i === 0 ? '10/21' : 'XX/XX' }));
  resequenceDates();
  assert.deepStrictEqual(dates().slice(0, 3), ['10/21', '10/22', '10/23']);
  assert.deepStrictEqual(dates().slice(10, 15), ['10/31', '11/01', '11/02', '11/03', '11/04']);
});

check('對調兩天後日期仍依位置遞增（內容跟著走、日期不跟）', () => {
  itinerary = [
    { date: '10/21', dest: 'A' }, { date: '10/22', dest: 'B' }, { date: '10/23', dest: 'C' },
  ];
  [itinerary[1], itinerary[2]] = [itinerary[2], itinerary[1]];
  resequenceDates();
  assert.deepStrictEqual(dates(), ['10/21', '10/22', '10/23']);
  assert.deepStrictEqual(itinerary.map(d => d.dest), ['A', 'C', 'B']);
});

check('刪除中間一天後日期往前遞補，無缺口', () => {
  itinerary = [
    { date: '10/21' }, { date: '10/22' }, { date: '10/23' }, { date: '10/24' },
  ];
  itinerary.splice(1, 1);
  resequenceDates();
  assert.deepStrictEqual(dates(), ['10/21', '10/22', '10/23']);
});

check('改第 1 天日期，整趟平移', () => {
  itinerary = [{ date: '10/22' }, { date: '10/22' }, { date: '10/23' }];
  resequenceDates();
  assert.deepStrictEqual(dates(), ['10/22', '10/23', '10/24']);
});

check('月與日都補零', () => {
  itinerary = [{ date: '9/8' }, { date: 'x' }];
  resequenceDates();
  assert.deepStrictEqual(dates(), ['09/08', '09/09']);
});

check('清掉存檔的 wd 欄位', () => {
  itinerary = [{ date: '10/21', wd: 5 }, { date: 'x', wd: 6 }];
  resequenceDates();
  assert.ok(!('wd' in itinerary[0]), 'itinerary[0] 仍有 wd');
  assert.ok(!('wd' in itinerary[1]), 'itinerary[1] 仍有 wd');
});

check('空陣列不丟例外', () => {
  itinerary = [];
  resequenceDates();
  assert.deepStrictEqual(itinerary, []);
});

check('錨點日期解析不出來時原樣不動', () => {
  itinerary = [{ date: '' }, { date: '10/22' }];
  resequenceDates();
  assert.deepStrictEqual(dates(), ['', '10/22']);
});

console.log(`\n${passed}/8 passed`);
