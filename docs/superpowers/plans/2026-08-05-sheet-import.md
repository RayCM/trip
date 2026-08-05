# 從 Google 試算表匯入行程 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 編輯模式下按一個按鈕，把 Google 試算表的行程內容拉進 app，確認差異後才套用，不會覆蓋掉未確認的內容。

**Architecture:** 四層各自獨立、各自可測：CSV 解析器 → 列轉換成 day 物件 → 與現有 `itinerary` 比對產生差異清單 → 套用被勾選的差異。UI 層（抓取、差異視窗、套用按鈕）薄薄一層包在外面。前三層是純函式，用專案既有的「從原始碼抽函式 eval」方式測試。

**Tech Stack:** 單檔 vanilla JS（`index.html`，無建置流程、無框架、無 npm）、`fetch()` 直接抓 Google 試算表 CSV 匯出、Firebase Realtime Database。

**Spec:** `docs/superpowers/specs/2026-08-05-sheet-import-design.md`

**測試：** 新增 `tests/test-sheet-import.js`，並用 `tests/fixtures/sheet-sample.csv`（實際試算表的副本，已存在）驗證解析器對真實資料有效。跑法照舊：`sh tests/run-all.sh`。

**前置條件：** `main` 上的日期功能與多語系清理已完成。本功能在 `feat/sheet-import` 分支上。

---

## 檔案結構

全部改動都在 `index.html`（單檔專案）＋ `tests/` 底下新增測試。

`index.html` 新增的函式，依相依順序排列，全部放在 `/* ===== itinerary editing ===== */` 區塊內、`openDayForm()` 之前：

| 函式 | 職責 | 相依 |
|---|---|---|
| `parseCsv(text)` | CSV 字串 → 二維陣列 | 無 |
| `sheetRowsToDays(rows)` | CSV 二維陣列 → `{date, dest, trans, stay, note, url}` 陣列＋略過紀錄 | `parseMD` |
| `diffSheet(sheetDays, itinerary)` | 產生差異清單 | `parseMD` |
| `applySheetDiff(diffs)` | 套用被勾選的差異到 `itinerary` | `resequenceDates` |
| `fetchSheet()` | 抓 CSV（唯一碰網路的） | 無 |
| `openSheetImport()` | UI：抓 → 比對 → 開差異視窗 | 上面全部 |
| `confirmSheetImport()` | UI：套用 → 寫回 → 重繪 | `applySheetDiff`、`pushField` |

前四支是純函式，沒有 DOM 與網路相依，可以單獨抽出來測。

---

### Task 1: CSV 解析器

**Files:**
- Modify: `index.html`
- Test: `tests/test-sheet-import.js`（新建）

- [ ] **Step 1: 寫失敗測試**

建立 `tests/test-sheet-import.js`：

