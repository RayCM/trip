const fs = require('fs');
const assert = require('assert');

const src = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const grab = (re, label) => {
  const m = src.match(re);
  if (!m) { console.error('FAIL: 找不到 ' + label); process.exit(1); }
  return m[0];
};
const pmSrc = grab(/function parseMD\(str\)\{[\s\S]*?\n\}/, 'parseMD()');
const rdSrc = grab(/function resequenceDates\(\)\{[\s\S]*?\n\}/, 'resequenceDates()');
const mdSrc = grab(/function moveDay\(i,dir\)\{[\s\S]*?\n\}/, 'moveDay()');

let itinerary = [];
function pushField() {}      // 測試用空殼，不碰 Firebase
function renderTimeline() {} // 測試用空殼，不碰 DOM
eval(pmSrc);
eval(rdSrc);
eval(mdSrc);

const mk = () => [
  { date: '10/21', dest: 'A' }, { date: '10/22', dest: 'B' }, { date: '10/23', dest: 'C' },
];
const dates = () => itinerary.map(d => d.date);
const dests = () => itinerary.map(d => d.dest);

let passed = 0;
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; }
}

check('第 1 天往下移，日期不動只有內容互換', () => {
  itinerary = mk();
  moveDay(0, 1);
  assert.deepStrictEqual(dates(), ['10/21', '10/22', '10/23']);
  assert.deepStrictEqual(dests(), ['B', 'A', 'C']);
});

check('第 1 天連按兩次會回到原狀，日期不累加平移', () => {
  itinerary = mk();
  moveDay(0, 1);
  moveDay(0, 1);
  assert.deepStrictEqual(dates(), ['10/21', '10/22', '10/23']);
  assert.deepStrictEqual(dests(), ['A', 'B', 'C']);
});

check('中間往下移，日期釘在位置上', () => {
  itinerary = mk();
  moveDay(1, 1);
  assert.deepStrictEqual(dates(), ['10/21', '10/22', '10/23']);
  assert.deepStrictEqual(dests(), ['A', 'C', 'B']);
});

check('往上移與往下移對稱', () => {
  itinerary = mk();
  moveDay(2, -1);
  assert.deepStrictEqual(dates(), ['10/21', '10/22', '10/23']);
  assert.deepStrictEqual(dests(), ['A', 'C', 'B']);
});

check('超出範圍不做事', () => {
  itinerary = mk();
  moveDay(0, -1);
  moveDay(2, 1);
  assert.deepStrictEqual(dates(), ['10/21', '10/22', '10/23']);
  assert.deepStrictEqual(dests(), ['A', 'B', 'C']);
});

check('移動時順便把本來不連續的資料整理回連續（自我修復）', () => {
  // 起始資料刻意不連續（例如舊版程式或其他 bug 留下的髒資料）
  itinerary = [
    { date: '10/21', dest: 'A' }, { date: '10/25', dest: 'B' }, { date: '11/03', dest: 'C' },
  ];
  moveDay(1, 1);
  assert.deepStrictEqual(dates(), ['10/21', '10/22', '10/23']);
  assert.deepStrictEqual(dests(), ['A', 'C', 'B']);
});

console.log(`\n${passed}/6 passed`);
