// 用真實的試算表 CSV fixture 跑完整條流程：解析 → 轉換 → 比對 → 套用。
// 起始資料用 index.html 裡的 DEFAULT_DAYS，fixture 則是另一版試算表，
// 模擬「app 上的行程與試算表不一致」的情境（兩邊誰新誰舊不影響這裡要驗的匯入行為）。
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
  grab(/const SHEET_COLS=[[\s\S]*?\];/, 'SHEET_COLS'),
  grab(/function sheetRowsToDays\(rows\)\{[\s\S]*?\n\}/, 'sheetRowsToDays()'),
  grab(/const SHEET_FIELDS=[^\n]*/, 'SHEET_FIELDS'),
  grab(/function diffSheet\(sheetDays,list,presentCols\)\{[\s\S]*?\n\}/, 'diffSheet()'),
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
  // fixture 這版試算表把 10/27 排河口湖、10/28 排上高地，與 DEFAULT_DAYS 剛好對調
  const dest1027 = diffs.find(d => d.date === '10/27' && d.field === 'dest');
  assert.ok(dest1027, '10/27 的目的地應該有差異');
  assert.strictEqual(dest1027.to, '新倉淺間神社、河口湖');
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
    ['dest', 'trans', 'stay', 'note', 'url', 'rain', 'ref', 'detail'].forEach(f => {
      assert.strictEqual(FN.t(day[f]), sd[f], `${sd.date} 的 ${f} 不一致`);
    });
  });
});

check('套用後 app 獨有欄位仍在（leaf / r）', () => {
  itinerary = JSON.parse(JSON.stringify(FN.DEFAULT_DAYS));
  const before = itinerary.map(d => ({ leaf: !!d.leaf, r: d.r }));
  FN.applySheetDiff(FN.diffSheet(parsed.days, itinerary));
  itinerary.forEach((d, i) => {
    assert.strictEqual(!!d.leaf, before[i].leaf, `第 ${i + 1} 天的 leaf 被改掉了`);
    assert.strictEqual(d.r, before[i].r, `第 ${i + 1} 天的 r 被改掉了`);
  });
});

check('套用後住宿的 Google Maps 連結一個都沒少', () => {
  // 住宿名稱被試算表覆蓋時，頂層 stayUrl 不能跟著不見（舊的 {zh,url} 物件形式在 test-sheet-import 驗）
  itinerary = JSON.parse(JSON.stringify(FN.DEFAULT_DAYS));
  const linkOf = d => d.stayUrl || (d.stay && typeof d.stay === 'object' ? d.stay.url : '') || '';
  const before = itinerary.map(d => ({ date: d.date, url: linkOf(d) }));
  const hadLink = before.filter(b => b.url).length;
  assert.ok(hadLink >= 14, '前提檢查：預設資料至少要有 14 天帶連結，實際 ' + hadLink);

  FN.applySheetDiff(FN.diffSheet(parsed.days, itinerary));

  const lost = [];
  itinerary.forEach((d, i) => { if (before[i].url && linkOf(d) !== before[i].url) lost.push(before[i].date); });
  assert.deepStrictEqual(lost, [], '這些天的地圖連結不見了: ' + lost.join('、'));
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

check('端對端：真實 fixture 的雨天備案會匯入', () => {
  assert.deepStrictEqual(parsed.missingCols, []);
  assert.strictEqual(parsed.presentCols.rain, true);
  assert.strictEqual(parsed.presentCols.ref, true);
  assert.ok(parsed.days.filter(d => d.rain).length >= 10,
    '真實資料多數天都有雨天備案，實際 ' + parsed.days.filter(d => d.rain).length);
});

check('端對端：拿掉雨天備案欄不會產生清空差異', () => {
  const rows = FN.parseCsv(csv);
  const at = rows[0].indexOf('雨天備案');
  assert.ok(at >= 0, '前提檢查：fixture 應該要有雨天備案欄');
  const stripped = rows.map(r => r.filter((_, i) => i !== at));
  const p2 = FN.sheetRowsToDays(stripped);
  assert.deepStrictEqual(p2.missingCols, [], '選用欄缺席不該中止匯入');
  assert.strictEqual(p2.presentCols.rain, false);

  itinerary = p2.days.map(d => Object.assign({}, d, { rain: '原本就有的雨備' }));
  const diffs = FN.diffSheet(p2.days, itinerary, p2.presentCols);
  assert.strictEqual(diffs.filter(x => x.field === 'rain').length, 0,
    '欄位從試算表被移除，不等於要清空 app 上已有的資料');
});

check('端對端：行程詳細版從試算表貫穿到行程資料', () => {
  itinerary = JSON.parse(JSON.stringify(FN.DEFAULT_DAYS));
  FN.applySheetDiff(FN.diffSheet(parsed.days, itinerary, parsed.presentCols));
  const d1025 = itinerary.find(d => d.date === '10/25');
  assert.ok(d1025.detail && d1025.detail.indexOf('http') === 0, '10/25 應有詳細版網址');
  const others = itinerary.filter(d => d.date !== '10/25' && d.detail);
  assert.deepStrictEqual(others, [], '其餘 14 天不該有值');
});

check('端對端：未使用的欄位會被回報', () => {
  const rows = FN.parseCsv(csv);
  const withExtra = rows.map((r, i) => i === 0 ? r.concat(['預算']) : r.concat(['3000']));
  const p2 = FN.sheetRowsToDays(withExtra);
  assert.deepStrictEqual(p2.unknownCols, ['預算']);
  assert.deepStrictEqual(p2.missingCols, [], '多出欄位不該影響匯入');
});

console.log(`\n${passed}/${total} passed`);
