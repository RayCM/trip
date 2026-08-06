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

// applySheetDiff 會就地改動全域的 itinerary，宣告在這裡讓 direct eval 的函式綁到它
let itinerary = [];

// renderSheetDiff 需要的最小 DOM stub 與全域
let sheetDiffs = [];
const els = {};
const mkEl = id => ({ id, innerHTML: '', textContent: '', style: {}, disabled: false });
let document = { getElementById: id => els[id] || (els[id] = mkEl(id)) };

// diffSheet 內部用 t() 取值（app 端欄位可能還是舊的 {zh,en,ja} 物件）也用 SHEET_FIELDS
// 決定比對哪些欄位，兩者都不在函式本體裡，必須各自抽出來一起 eval
const FN = eval([
  grab(/const t=o=>[^\n]*/, 't()'),
  grab(/function parseMD\(str\)\{[\s\S]*?\n\}/, 'parseMD()'),
  grab(/function parseCsv\(text\)\{[\s\S]*?\n\}/, 'parseCsv()'),
  grab(/const SHEET_COLS=[[\s\S]*?\];/, 'SHEET_COLS'),
  grab(/function sheetRowsToDays\(rows\)\{[\s\S]*?\n\}/, 'sheetRowsToDays()'),
  grab(/const SHEET_FIELDS=[^\n]*/, 'SHEET_FIELDS'),
  grab(/function diffSheet\(sheetDays,list\)\{[\s\S]*?\n\}/, 'diffSheet()'),
  grab(/function resequenceDates\(\)\{[\s\S]*?\n\}/, 'resequenceDates()'),
  grab(/function applySheetDiff\(diffs\)\{[\s\S]*?\n\}/, 'applySheetDiff()'),
  grab(/function esc\(s\)\{[^\n]*\}/, 'esc()'),
  grab(/const DIFF_LABEL=[^\n]*/, 'DIFF_LABEL'),
  grab(/function renderSheetDiff\(parsed\)\{[\s\S]*?\n\}/, 'renderSheetDiff()'),
  ';({parseCsv,sheetRowsToDays,diffSheet,applySheetDiff,renderSheetDiff})',
].join('\n'));
const parseCsvFn = FN.parseCsv, toDays = FN.sheetRowsToDays, diffFn = FN.diffSheet, applyFn = FN.applySheetDiff;
const renderFn = FN.renderSheetDiff;

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

