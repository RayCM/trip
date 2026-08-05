const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = path.join(__dirname, '..', 'index.html');
const src = fs.readFileSync(SRC, 'utf8');

const grab = (re, label) => {
  const m = src.match(re);
  if (!m) { console.error('FAIL: 在 index.html 找不到 ' + label); process.exit(1); }
  return m[0];
};

const FN = eval([
  grab(/function parseCsv\(text\)\{[\s\S]*?\n\}/, 'parseCsv()'),
  ';({parseCsv})',
].join('\n'));
const parseCsvFn = FN.parseCsv;

let passed = 0, total = 0;
const check = (name, fn) => {
  total++;
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; }
};

check('基本的逗號分隔', () => {
  assert.deepStrictEqual(parseCsvFn('a,b,c\n1,2,3'), [['a', 'b', 'c'], ['1', '2', '3']]);
});

check('引號包住的儲存格', () => {
  assert.deepStrictEqual(parseCsvFn('"a","b"\n"c","d"'), [['a', 'b'], ['c', 'd']]);
});

check('儲存格內的逗號', () => {
  assert.deepStrictEqual(parseCsvFn('"上午，下午",b'), [['上午，下午', 'b']]);
  assert.deepStrictEqual(parseCsvFn('"a,b",c'), [['a,b', 'c']]);
});

check('儲存格內的換行', () => {
  assert.deepStrictEqual(parseCsvFn('"第一行\n第二行",b'), [['第一行\n第二行', 'b']]);
});

check('跳脫的雙引號', () => {
  assert.deepStrictEqual(parseCsvFn('"他說""好""",b'), [['他說"好"', 'b']]);
});

check('空儲存格', () => {
  assert.deepStrictEqual(parseCsvFn('a,,c'), [['a', '', 'c']]);
  assert.deepStrictEqual(parseCsvFn(',,'), [['', '', '']]);
});

check('CRLF 換行', () => {
  assert.deepStrictEqual(parseCsvFn('a,b\r\nc,d'), [['a', 'b'], ['c', 'd']]);
});

check('結尾沒有換行', () => {
  assert.deepStrictEqual(parseCsvFn('a,b'), [['a', 'b']]);
});

check('空字串', () => {
  assert.deepStrictEqual(parseCsvFn(''), []);
});

check('真實試算表：15 列資料、7 個欄位', () => {
  const csv = fs.readFileSync(path.join(__dirname, 'fixtures', 'sheet-sample.csv'), 'utf8');
  const rows = parseCsvFn(csv).filter(r => r.some(c => c.trim()));
  assert.strictEqual(rows.length, 16, '應為 1 列標題 + 15 列資料');
  assert.deepStrictEqual(rows[0], ['日期', '目的地', '詳細交通與行程細節', '住宿地點', '備註', '訂票網址', '參考資料']);
  assert.strictEqual(rows[1][0], '10/21(週三)');
  assert.strictEqual(rows[15][0], '11/04(週三)');
  // 含換行與逗號的長儲存格必須完整
  assert.ok(rows[3][4].includes('きときと市場'), '10/23 的備註被截斷了');
});

console.log(`\n${passed}/${total} passed`);
