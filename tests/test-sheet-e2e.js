// 用真實的試算表 CSV fixture 跑完整條流程：解析 → 轉換 → 比對 → 套用。
// 起始資料用 index.html 裡的 DEFAULT_DAYS，模擬「app 有一份舊行程」的情境。
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = path.join(__dirname, '..', 'index.html');
const src = fs.readFileSync(SRC, 'utf8');
const grab = (re, label) => {
  const m = src.match(re);
  if (!m) { console.error('FAIL: 找不到 ' + label); process.exit(1); }
  return m[0];
};

const dataBlock = src.slice(src.indexOf('const WD='), src.indexOf('const SEED_TOTAL='));
let itinerary = [];

const FN = eval([
  dataBlock,
  grab(/const t=o=>[^\n]*/, 't()'),
  grab(/function parseMD\(str\)\{[\s\S]*?\n\}/, 'parseMD()'),
  grab(/function resequenceDates\(\)\{[\s\S]*?\n\}/, 'resequenceDates()'),
  grab(/function parseCsv\(text\)\{[\s\S]*?\n\}/, 'parseCsv()'),
  grab(/function sheetRowsToDays\(rows\)\{[\s\S]*?\n\}/, 'sheetRowsToDays()'),
  grab(/const SHEET_FIELDS=[^\n]*/, 'SHEET_FIELDS'),
  grab(/function diffSheet\(sheetDays,list\)\{[\s\S]*?\n\}/, 'diffSheet()'),
  grab(/function applySheetDiff\(diffs\)\{[\s\S]*?\n\}/, 'applySheetDiff()'),
  ';({DEFAULT_DAYS,parseCsv,sheetRowsToDays,diffSheet,applySheetDiff,t})',
].join('\n'));

const csv = fs.readFileSync(path.join(__dirname, 'fixtures', 'sheet-sample.csv'), 'utf8');
const parsed = FN.sheetRowsToDays(FN.parseCsv(csv));

let passed = 0, total = 0;
const check = (name, fn) => {
  total++;
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; }
};

check('解析真實試算表得到 15 天，沒有略過或重複', () => {
  assert.strictEqual(parsed.days.length, 15);
  assert.deepStrictEqual(parsed.skipped, []);
  assert.deepStrictEqual(parsed.duplicates, []);
});

check('與 DEFAULT_DAYS 比對，找得出已知的行程差異', () => {
  itinerary = JSON.parse(JSON.stringify(FN.DEFAULT_DAYS));
  const diffs = FN.diffSheet(parsed.days, itinerary);
  const dest1024 = diffs.find(d => d.date === '10/24' && d.field === 'dest');
  assert.ok(dest1024, '10/24 的目的地應該有差異');
  assert.strictEqual(dest1024.to, '金澤車站、兼六園');
  assert.strictEqual(diffs.filter(d => d.kind === 'add').length, 0, '兩邊都是 10/21–11/04，不該有新增');
  assert.strictEqual(diffs.filter(d => d.kind === 'missing').length, 0, '不該有缺漏');
});

check('全部套用後，行程內容與試算表一致', () => {
  itinerary = JSON.parse(JSON.stringify(FN.DEFAULT_DAYS));
  FN.applySheetDiff(FN.diffSheet(parsed.days, itinerary));
  assert.strictEqual(itinerary.length, 15);
  parsed.days.forEach(sd => {
    const day = itinerary.find(d => d.date === sd.date);
    assert.ok(day, '找不到 ' + sd.date);
    ['dest', 'trans', 'stay', 'note', 'url'].forEach(f => {
      assert.strictEqual(FN.t(day[f]), sd[f], `${sd.date} 的 ${f} 不一致`);
    });
  });
});

check('套用後 app 獨有欄位仍在（leaf / r / stayUrl）', () => {
  itinerary = JSON.parse(JSON.stringify(FN.DEFAULT_DAYS));
  const before = itinerary.map(d => ({ leaf: !!d.leaf, r: d.r }));
  FN.applySheetDiff(FN.diffSheet(parsed.days, itinerary));
  itinerary.forEach((d, i) => {
    assert.strictEqual(!!d.leaf, before[i].leaf, `第 ${i + 1} 天的 leaf 被改掉了`);
    assert.strictEqual(d.r, before[i].r, `第 ${i + 1} 天的 r 被改掉了`);
  });
  assert.ok(itinerary[0].stay, '住宿不該消失');
});

check('套用後日期仍是連續的 10/21–11/04', () => {
  itinerary = JSON.parse(JSON.stringify(FN.DEFAULT_DAYS));
  FN.applySheetDiff(FN.diffSheet(parsed.days, itinerary));
  assert.strictEqual(itinerary[0].date, '10/21');
  assert.strictEqual(itinerary[14].date, '11/04');
  for (let i = 1; i < itinerary.length; i++) {
    const prev = itinerary[i - 1].date, cur = itinerary[i].date;
    assert.ok(prev < cur || (prev.startsWith('10/') && cur.startsWith('11/')), `${prev} → ${cur} 順序不對`);
  }
});

check('套用兩次結果相同（冪等），第二次沒有差異', () => {
  itinerary = JSON.parse(JSON.stringify(FN.DEFAULT_DAYS));
  FN.applySheetDiff(FN.diffSheet(parsed.days, itinerary));
  const after1 = JSON.stringify(itinerary);
  const diffs2 = FN.diffSheet(parsed.days, itinerary);
  assert.deepStrictEqual(diffs2.filter(d => d.kind !== 'missing'), [], '第二次比對不該還有差異');
  FN.applySheetDiff(diffs2);
  assert.strictEqual(JSON.stringify(itinerary), after1, '再套用一次不該改變任何東西');
});

check('沒勾選的項目不會被套用', () => {
  itinerary = JSON.parse(JSON.stringify(FN.DEFAULT_DAYS));
  const before = FN.t(itinerary[3].dest);
  const diffs = FN.diffSheet(parsed.days, itinerary).map(d => Object.assign({}, d, { checked: false }));
  FN.applySheetDiff(diffs);
  assert.strictEqual(FN.t(itinerary[3].dest), before, '全部不勾選時不該有任何改動');
});

console.log(`\n${passed}/${total} passed`);
