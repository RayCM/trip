// 記帳分類清單與清單標題：沒填說明時用「日期 分類」當標題。
const fs = require('fs');
const assert = require('assert');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function grab(re, label) {
  const m = src.match(re);
  if (!m) { console.error('FAIL: 在 index.html 找不到 ' + label); process.exit(1); }
  return m[0];
}

const t = x => x;
eval(grab(/const CATS=\[[\s\S]*?\n\];/, 'CATS').replace('const CATS', 'var CATS'));
eval(grab(/const catById=[^\n]*/, 'catById').replace('const catById', 'var catById'));
eval(grab(/function expenseTitle\(e\)\{[\s\S]*?\n\}/, 'expenseTitle()'));

let passed = 0;
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; }
}

check('分類有早餐、午餐、晚餐、IC卡儲值，原本的餐飲還在', () => {
  const names = CATS.map(c => c.name);
  ['早餐', '午餐', '晚餐', 'IC卡儲值', '餐飲'].forEach(n => assert.ok(names.includes(n), '缺少 ' + n));
});

check('分類的 id 與顏色都不重複', () => {
  assert.strictEqual(new Set(CATS.map(c => c.id)).size, CATS.length);
  assert.strictEqual(new Set(CATS.map(c => c.color)).size, CATS.length);
});

check('不認得的分類歸到「其他」', () => {
  assert.strictEqual(catById('nope').id, 'other');
});

check('沒填說明：標題是「日期 分類」', () => {
  assert.strictEqual(expenseTitle({ cat: 'lunch', date: '2026-11-02', note: '' }), '11/02 午餐');
  assert.strictEqual(expenseTitle({ cat: 'ictopup', date: '2026-10-21' }), '10/21 IC卡儲值');
});

check('有填說明就用說明', () => {
  assert.strictEqual(expenseTitle({ cat: 'dinner', date: '2026-11-02', note: '蓬萊軒' }), '蓬萊軒');
});

check('交通預估沿用它自己的說明', () => {
  assert.strictEqual(expenseTitle({ cat: 'transport', date: '2026-10-21', _seedNote: '機場→名古屋' }), '機場→名古屋');
});

check('日期格式不對時只顯示分類', () => {
  assert.strictEqual(expenseTitle({ cat: 'breakfast', date: '' }), '早餐');
});

console.log(`\n${passed} passed`);