check('真實試算表：15 列資料、8 個欄位', () => {
  const csv = fs.readFileSync(path.join(__dirname, 'fixtures', 'sheet-sample.csv'), 'utf8');
  const rows = parseCsvFn(csv).filter(r => r.some(c => c.trim()));
  assert.strictEqual(rows.length, 16, '應為 1 列標題 + 15 列資料');
  assert.deepStrictEqual(rows[0], ['日期', '目的地', '詳細交通與行程細節', '住宿地點', '備註', '訂票網址', '雨天備案', '參考資料']);
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
  assert.strictEqual(r.days[3].dest, '金澤車站、兼六園、近江町市場、東茶屋街');
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

check('差異：試算表多一天標為 add，預設勾選', () => {
  const app = [mkDay({})];
  const sheet = [
    { date: '10/21', dest: 'A', trans: 'T', stay: 'S', note: 'N', url: 'U' },
    { date: '10/22', dest: '新的一天', trans: '', stay: '', note: '', url: '' },
  ];
  const d = diffFn(sheet, app);
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].kind, 'add');
  assert.strictEqual(d[0].date, '10/22');
  assert.strictEqual(d[0].checked, true, '新增天預設要勾選——不勾會讓被擠到最後的內容消失');
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

check('套用：只套用被勾選的變動', () => {
  itinerary = [mkDay({ date: '10/21', dest: 'A', note: 'N' })];
  applyFn([
    { kind: 'change', date: '10/21', field: 'dest', from: 'A', to: '新目的地', checked: true },
    { kind: 'change', date: '10/21', field: 'note', from: 'N', to: '新備註', checked: false },
  ]);
  assert.strictEqual(itinerary[0].dest, '新目的地');
  assert.strictEqual(itinerary[0].note, 'N', '沒勾的不該被套用');
});

check('套用：新增天會插入並讓日期重新連續', () => {
  itinerary = [mkDay({ date: '10/21' }), mkDay({ date: '10/22' })];
  applyFn([{ kind: 'add', date: '10/23', day: { date: '10/23', dest: '新的', trans: '', stay: '', note: '', url: '' }, checked: true }]);
  assert.strictEqual(itinerary.length, 3);
  assert.deepStrictEqual(itinerary.map(d => d.date), ['10/21', '10/22', '10/23']);
  assert.strictEqual(itinerary[2].dest, '新的');
});

check('套用：missing 不會刪除任何一天', () => {
  itinerary = [mkDay({ date: '10/21' }), mkDay({ date: '10/22' })];
  applyFn([{ kind: 'missing', date: '10/22' }]);
  assert.strictEqual(itinerary.length, 2);
});

check('套用：保留 leaf / r / stayUrl', () => {
  itinerary = [mkDay({ date: '10/21', leaf: true, r: 'slate', stayUrl: 'https://maps.example/x' })];
  applyFn([{ kind: 'change', date: '10/21', field: 'dest', from: 'A', to: 'B', checked: true }]);
  assert.strictEqual(itinerary[0].leaf, true);
  assert.strictEqual(itinerary[0].r, 'slate');
  assert.strictEqual(itinerary[0].stayUrl, 'https://maps.example/x');
});

check('套用：url 有變動時清掉 ulabel', () => {
  itinerary = [mkDay({ date: '10/21', url: 'https://old.com', ulabel: 'JR e5489 訂票' })];
  applyFn([{ kind: 'change', date: '10/21', field: 'url', from: 'https://old.com', to: 'https://new.com', checked: true }]);
  assert.strictEqual(itinerary[0].url, 'https://new.com');
  assert.ok(!itinerary[0].ulabel, 'url 換了就不該留舊的按鈕文字');
});

check('套用：url 沒變動時 ulabel 保留', () => {
  itinerary = [mkDay({ date: '10/21', url: 'https://x.com', ulabel: 'JR e5489 訂票' })];
  applyFn([{ kind: 'change', date: '10/21', field: 'dest', from: 'A', to: 'B', checked: true }]);
  assert.strictEqual(itinerary[0].ulabel, 'JR e5489 訂票');
});

check('套用：空值會覆蓋掉既有內容', () => {
  itinerary = [mkDay({ date: '10/21', note: '原本的備註' })];
  applyFn([{ kind: 'change', date: '10/21', field: 'note', from: '原本的備註', to: '', checked: true }]);
  assert.ok(!itinerary[0].note, '空值應覆蓋掉既有內容');
});

check('套用：空清單不會改動任何東西', () => {
  itinerary = [mkDay({ date: '10/21', dest: 'A' })];
  applyFn([]);
  assert.strictEqual(itinerary[0].dest, 'A');
  assert.strictEqual(itinerary.length, 1);
});

check('套用：新增中間某天時會插在正確位置', () => {
  itinerary = [mkDay({ date: '10/21', dest: 'A' }), mkDay({ date: '10/23', dest: 'C' })];
  applyFn([{ kind: 'add', date: '10/22', day: { date: '10/22', dest: 'B', trans: '', stay: '', note: '', url: '' }, checked: true }]);
  assert.deepStrictEqual(itinerary.map(d => d.dest), ['A', 'B', 'C'], '新增的天應插在中間');
  assert.deepStrictEqual(itinerary.map(d => d.date), ['10/21', '10/22', '10/23']);
});

check('套用：住宿是 {zh,url} 物件時，地圖連結不會被覆蓋掉', () => {
  // 線上舊資料的 stay 是 {zh:'…',url:'https://maps…'}，覆蓋成字串會讓連結消失
  itinerary = [{ date: '10/21', stay: { zh: '東橫 INN 松本站東口', url: 'https://maps.app.goo.gl/abc' } }];
  applyFn([{ kind: 'change', date: '10/21', field: 'stay', from: '東橫 INN 松本站東口', to: '東橫INN 松本站東口', checked: true }]);
  assert.strictEqual(itinerary[0].stay, '東橫INN 松本站東口');
  assert.strictEqual(itinerary[0].stayUrl, 'https://maps.app.goo.gl/abc', '地圖連結必須被保留下來');
});

check('套用：已有 stayUrl 時不覆蓋它', () => {
  itinerary = [{ date: '10/21', stay: { zh: 'A', url: 'https://old' }, stayUrl: 'https://user-set' }];
  applyFn([{ kind: 'change', date: '10/21', field: 'stay', from: 'A', to: 'B', checked: true }]);
  assert.strictEqual(itinerary[0].stayUrl, 'https://user-set', '使用者自己設的 stayUrl 優先');
});

check('套用：同一份差異套用兩次不會產生重複的天', () => {
  itinerary = [mkDay({ date: '10/21' })];
  const diffs = [{ kind: 'add', date: '10/22', day: { date: '10/22', dest: 'X' }, checked: true }];
  applyFn(diffs);
  applyFn(diffs);
  assert.strictEqual(itinerary.length, 2, '重複套用不該再加一次');
  assert.deepStrictEqual(itinerary.map(d => d.date), ['10/21', '10/22']);
});

check('套用：值在比對之後被改過就跳過，不覆蓋別人的編輯', () => {
  itinerary = [mkDay({ date: '10/21', trans: '旅伴剛剛改的' })];
  const r = applyFn([{ kind: 'change', date: '10/21', field: 'trans', from: '比對當下的舊值', to: '試算表的值', checked: true }]);
  assert.strictEqual(itinerary[0].trans, '旅伴剛剛改的', '不該覆蓋掉視窗開著時被改動的值');
  assert.strictEqual(r.stale, 1, '應回報有 1 項被跳過');
});

check('套用：回傳值告知跳過筆數，沒跳過時為 0', () => {
  itinerary = [mkDay({ date: '10/21', dest: 'A' })];
  const r = applyFn([{ kind: 'change', date: '10/21', field: 'dest', from: 'A', to: 'B', checked: true }]);
  assert.strictEqual(r.stale, 0);
  assert.strictEqual(itinerary[0].dest, 'B');
});

check('轉換：缺少欄位標題會被回報，不會靜默把該欄清空', () => {
  const noNote = ['日期', '目的地', '詳細交通與行程細節', '住宿地點', '訂票網址'];
  const r = toDays([noNote, ['10/21', 'A', 'T', 'S', 'U']]);
  assert.deepStrictEqual(r.missingCols, ['備註'], '缺少的欄位要被列出來');
});

check('轉換：欄位齊全時 missingCols 是空的', () => {
  const r = toDays([HEAD, ['10/21', 'A', '', '', '', '', '']]);
  assert.deepStrictEqual(r.missingCols, []);
});

check('轉換：拿到 HTML（試算表被改成私人）時會回報缺少所有欄位', () => {
  const html = '<!DOCTYPE html><html><head><title>登入</title></head><body>請登入</body></html>';
  const r = toDays(parseCsvFn(html));
  assert.ok(r.missingCols.length >= 1, '應回報缺少欄位而不是回傳 0 天卻說「一致」');
  assert.ok(r.missingCols.includes('日期'), '至少要偵測到缺少日期欄');
});

const noSkips = { skipped: [], duplicates: [], missingCols: [] };
const diffHtml = () => els['diff-list'].innerHTML;

check('差異視窗：checkbox 索引對應 sheetDiffs 的真實索引', () => {
  // missing 混在中間時，若用過濾後陣列的索引，勾選會靜默改到別的項目
  sheetDiffs = [
    { kind: 'missing', date: '10/20' },
    { kind: 'change', date: '10/21', field: 'dest', from: 'A', to: 'B', checked: true },
  ];
  renderFn(noSkips);
  const m = diffHtml().match(/sheetDiffs\[(\d+)\]\.checked/g);
  assert.deepStrictEqual(m, ['sheetDiffs[1].checked'],
    'change 項目在 sheetDiffs 的索引是 1，不是過濾後的 0');
});

check('差異視窗：change 顯示新舊值，清空顯示「（清空）」', () => {
  sheetDiffs = [{ kind: 'change', date: '10/21', field: 'note', from: '舊備註', to: '', checked: true }];
  renderFn(noSkips);
  assert.ok(diffHtml().includes('舊備註'), '應顯示原值');
  assert.ok(diffHtml().includes('（清空）'), '空值應顯示為清空');
  assert.ok(diffHtml().includes('備註'), '應顯示欄位中文名');
});

check('差異視窗：checked 屬性正確反映勾選狀態', () => {
  // 注意不能用 /checkbox[^>]*checked/ 判斷——onchange="sheetDiffs[0].checked=..." 裡也有 checked 字樣
  const attr = () => / checked onchange/.test(diffHtml());

  sheetDiffs = [{ kind: 'add', date: '11/05', day: { dest: '新的一天' }, checked: false }];
  renderFn(noSkips);
  assert.ok(diffHtml().includes('新增這天'));
  assert.ok(diffHtml().includes('新的一天'));
  assert.strictEqual(attr(), false, 'checked:false 不該有 checked 屬性');

  sheetDiffs = [{ kind: 'change', date: '10/21', field: 'dest', from: 'A', to: 'B', checked: true }];
  renderFn(noSkips);
  assert.strictEqual(attr(), true, 'checked:true 應輸出 checked 屬性');
});

check('差異視窗：沒有差異時顯示一致訊息並隱藏套用按鈕', () => {
  sheetDiffs = [];
  renderFn(noSkips);
  assert.ok(diffHtml().includes('試算表與目前行程一致'));
  assert.strictEqual(els['sheet-apply'].style.display, 'none');
});

check('差異視窗：有差異時顯示套用按鈕', () => {
  sheetDiffs = [{ kind: 'change', date: '10/21', field: 'dest', from: 'A', to: 'B', checked: true }];
  renderFn(noSkips);
  assert.strictEqual(els['sheet-apply'].style.display, 'block');
});

check('差異：試算表在中間插入一天時，最後一天的內容不會消失', () => {
  const app = [mkDay({ date: '10/21', dest: 'A' }), mkDay({ date: '10/22', dest: 'B' }), mkDay({ date: '10/23', dest: 'C' })];
  const sheet = ['A', 'X', 'B', 'C'].map((dest, i) => ({
    date: '10/2' + (1 + i), dest, trans: 'T', stay: 'S', note: 'N', url: 'U',
  }));
  itinerary = JSON.parse(JSON.stringify(app));
  applyFn(diffFn(sheet, itinerary));
  assert.deepStrictEqual(itinerary.map(d => d.dest), ['A', 'X', 'B', 'C'],
    '插入一天時被擠到最後的內容不該消失');
});

check('差異視窗：多出天數時會提示不勾選的後果', () => {
  sheetDiffs = [{ kind: 'add', date: '11/05', day: { dest: 'X' }, checked: true }];
  renderFn(noSkips);
  assert.ok(diffHtml().includes('多了 1 天'), '應告知多了幾天');
  assert.ok(diffHtml().includes('內容會消失'), '應說明取消勾選的後果');
});

check('差異視窗：略過、重複、missing 都會提示', () => {
  sheetDiffs = [{ kind: 'missing', date: '10/30' }];
  renderFn({ skipped: [4, 7], duplicates: ['10/21'] });
  const h = diffHtml();
  assert.ok(h.includes('第 4、7 列'), '應列出被略過的列號');
  assert.ok(h.includes('重複日期'), '應提示重複日期');
  assert.ok(h.includes('10/30') && h.includes('不會被刪除'), '應提示 app 多出來的天不會被刪');
});

check('差異視窗：內容有做 HTML 跳脫', () => {
  sheetDiffs = [{ kind: 'change', date: '10/21', field: 'dest', from: '', to: '<img src=x onerror=alert(1)>', checked: true }];
  renderFn(noSkips);
  assert.ok(!diffHtml().includes('<img'), '使用者內容必須跳脫，不能直接注入標籤');
  assert.ok(diffHtml().includes('&lt;img'), '應被跳脫成實體');
});

console.log(`\n${passed}/${total} passed`);
