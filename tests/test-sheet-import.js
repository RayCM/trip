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

// diffSheet 內部用 t() 取值（app 端欄位可能還是舊的 {zh,en,ja} 物件）也用 SHEET_FIELDS
// 決定比對哪些欄位，兩者都不在函式本體裡，必須各自抽出來一起 eval
const FN = eval([
  grab(/const t=o=>[^\n]*/, 't()'),
  grab(/function parseMD\(str\)\{[\s\S]*?\n\}/, 'parseMD()'),
  grab(/function parseCsv\(text\)\{[\s\S]*?\n\}/, 'parseCsv()'),
  grab(/function sheetRowsToDays\(rows\)\{[\s\S]*?\n\}/, 'sheetRowsToDays()'),
  grab(/const SHEET_FIELDS=[^\n]*/, 'SHEET_FIELDS'),
  grab(/function diffSheet\(sheetDays,list\)\{[\s\S]*?\n\}/, 'diffSheet()'),
  ';({parseCsv,sheetRowsToDays,diffSheet})',
].join('\n'));
const parseCsvFn = FN.parseCsv, toDays = FN.sheetRowsToDays, diffFn = FN.diffSheet;

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

const mkDay = o => Object.assign({ date: '10/21', dest: 'A', trans: 'T', stay: 'S', note: 'N', url: 'U' }, o);

check('差異：完全相同時回空清單', () => {
  const app = [mkDay({})];
  const sheet = [{ date: '10/21', dest: 'A', trans: 'T', stay: 'S', note: 'N', url: 'U' }];
  assert.deepStrictEqual(diffFn(sheet, app), []);
});

check('差異：只列出真的有差的欄位', () => {
  const app = [mkDay({})];
  const sheet = [{ date: '10/21', dest: '改過了', trans: 'T', stay: 'S', note: 'N', url: 'U' }];
  const d = diffFn(sheet, app);
  assert.strictEqual(d.length, 1);
  assert.deepStrictEqual(
    { kind: d[0].kind, date: d[0].date, field: d[0].field, from: d[0].from, to: d[0].to, checked: d[0].checked },
    { kind: 'change', date: '10/21', field: 'dest', from: 'A', to: '改過了', checked: true });
});

check('差異：順序不同仍能依日期配對', () => {
  const app = [mkDay({ date: '10/21', dest: 'A' }), mkDay({ date: '10/22', dest: 'B' })];
  const sheet = [
    { date: '10/22', dest: 'B', trans: 'T', stay: 'S', note: 'N', url: 'U' },
    { date: '10/21', dest: '改過了', trans: 'T', stay: 'S', note: 'N', url: 'U' },
  ];
  const d = diffFn(sheet, app);
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].date, '10/21');
});

check('差異：空儲存格視為刪除', () => {
  const app = [mkDay({ url: 'https://x.com' })];
  const sheet = [{ date: '10/21', dest: 'A', trans: 'T', stay: 'S', note: 'N', url: '' }];
  const d = diffFn(sheet, app).filter(x => x.field === 'url');
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].to, '');
});

check('差異：試算表多一天標為 add，預設不勾選', () => {
  const app = [mkDay({})];
  const sheet = [
    { date: '10/21', dest: 'A', trans: 'T', stay: 'S', note: 'N', url: 'U' },
    { date: '10/22', dest: '新的一天', trans: '', stay: '', note: '', url: '' },
  ];
  const d = diffFn(sheet, app);
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].kind, 'add');
  assert.strictEqual(d[0].date, '10/22');
  assert.strictEqual(d[0].checked, false, '新增天預設不該勾選');
});

check('差異：app 多一天標為 missing，且沒有 checked', () => {
  const app = [mkDay({ date: '10/21' }), mkDay({ date: '10/22' })];
  const sheet = [{ date: '10/21', dest: 'A', trans: 'T', stay: 'S', note: 'N', url: 'U' }];
  const d = diffFn(sheet, app);
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].kind, 'missing');
  assert.strictEqual(d[0].date, '10/22');
  assert.ok(!('checked' in d[0]), 'missing 不該有 checked');
});

check('差異：app 端是 {zh,en,ja} 物件時用 zh 比對，相同就不列出', () => {
  const app = [mkDay({ dest: { zh: 'A', en: 'A-en', ja: 'A-ja' } })];
  const sheet = [{ date: '10/21', dest: 'A', trans: 'T', stay: 'S', note: 'N', url: 'U' }];
  assert.deepStrictEqual(diffFn(sheet, app), []);
});

check('差異：app 缺欄位（undefined）視為空字串', () => {
  const app = [{ date: '10/21', dest: 'A' }];
  const sheet = [{ date: '10/21', dest: 'A', trans: '', stay: '', note: '', url: '' }];
  assert.deepStrictEqual(diffFn(sheet, app), []);
});

console.log(`\n${passed}/${total} passed`);