```js
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
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `node tests/test-sheet-import.js`
Expected: `FAIL: 在 index.html 找不到 parseCsv()`，exit code 1。

- [ ] **Step 3: 實作**

在 `index.html` 的 `function openDayForm(i){` 這一行**之前**插入：

```js
/* ===== 從 Google 試算表匯入 ===== */
// 儲存格可能含逗號與換行（例如多行的備註），不能用 split 處理
function parseCsv(text){
 const rows=[];let row=[],cell='',q=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(q){
   if(c!=='"'){cell+=c;}
   else if(text[i+1]==='"'){cell+='"';i++;} // "" 是跳脫的雙引號
   else q=false;
  }
  else if(c==='"')q=true;
  else if(c===','){row.push(cell);cell='';}
  else if(c==='\n'){row.push(cell);rows.push(row);row=[];cell='';}
  else if(c!=='\r')cell+=c;
 }
 if(cell!==''||row.length){row.push(cell);rows.push(row);}
 return rows;
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `node tests/test-sheet-import.js`
Expected: `10/10 passed`，exit code 0。

- [ ] **Step 5: 確認既有測試沒被影響**

Run: `sh tests/run-all.sh`
Expected: 全部通過（含既有 64 項）。

- [ ] **Step 6: Commit**

```bash
cd /Users/raychang/tirp
git add index.html tests/test-sheet-import.js tests/fixtures/sheet-sample.csv
git commit -m "新增 CSV 解析器，處理引號、逗號與換行"
```

---

### Task 2: 列轉換成 day 物件

**Files:**
- Modify: `index.html`
- Test: `tests/test-sheet-import.js`

- [ ] **Step 1: 加入失敗測試**

在 `tests/test-sheet-import.js` 的 `FN` 抽取清單中加入 `parseMD` 與 `sheetRowsToDays`：

```js
const FN = eval([
  grab(/function parseMD\(str\)\{[\s\S]*?\n\}/, 'parseMD()'),
  grab(/function parseCsv\(text\)\{[\s\S]*?\n\}/, 'parseCsv()'),
  grab(/function sheetRowsToDays\(rows\)\{[\s\S]*?\n\}/, 'sheetRowsToDays()'),
  ';({parseCsv,sheetRowsToDays})',
].join('\n'));
const parseCsvFn = FN.parseCsv, toDays = FN.sheetRowsToDays;
```

在 `console.log` 那行之前加入這些 check：

```js
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
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `node tests/test-sheet-import.js`
Expected: `FAIL: 在 index.html 找不到 sheetRowsToDays()`，exit code 1。

- [ ] **Step 3: 實作**

在 `parseCsv()` 之後插入：

```js
// CSV 二維陣列 → day 物件。第一列是標題，依標題文字找欄位，欄位順序改變也不會錯位。
function sheetRowsToDays(rows){
 const days=[],skipped=[],duplicates=[],seen={};
 if(!rows.length)return{days,skipped,duplicates};
 const head=rows[0].map(h=>String(h||'').trim());
 const col=name=>head.indexOf(name);
 const idx={date:col('日期'),dest:col('目的地'),trans:col('詳細交通與行程細節'),
  stay:col('住宿地點'),note:col('備註'),url:col('訂票網址')};
 const val=(row,k)=>idx[k]<0?'':String(row[idx[k]]||'').trim();
 rows.slice(1).forEach((row,i)=>{
  if(!row.some(c=>String(c||'').trim()))return; // 整列空白，忽略
  const d=parseMD(val(row,'date'));
  if(!d){skipped.push(i+2);return;} // +2：跳過標題列且轉成 1-based
  const date=String(d.getMonth()+1).padStart(2,'0')+'/'+String(d.getDate()).padStart(2,'0');
  const day={date,dest:val(row,'dest'),trans:val(row,'trans'),
   stay:val(row,'stay'),note:val(row,'note'),url:val(row,'url')};
  if(date in seen){days[seen[date]]=day;duplicates.push(date);} // 重複日期以最後一列為準
  else{seen[date]=days.length;days.push(day);}
 });
 return{days,skipped,duplicates};
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `node tests/test-sheet-import.js`
Expected: `17/17 passed`，exit code 0。

- [ ] **Step 5: Commit**

```bash
cd /Users/raychang/tirp
git add index.html tests/test-sheet-import.js
git commit -m "試算表列轉換成 day 物件，依標題找欄位"
```

---

### Task 3: 差異計算

**Files:**
- Modify: `index.html`
- Test: `tests/test-sheet-import.js`

差異項目的形狀（後面的 Task 都依賴這個結構，先定死）：

```js
{kind:'change', date:'10/24', field:'dest', from:'雨晴海岸', to:'金澤車站、兼六園', checked:true}
{kind:'add',    date:'11/05', day:{date,dest,trans,stay,note,url}, checked:false}
{kind:'missing',date:'10/30'}  // app 有、試算表沒有；純告知，沒有 checked
```

- [ ] **Step 1: 加入失敗測試**

`FN` 抽取清單加入 `t()` 與 `diffSheet`，回傳物件加上 `diffSheet`：

```js
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
```

**這兩項少了會直接爆掉**：`diffSheet` 內部用 `t()` 取值（app 端的欄位可能還是舊的 `{zh,en,ja}` 物件），也用 `SHEET_FIELDS` 決定要比對哪些欄位。兩者都不在 `diffSheet` 的函式本體裡，必須各自抽出來一起 eval，否則會得到 `t is not defined` / `SHEET_FIELDS is not defined`。

加入這些 check：

```js
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
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `node tests/test-sheet-import.js`
Expected: `FAIL: 在 index.html 找不到 diffSheet()`，exit code 1。

- [ ] **Step 3: 實作**

在 `sheetRowsToDays()` 之後插入：

```js
const SHEET_FIELDS=[['dest','目的地'],['trans','交通與行程'],['stay','住宿'],['note','備註'],['url','訂票網址']];
// 比對試算表與目前行程，回傳差異清單。app 端的值可能是舊的 {zh,en,ja} 物件，一律用 t() 取中文比。
function diffSheet(sheetDays,list){
 const diffs=[],byDate={};
 list.forEach((d,i)=>{byDate[d.date]=i;});
 sheetDays.forEach(sd=>{
  const i=byDate[sd.date];
  if(i===undefined){diffs.push({kind:'add',date:sd.date,day:sd,checked:false});return;}
  SHEET_FIELDS.forEach(([f])=>{
   const from=t(list[i][f]),to=sd[f];
   if(from!==to)diffs.push({kind:'change',date:sd.date,field:f,from,to,checked:true});
  });
 });
 const sheetDates={};sheetDays.forEach(d=>{sheetDates[d.date]=true;});
 list.forEach(d=>{if(!sheetDates[d.date])diffs.push({kind:'missing',date:d.date});});
 return diffs;
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `node tests/test-sheet-import.js`
Expected: `25/25 passed`，exit code 0。

- [ ] **Step 5: Commit**

```bash
cd /Users/raychang/tirp
git add index.html tests/test-sheet-import.js
git commit -m "計算試算表與行程的差異"
```

---

### Task 4: 套用差異

**Files:**
- Modify: `index.html`
- Test: `tests/test-sheet-import.js`

- [ ] **Step 1: 加入失敗測試**

`FN` 抽取清單加入 `resequenceDates` 與 `applySheetDiff`。相依鏈是 `applySheetDiff` → `resequenceDates` → `parseMD`，以及 `applySheetDiff` → `t()`，全部都要在同一個 eval 裡：

```js
const FN = eval([
  grab(/const t=o=>[^\n]*/, 't()'),
  grab(/function parseMD\(str\)\{[\s\S]*?\n\}/, 'parseMD()'),
  grab(/function parseCsv\(text\)\{[\s\S]*?\n\}/, 'parseCsv()'),
  grab(/function sheetRowsToDays\(rows\)\{[\s\S]*?\n\}/, 'sheetRowsToDays()'),
  grab(/const SHEET_FIELDS=[^\n]*/, 'SHEET_FIELDS'),
  grab(/function diffSheet\(sheetDays,list\)\{[\s\S]*?\n\}/, 'diffSheet()'),
  grab(/function resequenceDates\(\)\{[\s\S]*?\n\}/, 'resequenceDates()'),
  grab(/function applySheetDiff\(diffs\)\{[\s\S]*?\n\}/, 'applySheetDiff()'),
  ';({parseCsv,sheetRowsToDays,diffSheet,applySheetDiff})',
].join('\n'));
const parseCsvFn = FN.parseCsv, toDays = FN.sheetRowsToDays, diffFn = FN.diffSheet;
```

`applySheetDiff` 會改動全域的 `itinerary`，測試檔頂端要宣告：

```js
let itinerary = [];
```

（`let` 宣告在模組作用域，direct eval 的函式會綁到它。）

加入這些 check：

```js
const applyFn = FN.applySheetDiff;

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
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `node tests/test-sheet-import.js`
Expected: `FAIL: 在 index.html 找不到 applySheetDiff()`，exit code 1。

- [ ] **Step 3: 實作**

在 `diffSheet()` 之後插入：

```js
// 套用被勾選的差異。missing 只是告知，不刪除任何一天。
function applySheetDiff(diffs){
 const byDate={};itinerary.forEach((d,i)=>{byDate[d.date]=i;});
 diffs.filter(x=>x.kind==='change'&&x.checked).forEach(x=>{
  const i=byDate[x.date];if(i===undefined)return;
  const day=itinerary[i];
  if(x.field==='url'&&t(day.url)!==x.to)delete day.ulabel; // 網址換了，舊按鈕文字會誤導
  if(x.to)day[x.field]=x.to; else delete day[x.field];
 });
 diffs.filter(x=>x.kind==='add'&&x.checked).forEach(x=>{
  const day={};Object.keys(x.day).forEach(k=>{if(x.day[k])day[k]=x.day[k];});
  day.r='persimmon';
  itinerary.push(day);
 });
 itinerary.sort((a,b)=>String(a.date).localeCompare(String(b.date)));
 resequenceDates();
}
```

**排序那一行的用意**：新增天是 `push` 到最後的，若試算表新增的是中間某天，直接 `resequenceDates()` 會把它當成最後一天。先依日期字串排序（`MM/DD` 補零過，字串排序等同日期排序）再重算，位置才正確。

- [ ] **Step 4: 執行測試確認通過**

Run: `node tests/test-sheet-import.js`
Expected: `33/33 passed`，exit code 0。

- [ ] **Step 5: 補一個排序的迴歸測試**

在 `console.log` 之前加入：

```js
check('套用：新增中間某天時會插在正確位置', () => {
  itinerary = [mkDay({ date: '10/21', dest: 'A' }), mkDay({ date: '10/23', dest: 'C' })];
  applyFn([{ kind: 'add', date: '10/22', day: { date: '10/22', dest: 'B', trans: '', stay: '', note: '', url: '' }, checked: true }]);
  assert.deepStrictEqual(itinerary.map(d => d.dest), ['A', 'B', 'C'], '新增的天應插在中間');
  assert.deepStrictEqual(itinerary.map(d => d.date), ['10/21', '10/22', '10/23']);
});
```

Run: `node tests/test-sheet-import.js`
Expected: `34/34 passed`。

**注意：** 請先把 `applySheetDiff` 裡的 `itinerary.sort(...)` 那一行註解掉跑一次，確認這個 check 會紅（會得到 `['A','C','B']`），再改回來確認變綠。否則無法證明這個測試有鑑別力。

- [ ] **Step 6: Commit**

```bash
cd /Users/raychang/tirp
git add index.html tests/test-sheet-import.js
git commit -m "套用試算表差異，保留 app 獨有欄位"
```

---

### Task 5: 抓取與 UI

**Files:**
- Modify: `index.html`（HTML、CSS、JS）

- [ ] **Step 1: 加入常數與抓取函式**

在 `parseCsv()` 之前（`/* ===== 從 Google 試算表匯入 ===== */` 註解之後）插入：

```js
// 公開連結的試算表，用 CSV 匯出端點；Google 有回 CORS 標頭，瀏覽器可直接抓
const SHEET_ID='1JkPtZ1lH585Dclw7pWVbMvl5XLZZ1Y8sGx_jZSNabTw';
const SHEET_GID='78477160';
const SHEET_URL='https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/export?format=csv&gid='+SHEET_GID;
async function fetchSheet(){
 const res=await fetch(SHEET_URL,{cache:'no-store'});
 if(!res.ok)throw new Error('HTTP '+res.status);
 return res.text();
}
```

- [ ] **Step 2: 加入匯入按鈕的 HTML**

找到：
```html
    <button class="add-day" id="add-day" onclick="openDayForm()" style="display:none"></button>
```
在它**後面**加入：
```html
    <button class="sheet-btn" id="sheet-import" onclick="openSheetImport()" style="display:none">⇩ 從試算表更新</button>
```

- [ ] **Step 3: 加入 CSS**

找到 `.add-day:focus-visible{outline:2px solid var(--slate);outline-offset:2px}` 這一行，在它**後面**加入：

```css
.sheet-btn{width:100%;margin-top:8px;appearance:none;border:1.5px dashed var(--slate);background:#eef2f5;cursor:pointer;font-family:var(--sans);font-size:14.5px;font-weight:700;color:var(--slate);padding:13px;border-radius:12px;transition:.15s}
.sheet-btn:hover{background:#e4eaef}
.sheet-btn:disabled{opacity:.55;cursor:default}
.sheet-btn:focus-visible{outline:2px solid var(--slate);outline-offset:2px}
.diff-list{max-height:52vh;overflow-y:auto;margin:4px 0 14px}
.diff-item{display:flex;gap:9px;align-items:flex-start;padding:9px 0;border-bottom:1px solid var(--line)}
.diff-item:last-child{border-bottom:none}
.diff-body{flex:1;min-width:0}
.diff-head{font-size:12px;font-weight:700;color:var(--ink-soft);margin-bottom:3px}
.diff-from{font-size:12.5px;color:var(--ink-faint);text-decoration:line-through;word-break:break-word}
.diff-to{font-size:12.5px;color:var(--ink);word-break:break-word}
.diff-note{font-size:12px;color:var(--ink-faint);padding:7px 0}
```

- [ ] **Step 4: 讓按鈕跟著編輯模式顯示**

在 `renderTimeline()` 結尾找到：
```js
 document.getElementById('add-day').textContent=t(UI.addDay);
```
在它**後面**加入：
```js
 document.getElementById('sheet-import').style.display=editMode?'block':'none';
```

- [ ] **Step 5: 加入差異視窗的 HTML**

在既有的 `<div class="modal" id="modal">…</div>` 這整個區塊**後面**加入：

```html
<div class="modal" id="sheet-modal">
  <div class="modal-card">
    <h3>從試算表更新</h3>
    <div class="diff-list" id="diff-list"></div>
    <div class="m-actions">
      <button class="m-btn cancel" onclick="closeSheetImport()">取消</button>
      <button class="m-btn save" id="sheet-apply" onclick="confirmSheetImport()">套用</button>
    </div>
  </div>
</div>
```

- [ ] **Step 6: 加入 UI 函式**

在 `applySheetDiff()` 之後插入：

```js
let sheetDiffs=[];
const DIFF_LABEL={dest:'目的地',trans:'交通與行程',stay:'住宿',note:'備註',url:'訂票網址'};
async function openSheetImport(){
 const btn=document.getElementById('sheet-import');
 btn.disabled=true;btn.textContent='讀取中…';
 try{
  const parsed=sheetRowsToDays(parseCsv(await fetchSheet()));
  sheetDiffs=diffSheet(parsed.days,itinerary);
  renderSheetDiff(parsed);
  document.getElementById('sheet-modal').classList.add('on');
 }catch(e){
  console.error('讀取試算表失敗',e);
  alert('讀取試算表失敗：'+e.message+'\n\n請確認網路連線，以及試算表仍設為「知道連結的人皆可檢視」。行程資料未變動。');
 }finally{
  btn.disabled=false;btn.textContent='⇩ 從試算表更新';
 }
}
function renderSheetDiff(parsed){
 const changes=sheetDiffs.filter(x=>x.kind!=='missing');
 const notes=[];
 if(parsed.skipped.length)notes.push('第 '+parsed.skipped.join('、')+' 列的日期無法解析，已略過。');
 if(parsed.duplicates.length)notes.push('試算表有重複日期（'+parsed.duplicates.join('、')+'），以最後一列為準。');
 sheetDiffs.filter(x=>x.kind==='missing').forEach(x=>notes.push('試算表沒有 '+x.date+' 這天，行程中的這天不會被刪除。'));
 const rows=changes.map((x,i)=>{
  const body=x.kind==='add'
   ? `<div class="diff-head">${esc(x.date)}　新增這天</div><div class="diff-to">${esc(x.day.dest||'(無目的地)')}</div>`
   : `<div class="diff-head">${esc(x.date)}　${DIFF_LABEL[x.field]||x.field}</div>
      ${x.from?`<div class="diff-from">${esc(x.from)}</div>`:''}
      <div class="diff-to">${x.to?esc(x.to):'（清空）'}</div>`;
  return `<div class="diff-item">
   <input type="checkbox" id="diff-${i}" ${x.checked?'checked':''} onchange="sheetDiffs[${i}].checked=this.checked">
   <label class="diff-body" for="diff-${i}">${body}</label>
  </div>`;
 }).join('');
 const noteHtml=notes.map(n=>`<div class="diff-note">${esc(n)}</div>`).join('');
 document.getElementById('diff-list').innerHTML=
  (changes.length?rows:'<div class="diff-note">試算表與目前行程一致，沒有需要更新的內容。</div>')+noteHtml;
 document.getElementById('sheet-apply').style.display=changes.length?'block':'none';
}
function closeSheetImport(){document.getElementById('sheet-modal').classList.remove('on');sheetDiffs=[];}
async function confirmSheetImport(){
 applySheetDiff(sheetDiffs);
 await pushField('itinerary',itinerary);
 closeSheetImport();renderTimeline();
}
```

**`sheetDiffs` 用全域變數的原因**：checkbox 的 `onchange` 是 inline handler，需要能存取差異清單。這與檔案內既有的 `editingIndex`、`itinerary` 是同一種作法。

- [ ] **Step 7: 驗證所有測試仍通過**

Run: `sh tests/run-all.sh`
Expected: 全部通過（既有 64 項 + 本功能 34 項）。

- [ ] **Step 8: 語法檢查**

Run:
```bash
cd /Users/raychang/tirp && node -e '
const fs=require("fs");const src=fs.readFileSync("index.html","utf8");
const re=/<script>([\s\S]*?)<\/script>/g;let m,i=0;
while((m=re.exec(src))){i++;fs.writeFileSync("/tmp/blk"+i+".js",m[1]);}
console.log("抽出",i,"個區塊");
' && for b in /tmp/blk1.js /tmp/blk2.js; do node --check $b && echo "$(basename $b) OK"; done```
Expected: 兩個區塊都 `OK`。

- [ ] **Step 9: Commit**

```bash
cd /Users/raychang/tirp
git add index.html
git commit -m "加入從試算表匯入的按鈕與差異確認視窗"
```

---

### Task 6: 端對端驗證

**Files:** 無（純驗證）

Chrome 擴充功能可能未連線，無法做瀏覽器自動化。以 Node harness 驗證整條流程，方式與既有的 `tests/test-render.js` 相同。

- [ ] **Step 1: 寫端對端測試**

建立 `tests/test-sheet-e2e.js`：

```js
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
  grab(/const SHEET_FIELDS=[^\n]*\n(\/\/[^\n]*\n)?function diffSheet\(sheetDays,list\)\{[\s\S]*?\n\}/, 'diffSheet()'),
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
```

- [ ] **Step 2: 執行**

Run: `node tests/test-sheet-e2e.js`
Expected: `7/7 passed`，exit code 0。

- [ ] **Step 3: 把新測試加進 run-all.sh**

在 `tests/run-all.sh` 的測試清單中加入兩支新測試：

```sh
for f in test-resequence test-moveday test-datevalidate test-dayform test-legacy test-render test-sheet-import test-sheet-e2e; do
```

- [ ] **Step 4: 更新 tests/README.md**

在測試表格中加入兩列：

| `test-sheet-import.js` | 34 | CSV 解析、列轉換、差異計算、套用差異 |
| `test-sheet-e2e.js` | 7 | 用真實試算表 fixture 跑完整條匯入流程 |

並把總數從 64 改成 105。另外在「兩個要小心的地方」加上第三點：

- **`tests/fixtures/sheet-sample.csv` 是實際試算表的副本。** 試算表若增減欄位或改欄位名稱，`test-sheet-import.js` 會紅——那是正確的警示，不是測試壞了。更新 fixture：`curl -sL "https://docs.google.com/spreadsheets/d/<ID>/export?format=csv&gid=<GID>" -o tests/fixtures/sheet-sample.csv`

- [ ] **Step 5: 跑完整測試**

Run: `sh tests/run-all.sh`
Expected: 全部通過。

- [ ] **Step 6: 實際抓一次線上試算表，確認端點仍可用**

Run:
```bash
node -e '
const fs=require("fs");const src=fs.readFileSync("index.html","utf8");
const url=src.match(/const SHEET_URL=([^\n]*);/)[1];
const id=src.match(/const SHEET_ID=.([^\x27"]+)/)[1];
const gid=src.match(/const SHEET_GID=.([^\x27"]+)/)[1];
console.log("SHEET_ID:",id,"GID:",gid);
' && curl -s -o /tmp/live-sheet.csv -w 'HTTP %{http_code}, %{size_download} bytes\n' -L "https://docs.google.com/spreadsheets/d/$(node -e 'const s=require("fs").readFileSync("index.html","utf8");process.stdout.write(s.match(/const SHEET_ID=.([^\x27"]+)/)[1])')/export?format=csv&gid=$(node -e 'const s=require("fs").readFileSync("index.html","utf8");process.stdout.write(s.match(/const SHEET_GID=.([^\x27"]+)/)[1])')" && head -1 /tmp/live-sheet.csv
```
Expected: `HTTP 200`，第一行是欄位標題。

若與 fixture 內容不同，代表試算表在這段期間被改過——比對一下差異是否合理，必要時更新 fixture。

- [ ] **Step 7: Commit**

```bash
cd /Users/raychang/tirp
git add tests/
git commit -m "新增試算表匯入的端對端測試"
```

---

### Task 7: 人工驗證（使用者執行）

自動化測試涵蓋了解析、比對、套用的邏輯，但下列項目只能在真實瀏覽器確認：

- [ ] 編輯模式下「⇩ 從試算表更新」按鈕有出現、非編輯模式看不到
- [ ] 按下後有「讀取中…」狀態，抓完跳出差異視窗
- [ ] 差異清單的排版在手機寬度下正常（長段落的交通說明會換行、不溢出）
- [ ] 勾選／取消勾選有作用，只有勾的會被套用
- [ ] 按「取消」不會改動任何資料
- [ ] 按「套用」後行程更新，重新整理頁面仍是新的（代表有寫回 Firebase）
- [ ] 關掉網路再按按鈕，跳出錯誤訊息且行程資料不變
- [ ] 把試算表暫時改成「限制存取」再按按鈕，同樣跳錯誤且資料不變（測完記得改回公開）

---

## 完成後

- 用 `superpowers:finishing-a-development-branch` 決定如何整合。
- 合併前先匯出一次 Firebase 的 `trips/<TRIP_ID>` JSON 備份——第一次套用會改寫多天的內容。
