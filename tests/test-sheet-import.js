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
  grab(/function parseMD\(str\)\{[\s\S]*?\n\}/, 'parseMD()'),
  grab(/function parseCsv\(text\)\{[\s\S]*?\n\}/, 'parseCsv()'),
  grab(/function sheetRowsToDays\(rows\)\{[\s\S]*?\n\}/, 'sheetRowsToDays()'),
  ';({parseCsv,sheetRowsToDays})',
].join('\n'));
const parseCsvFn = FN.parseCsv, toDays = FN.sheetRowsToDays;

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

const HEAD = ['日期', '目的地', '詳細交通與行程細節', '住宿地點', '備註', '訂票網址', '參考資料'];

check('轉換：日期正規化、欄位對應', () => {
  const r = toDays([HEAD, ['10/21(週三)', '名古屋', '搭機', '花園皇宮', '記得帶護照', 'https://x.com', '參考']]);
  assert.deepStrictEqual(r.days, [{
    date: '10/21', dest: '名古屋', trans: '搭機', stay: '花園皇宮',
    note: '記得帶護照', url: 'https://x.com',
  }]);
  assert.deepStrictEqual(r.skipped, []);
});

check('轉換：參考資料欄不匯入', () => {
  const r = toDays([HEAD, ['10/21', 'A', '', '', '', '', '不該出現']]);
  assert.ok(!JSON.stringify(r.days).includes('不該出現'));
});

check('轉換：前後空白會被去掉', () => {
  const r = toDays([HEAD, ['  10/21  ', '  名古屋  ', '', '', '', '', '']]);
  assert.strictEqual(r.days[0].date, '10/21');
  assert.strictEqual(r.days[0].dest, '名古屋');
});

check('轉換：日期無法解析的列被略過並記錄列號', () => {
  const r = toDays([HEAD, ['10/21', 'A', '', '', '', '', ''], ['沒有日期', 'B', '', '', '', '', ''], ['10/23', 'C', '', '', '', '', '']]);
  assert.deepStrictEqual(r.days.map(d => d.dest), ['A', 'C']);
  assert.deepStrictEqual(r.skipped, [3], '第 3 列應被記錄為略過（含標題列的 1-based 列號）');
});

check('轉換：整列空白直接忽略，不計入略過', () => {
  const r = toDays([HEAD, ['10/21', 'A', '', '', '', '', ''], ['', '', '', '', '', '', '']]);
  assert.strictEqual(r.days.length, 1);
  assert.deepStrictEqual(r.skipped, []);
});

check('轉換：重複日期以最後一列為準並記錄', () => {
  const r = toDays([HEAD, ['10/21', '舊的', '', '', '', '', ''], ['10/21', '新的', '', '', '', '', '']]);
  assert.strictEqual(r.days.length, 1);
  assert.strictEqual(r.days[0].dest, '新的');
  assert.deepStrictEqual(r.duplicates, ['10/21']);
});

check('轉換：真實試算表 15 天，日期正規化正確', () => {
  const csv = fs.readFileSync(path.join(__dirname, 'fixtures', 'sheet-sample.csv'), 'utf8');
  const r = toDays(parseCsvFn(csv));
  assert.strictEqual(r.days.length, 15);
  assert.deepStrictEqual(r.skipped, []);
  assert.strictEqual(r.days[0].date, '10/21');
  assert.strictEqual(r.days[14].date, '11/04');
  assert.strictEqual(r.days[3].dest, '金澤車站、兼六園');
  assert.ok(r.days[2].note.includes('きときと市場'), '含換行的備註被截斷');
});

console.log(`\n${passed}/${total} passed`);
