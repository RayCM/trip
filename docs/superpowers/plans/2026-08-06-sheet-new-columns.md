# 試算表新增欄位（雨天備案、參考資料）實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓試算表匯入支援「雨天備案」與「參考資料」兩欄，並在 app 卡片與編輯視窗中呈現與編輯。

**Architecture:** 在 `SHEET_COLS` 引入「選用欄」標記——必要欄缺席仍中止匯入，選用欄缺席則由 `diffSheet` 完全跳過（不可退化成空字串，否則會對每天產生預設勾選的清空差異）。`sheetRowsToDays` 多回傳本次實際存在的欄位集合與 app 不認識的標題。編輯視窗存檔改為 merge，避免未列於表單的欄位被靜默丟掉。

**Tech Stack:** 單一 `index.html`（inline script，無模組系統、無建置流程）；測試以 regex 從原始碼抽函式後 `eval`，用 node 執行，無框架。

**設計文件：** `docs/superpowers/specs/2026-08-06-sheet-new-columns-design.md`

---

## 開始前必讀

**測試怎麼跑：**

```sh
sh tests/run-all.sh          # 全部
node tests/test-sheet-import.js   # 單一支
```

**測試如何取得受測程式碼：** 用 regex 從 `index.html` 抽出函式原始碼再 `eval`。因此**改動函式簽名會讓對應的 regex 找不到目標，測試會直接以「FAIL: 在 index.html 找不到 xxx」退出**。本計畫的 Task 2 會改 `diffSheet` 的簽名，屆時必須同步更新兩支測試裡的 regex。

**專案程式碼風格：** 緊湊寫法（`const a=1;` 無多餘空格）、中文註解說明「為什麼」而非「做什麼」。跟著 `index.html` 現有寫法走，不要套用其他專案的排版習慣。

**四個既有測試會與新行為衝突**，Task 0 到 Task 2 會逐一處理，不是測試壞了：

| 位置 | 現況 | 為何衝突 | 在哪處理 |
|---|---|---|---|
| `tests/fixtures/sheet-sample.csv` | 標題列只有 7 欄，沒有「雨天備案」 | fixture 是舊的試算表副本 | Task 0 |
| `test-sheet-import.js:92` | `deepStrictEqual(rows[0], […7 個欄位])` | 標題列會變成 8 欄 | Task 0 |
| `test-sheet-import.js:110` | `check('轉換：參考資料欄不匯入', …)` | 這正是本次要改掉的行為 | Task 1 |
| `test-sheet-import.js:102-108` | `deepStrictEqual(r.days, [{date,dest,trans,stay,note,url}])` | day 物件會多出 `rain`、`ref` 兩個 key | Task 1 |

另有一個**不需改測試、但必須在實作中處理**的陷阱：`test-sheet-import.js:151` 的 `mkDay` helper 產生的物件沒有 `rain`／`ref`，而差異測試手寫的 sheet 物件同樣沒有。`diffSheet` 若直接用 `sd[f]` 會拿 `''` 與 `undefined` 相比而產生假差異，打掉「差異：完全相同時回空清單」等既有測試。Task 2 的實作以 `sd[f]||''` 解決。

---

## Task 0: 先把 fixture 換成試算表現況

先做這一步，後面每個任務才是對著真實的 8 欄資料跑，而不是等到最後才發現落差。

換 fixture **不需要先改任何程式碼**：現行 `sheetRowsToDays` 用 `head.indexOf(name)` 找欄位，多出來的「雨天備案」只是被忽略的未知欄，`missingCols` 仍為空。

**Files:**
- Modify: `tests/fixtures/sheet-sample.csv`
- Modify: `tests/test-sheet-import.js:88-97`

- [ ] **Step 1: 下載最新的試算表副本**

```sh
curl -sL "https://docs.google.com/spreadsheets/d/1JkPtZ1lH585Dclw7pWVbMvl5XLZZ1Y8sGx_jZSNabTw/export?format=csv&gid=78477160" -o tests/fixtures/sheet-sample.csv
head -1 tests/fixtures/sheet-sample.csv
```

Expected: `日期,目的地,詳細交通與行程細節,住宿地點,備註,訂票網址,雨天備案,參考資料`

- [ ] **Step 2: 執行測試確認失敗**

Run: `node tests/test-sheet-import.js`
Expected: FAIL 一項——`真實試算表：15 列資料、7 個欄位` 的標題列斷言。其餘應全數通過；若有別的項目紅了，代表試算表結構有其他變動，先查清楚。

- [ ] **Step 3: 更新標題列斷言**

`tests/test-sheet-import.js:88-92`，測試名稱與斷言都改成 8 欄：

```js
check('真實試算表：15 列資料、8 個欄位', () => {
  const csv = fs.readFileSync(path.join(__dirname, 'fixtures', 'sheet-sample.csv'), 'utf8');
  const rows = parseCsvFn(csv).filter(r => r.some(c => c.trim()));
  assert.strictEqual(rows.length, 16, '應為 1 列標題 + 15 列資料');
  assert.deepStrictEqual(rows[0], ['日期', '目的地', '詳細交通與行程細節', '住宿地點', '備註', '訂票網址', '雨天備案', '參考資料']);
```

第 93-97 行（`rows[1][0]`、`rows[15][0]`、`きときと市場`）維持不動。

- [ ] **Step 4: 跑全部測試確認綠燈**

Run: `sh tests/run-all.sh`
Expected: `全部通過`

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/sheet-sample.csv tests/test-sheet-import.js
git commit -m "$(cat <<'EOF'
更新試算表 fixture 為現況的 8 欄

試算表新增了「雨天備案」欄。此時匯入功能還沒支援，多出來的欄位
會被忽略，行為不變。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 1: 選用欄語意與 sheetRowsToDays

**Files:**
- Modify: `index.html:810-833`（`SHEET_COLS`、`sheetRowsToDays`）
- Test: `tests/test-sheet-import.js`

- [ ] **Step 1: 先修掉兩個會衝突的既有測試**

`tests/test-sheet-import.js` 第 99 行的 `HEAD` 補上「雨天備案」，並改成與真實試算表相同的欄位順序（雨天備案在參考資料之前）：

```js
const HEAD = ['日期', '目的地', '詳細交通與行程細節', '住宿地點', '備註', '訂票網址', '雨天備案', '參考資料'];
```

第 101-108 行的測試補上兩個新欄位的值與斷言：

```js
check('轉換：日期正規化、欄位對應', () => {
  const r = toDays([HEAD, ['10/21(週三)', '名古屋', '搭機', '花園皇宮', '記得帶護照', 'https://x.com', '地下街', 'https://ref.com']]);
  assert.deepStrictEqual(r.days, [{
    date: '10/21', dest: '名古屋', trans: '搭機', stay: '花園皇宮',
    note: '記得帶護照', url: 'https://x.com', rain: '地下街', ref: 'https://ref.com',
  }]);
  assert.deepStrictEqual(r.skipped, []);
});
```

第 110-113 行「參考資料欄不匯入」整段**刪除**，換成：

```js
check('轉換：雨天備案與參考資料會匯入', () => {
  const r = toDays([HEAD, ['10/21', 'A', '', '', '', '', '雨備內容', 'https://ref.com']]);
  assert.strictEqual(r.days[0].rain, '雨備內容');
  assert.strictEqual(r.days[0].ref, 'https://ref.com');
});
```

其餘用到 `HEAD` 的測試（第 116、122、128、134、332 行）每列資料都要從 7 個值補成 8 個值，補在最後的是空字串。例如第 116 行：

```js
check('轉換：前後空白會被去掉', () => {
  const r = toDays([HEAD, ['  10/21  ', '  名古屋  ', '', '', '', '', '', '']]);
  assert.strictEqual(r.days[0].date, '10/21');
  assert.strictEqual(r.days[0].dest, '名古屋');
});
```

- [ ] **Step 2: 寫新的失敗測試**

加到 `tests/test-sheet-import.js` 第 340 行（`missingCols` 那組測試）之後：

```js
check('轉換：選用欄缺席不算 missingCols', () => {
  const noOptional = ['日期', '目的地', '詳細交通與行程細節', '住宿地點', '備註', '訂票網址'];
  const r = toDays([noOptional, ['10/21', 'A', 'T', 'S', 'N', 'U']]);
  assert.deepStrictEqual(r.missingCols, [], '選用欄缺席不該中止匯入');
});

check('轉換：必要欄缺席仍算 missingCols', () => {
  const noNote2 = ['日期', '目的地', '詳細交通與行程細節', '住宿地點', '訂票網址', '雨天備案', '參考資料'];
  const r = toDays([noNote2, ['10/21', 'A', 'T', 'S', 'U', 'R', 'F']]);
  assert.deepStrictEqual(r.missingCols, ['備註']);
});

check('轉換：presentCols 標示本次實際存在的欄位', () => {
  const noOptional = ['日期', '目的地', '詳細交通與行程細節', '住宿地點', '備註', '訂票網址'];
  const r = toDays([noOptional, ['10/21', 'A', 'T', 'S', 'N', 'U']]);
  assert.strictEqual(r.presentCols.rain, false);
  assert.strictEqual(r.presentCols.ref, false);
  assert.strictEqual(r.presentCols.dest, true);

  const r2 = toDays([HEAD, ['10/21', 'A', 'T', 'S', 'N', 'U', 'R', 'F']]);
  assert.strictEqual(r2.presentCols.rain, true);
  assert.strictEqual(r2.presentCols.ref, true);
});

check('轉換：unknownCols 列出 app 不認識的標題', () => {
  const extra = HEAD.concat(['預算', '同行者']);
  const r = toDays([extra, ['10/21', 'A', 'T', 'S', 'N', 'U', 'R', 'F', '3000', '小明']]);
  assert.deepStrictEqual(r.unknownCols, ['預算', '同行者']);
});

check('轉換：unknownCols 忽略空白標題', () => {
  const extra = HEAD.concat(['', '  ']);
  const r = toDays([extra, ['10/21', 'A', 'T', 'S', 'N', 'U', 'R', 'F', '', '']]);
  assert.deepStrictEqual(r.unknownCols, [], '試算表尾端的空欄不該被當成新欄位');
});
```

- [ ] **Step 3: 執行測試確認失敗**

Run: `node tests/test-sheet-import.js`
Expected: FAIL，訊息包含 `presentCols` 為 undefined（讀取 `.rain` 時丟 TypeError），以及「選用欄缺席不算 missingCols」失敗。

- [ ] **Step 4: 改 SHEET_COLS**

`index.html:810-811` 換成：

```js
// 第三個元素 true 代表選用欄：缺席時不中止匯入，且 diffSheet 會完全跳過它。
// 不能把缺席的欄位當成空字串——那會對每一天產生一筆預設勾選的「清空」差異，整欄被抹掉。
const SHEET_COLS=[['date','日期'],['dest','目的地'],['trans','詳細交通與行程細節'],
 ['stay','住宿地點'],['note','備註'],['url','訂票網址'],
 ['rain','雨天備案',true],['ref','參考資料',true]];
```

- [ ] **Step 5: 改 sheetRowsToDays**

`index.html:812-833` 整個函式換成：

```js
function sheetRowsToDays(rows){
 const days=[],skipped=[],duplicates=[],missingCols=[],unknownCols=[],presentCols={},seen={};
 const required=SHEET_COLS.filter(c=>!c[2]).map(c=>c[1]);
 if(!rows.length)return{days,skipped,duplicates,missingCols:required,unknownCols,presentCols};
 const head=rows[0].map(h=>String(h||'').trim());
 const idx={};
 // 必要欄找不到時不能當成空值——那會對每一天產生一筆「清空」差異且預設勾選，整欄被抹掉。
 // 抓不到欄位多半代表標題被改名，或根本沒拿到 CSV（試算表被改成私人時 Google 回的是 HTML）。
 SHEET_COLS.forEach(([k,name,optional])=>{
  idx[k]=head.indexOf(name);
  presentCols[k]=idx[k]>=0;
  if(idx[k]<0&&!optional)missingCols.push(name);
 });
 if(missingCols.length)return{days,skipped,duplicates,missingCols,unknownCols,presentCols};
 // app 不認識的標題只做告知，不猜它該怎麼顯示。空白標題是試算表尾端的空欄，不算。
 const known=SHEET_COLS.map(c=>c[1]);
 head.forEach(h=>{if(h&&known.indexOf(h)<0&&unknownCols.indexOf(h)<0)unknownCols.push(h);});
 const val=(row,k)=>idx[k]<0?'':String(row[idx[k]]||'').trim();
 rows.slice(1).forEach((row,i)=>{
  if(!row.some(c=>String(c||'').trim()))return; // 整列空白，忽略
  const d=parseMD(val(row,'date'));
  if(!d){skipped.push(i+2);return;} // +2：跳過標題列且轉成 1-based
  const date=String(d.getMonth()+1).padStart(2,'0')+'/'+String(d.getDate()).padStart(2,'0');
  const day={date,dest:val(row,'dest'),trans:val(row,'trans'),
   stay:val(row,'stay'),note:val(row,'note'),url:val(row,'url'),
   rain:val(row,'rain'),ref:val(row,'ref')};
  if(date in seen){days[seen[date]]=day;duplicates.push(date);} // 重複日期以最後一列為準
  else{seen[date]=days.length;days.push(day);}
 });
 return{days,skipped,duplicates,missingCols,unknownCols,presentCols};
}
```

- [ ] **Step 6: 執行測試確認通過**

Run: `node tests/test-sheet-import.js`
Expected: PASS（`diffSheet`／`renderSheetDiff` 相關項目此時仍應維持通過；若有失敗屬 Task 2、Task 3 範圍，先確認失敗訊息只出現在那些項目）

- [ ] **Step 7: Commit**

```bash
git add index.html tests/test-sheet-import.js
git commit -m "$(cat <<'EOF'
試算表匯入支援雨天備案與參考資料兩欄

SHEET_COLS 加入選用欄標記：必要欄缺席仍中止匯入，選用欄缺席
不中止。sheetRowsToDays 多回傳 presentCols 與 unknownCols。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: diffSheet 跳過缺席的選用欄

**Files:**
- Modify: `index.html:834`（`SHEET_FIELDS`）、`index.html:836-853`（`diffSheet`）、`index.html:889-891`（`openSheetImport` 的呼叫）
- Modify: `tests/test-sheet-import.js:27`、`tests/test-sheet-e2e.js:27`（抽取用 regex）
- Test: `tests/test-sheet-import.js`

- [ ] **Step 1: 寫失敗測試**

加到 `tests/test-sheet-import.js` 第 220 行附近（`diffFn` 那組測試的最後）：

```js
check('差異：選用欄缺席時完全不比對該欄', () => {
  const sheet = [{ date: '10/21', dest: 'A', trans: '', stay: '', note: '', url: '', rain: '', ref: '' }];
  const app = [{ date: '10/21', dest: 'A', rain: '原本的雨備', ref: 'https://old.com' }];
  const present = { date: true, dest: true, trans: true, stay: true, note: true, url: true, rain: false, ref: false };
  const d = diffFn(sheet, app, present);
  assert.deepStrictEqual(d, [], '欄位缺席時不能產生清空差異');
});

check('差異：選用欄存在且被清空時照常產生差異', () => {
  const sheet = [{ date: '10/21', dest: 'A', trans: '', stay: '', note: '', url: '', rain: '', ref: '' }];
  const app = [{ date: '10/21', dest: 'A', rain: '原本的雨備' }];
  const present = { date: true, dest: true, trans: true, stay: true, note: true, url: true, rain: true, ref: true };
  const d = diffFn(sheet, app, present).filter(x => x.field === 'rain');
  assert.strictEqual(d.length, 1, '欄位存在但該格清空，是真的要清空');
  assert.strictEqual(d[0].to, '');
});

check('差異：不傳 presentCols 時視為全部存在', () => {
  const sheet = [{ date: '10/21', dest: 'A', trans: '', stay: '', note: '', url: '', rain: '新雨備', ref: '' }];
  const app = [{ date: '10/21', dest: 'A' }];
  const d = diffFn(sheet, app).filter(x => x.field === 'rain');
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].to, '新雨備');
});

check('差異：雨天備案與參考資料會被比對到', () => {
  const sheet = [{ date: '10/21', dest: 'A', trans: '', stay: '', note: '', url: '', rain: '地下街', ref: 'https://r.com' }];
  const app = [{ date: '10/21', dest: 'A' }];
  const d = diffFn(sheet, app);
  assert.ok(d.some(x => x.field === 'rain' && x.to === '地下街'));
  assert.ok(d.some(x => x.field === 'ref' && x.to === 'https://r.com'));
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `node tests/test-sheet-import.js`
Expected: FAIL，「選用欄缺席時完全不比對該欄」得到兩筆清空差異而非空陣列。

- [ ] **Step 3: 改 SHEET_FIELDS**

`index.html:834` 換成：

```js
const SHEET_FIELDS=[['dest','目的地'],['trans','交通與行程'],['stay','住宿'],['note','備註'],['url','訂票網址'],['rain','雨天備案'],['ref','參考資料']];
```

- [ ] **Step 4: 改 diffSheet 簽名與比對邏輯**

`index.html:836-853`，把函式第一行與 `SHEET_FIELDS.forEach` 那段換成：

```js
// 比對試算表與目前行程，回傳差異清單。app 端的值可能是舊的 {zh,en,ja} 物件，一律用 t() 取中文比。
// presentCols 標示試算表本次實際有哪些欄位；省略時視為全部存在。缺席的選用欄必須整個跳過，
// 當成空字串會對每一天產生一筆預設勾選的清空差異。
function diffSheet(sheetDays,list,presentCols){
 const diffs=[],byDate={};
 list.forEach((d,i)=>{byDate[d.date]=i;});
 sheetDays.forEach(sd=>{
  const i=byDate[sd.date];
  // 新增天預設勾選：試算表若在中間插入一天，後面每天的內容都會往後位移一格（都是 change、
  // 預設勾選），被擠到最後的那天則是 add。不勾它就會讓最後一天的內容靜默消失。
  // 多出一天很容易刪掉，內容不見了救不回來。
  if(i===undefined){diffs.push({kind:'add',date:sd.date,day:sd,checked:true});return;}
  SHEET_FIELDS.forEach(([f])=>{
   if(presentCols&&!presentCols[f])return;
   // to 補 ''：sheetRowsToDays 產生的 day 每個欄位都有值，但手寫的比對來源可能缺 key，
   // undefined 與 '' 不相等會變成一筆假差異
   const from=t(list[i][f]),to=sd[f]||'';
   if(from!==to)diffs.push({kind:'change',date:sd.date,field:f,from,to,checked:true});
  });
 });
 const sheetDates={};sheetDays.forEach(d=>{sheetDates[d.date]=true;});
 list.forEach(d=>{if(!sheetDates[d.date])diffs.push({kind:'missing',date:d.date});});
 return diffs;
}
```

- [ ] **Step 5: 讓 openSheetImport 傳入 presentCols**

`index.html:891` 換成：

```js
  sheetDiffs=diffSheet(parsed.days,itinerary,parsed.presentCols);
```

- [ ] **Step 6: 更新兩支測試的抽取 regex**

簽名改了，原本寫死 `diffSheet\(sheetDays,list\)` 的 regex 會找不到函式。

`tests/test-sheet-import.js:27` 與 `tests/test-sheet-e2e.js:27`，兩處都換成：

```js
  grab(/function diffSheet\(sheetDays,list,presentCols\)\{[\s\S]*?\n\}/, 'diffSheet()'),
```

- [ ] **Step 7: 執行測試確認通過**

Run: `node tests/test-sheet-import.js && node tests/test-sheet-e2e.js`
Expected: 兩支都 PASS。若出現「FAIL: 在 index.html 找不到 diffSheet()」，代表 Step 6 的 regex 與 Step 4 的實際簽名不一致，逐字比對後修正。

- [ ] **Step 8: Commit**

```bash
git add index.html tests/test-sheet-import.js tests/test-sheet-e2e.js
git commit -m "$(cat <<'EOF'
diffSheet 跳過試算表中缺席的選用欄

欄位缺席時當成空字串會對每一天產生預設勾選的清空差異，
整欄被抹掉。改由 presentCols 明確標示要比對哪些欄位。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 差異視窗的欄位標籤與未知欄位提示

**Files:**
- Modify: `index.html:884`（`DIFF_LABEL`）、`index.html:901-908`（`renderSheetDiff` 的 notes）
- Test: `tests/test-sheet-import.js`

- [ ] **Step 1: 寫失敗測試**

`tests/test-sheet-import.js` 第 343 行有共用的 `noSkips` 物件，因為 `renderSheetDiff` 會讀 `parsed.unknownCols`，先把它補齊：

```js
const noSkips = { skipped: [], duplicates: [], missingCols: [], unknownCols: [] };
```

然後加到 `renderSheetDiff` 那組測試的最後：

```js
check('差異視窗：雨天備案與參考資料有中文標籤', () => {
  sheetDiffs = [{ kind: 'change', date: '10/21', field: 'rain', from: '', to: '地下街', checked: true },
                { kind: 'change', date: '10/21', field: 'ref', from: '', to: 'https://r.com', checked: true }];
  renderFn(noSkips);
  const html = els['diff-list'].innerHTML;
  assert.ok(html.includes('雨天備案'), '不該直接顯示英文欄位名 rain');
  assert.ok(html.includes('參考資料'), '不該直接顯示英文欄位名 ref');
});

check('差異視窗：列出 app 不認識的試算表欄位', () => {
  sheetDiffs = [];
  renderFn({ skipped: [], duplicates: [], missingCols: [], unknownCols: ['預算', '同行者'] });
  const html = els['diff-list'].innerHTML;
  assert.ok(html.includes('預算') && html.includes('同行者'), '新欄位要告知使用者，不能靜默忽略');
});

check('差異視窗：沒有未知欄位時不顯示該提示', () => {
  sheetDiffs = [];
  renderFn(noSkips);
  assert.ok(!els['diff-list'].innerHTML.includes('未使用'));
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `node tests/test-sheet-import.js`
Expected: FAIL，標籤測試顯示 `rain`／`ref` 而非中文，未知欄位提示不存在。

- [ ] **Step 3: 改 DIFF_LABEL**

`index.html:884` 換成：

```js
const DIFF_LABEL={dest:'目的地',trans:'交通與行程',stay:'住宿',note:'備註',url:'訂票網址',rain:'雨天備案',ref:'參考資料'};
```

- [ ] **Step 4: 在 renderSheetDiff 加未知欄位提示**

`index.html:908` 之後（`missing` 那行 forEach 之後、`const rows=` 之前）插入：

```js
 // 試算表加了新欄位時要讓使用者知道，否則會以為 app 讀進來了
 if(parsed.unknownCols&&parsed.unknownCols.length)notes.push('試算表有 app 未使用的欄位：'+parsed.unknownCols.join('、')+'。需要顯示的話再告訴我。');
```

- [ ] **Step 5: 執行測試確認通過**

Run: `node tests/test-sheet-import.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add index.html tests/test-sheet-import.js
git commit -m "$(cat <<'EOF'
差異視窗顯示新欄位標籤與未使用的試算表欄位

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 行程卡片渲染

**Files:**
- Modify: `index.html:503-511`（UI 文字常數）、`index.html:715-731`（`renderTimeline`）
- Modify: `tests/test-render.js:49-56`（接住 eval 回傳值）、`tests/test-render.js:65`（加 `withDays` 工具）
- Test: `tests/test-render.js`

- [ ] **Step 1: 讓 test-render.js 能餵自訂資料重新渲染**

`test-render.js` 目前把整段 app script `eval` 起來執行 init，但**沒有把尾端運算式的回傳值接住**（第 51-56 行只有 `try { eval(...) } catch`），所以測試只能檢查 init 當下渲染的結果，無法自己給資料。

第 49-56 行換成：

```js
// ---- 執行整段 app script ----
// FB_READY 會是 false（沒有 window.TRIP_CONFIG、沒有 firebase），走本機模式分支
let ranWithoutThrow = true, thrown = null, R = null;
try {
  // 尾端運算式把要檢查的東西交出來
  R = eval(app + '\n;({renderAll,renderTimeline,renderTodos,renderExpenses,applyStatic,updateSeed,itinerary,cd,seedSubHtml,t})');
} catch (e) {
  ranWithoutThrow = false;
  thrown = e;
}
```

接著在 `const text = id => …`（第 65 行）之後加一個工具函式。`itinerary` 是 `eval` 作用域裡的 `let`，外面拿到的是同一個陣列的引用——**只能就地改動，不能整個替換**，否則 `renderTimeline` 讀到的還是舊陣列：

```js
// itinerary 只能就地改動（外部拿到的是同一個陣列引用，重新指派不會影響 eval 作用域內的變數）。
// 跑完復原，否則後面檢查真實 15 天資料的測試會受影響。
const withDays = (days, fn) => {
  const saved = R.itinerary.slice();
  R.itinerary.length = 0;
  days.forEach(d => R.itinerary.push(d));
  R.renderTimeline();
  try { fn(); }
  finally {
    R.itinerary.length = 0;
    saved.forEach(d => R.itinerary.push(d));
    R.renderTimeline();
  }
};
```

- [ ] **Step 2: 寫失敗測試**

加到 `tests/test-render.js` 的行程頁測試之後：

```js
check('行程卡片：有雨天備案時顯示該列', () => {
  withDays([{ date: '10/21', dest: 'A', trans: 'T', stay: 'S', rain: '逛地下街' }], () => {
    const tl = html('timeline');
    assert.ok(tl.includes('逛地下街'), '雨天備案內容沒有渲染出來');
    assert.ok(tl.includes('☂'));
  });
});

check('行程卡片：沒有雨天備案時不渲染空列', () => {
  withDays([{ date: '10/21', dest: 'A', trans: 'T', stay: 'S' }], () => {
    assert.ok(!html('timeline').includes('☂'), '空值不能渲染出空白列');
  });
});

check('行程卡片：參考資料渲染成連結', () => {
  withDays([{ date: '10/21', dest: 'A', trans: 'T', stay: 'S', ref: 'https://ref.com' }], () => {
    const tl = html('timeline');
    assert.ok(tl.includes('href="https://ref.com"'));
    assert.ok(tl.includes('參考資料'));
  });
});

check('行程卡片：沒有參考資料時不渲染按鈕', () => {
  withDays([{ date: '10/21', dest: 'A', trans: 'T', stay: 'S' }], () => {
    assert.ok(!html('timeline').includes('reflink'), '空值不能渲染出空按鈕');
  });
});
```

- [ ] **Step 3: 執行測試確認失敗**

Run: `node tests/test-render.js`
Expected: FAIL，找不到 `逛地下街` 與 `☂`。既有的 15 天測試應仍然通過——若它們也紅了，代表 Step 1 的 `withDays` 沒有正確復原資料。

- [ ] **Step 4: 加 UI 文字常數**

`index.html:511`（`bookGeneric:'訂票連結',`）之後插入：

```js
 refGeneric:'參考資料',
```

- [ ] **Step 5: 加卡片渲染**

`index.html:716` 之後插入：

```js
  const rainRow=d.rain&&t(d.rain)?`<div class="row rain"><span class="lbl">☂</span><span>${esc(t(d.rain))}</span></div>`:'';
  const reflink=d.ref?`<a class="booklink reflink" href="${esc(d.ref)}" target="_blank" rel="noopener">📖 ${esc(t(UI.refGeneric))} ↗</a>`:'';
```

`index.html:731` 的 `${noteRow}${link}${tools}` 換成：

```js
    ${noteRow}${rainRow}${link}${reflink}${tools}
```

- [ ] **Step 6: 執行測試確認通過**

Run: `node tests/test-render.js`
Expected: PASS

- [ ] **Step 7: 更新中文字串快照**

新增了 `refGeneric` 這個 UI 字串，快照基準線會 MISMATCH。確認 diff 只有預期的新增之後更新：

```sh
node tests/i18n-snapshot.js > tests/baseline.json
git diff tests/baseline.json
```

Expected: diff 只有 `refGeneric` 一項（以及 UI keys 陣列因排序而多出該鍵）。若出現其他字串的增減，代表誤刪了東西，先查清楚再繼續。

- [ ] **Step 8: Commit**

```bash
git add index.html tests/test-render.js tests/baseline.json
git commit -m "$(cat <<'EOF'
行程卡片顯示雨天備案與參考資料

雨天備案是長文字，仿備註的列結構；參考資料是網址，做成連結按鈕。
兩者都有空值守衛——參考資料多數天沒有值，不能渲染出空按鈕。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 編輯視窗與 merge 存檔

**Files:**
- Modify: `index.html:372-374`（表單 HTML）、`index.html:503-505`（UI 標籤）、`index.html:959-973`（`openDayForm`）、`index.html:988-994`（`saveDayForm`）
- Test: `tests/test-dayform.js`

- [ ] **Step 1: 寫失敗測試**

`test-dayform.js` 的 DOM stub 會自動建立任何沒見過的 id（`getElementById: id => els[id] || (els[id] = mkEl(id))`），所以不需要為新欄位補 stub。受測函式在該檔中叫 `openForm` / `saveForm`（不是 `openDayForm` / `saveDayForm`——外層同名會與 direct eval 的函式宣告撞名）。

加到 `tests/test-dayform.js` 既有測試之後：

```js
check('存檔：保留未列在表單中的欄位', async () => {
  reset();
  itinerary = [{ date: '10/21', dest: 'A', trans: 'T', stay: 'S', mystery: '不該消失' }];
  openForm(0);
  await saveForm();
  assert.strictEqual(itinerary[0].mystery, '不該消失', '表單沒列到的欄位不能被丟掉');
});

check('存檔：雨天備案與參考資料會寫回', async () => {
  reset();
  itinerary = [{ date: '10/21', dest: 'A', trans: 'T', stay: 'S' }];
  openForm(0);
  document.getElementById('m-rain').value = '逛地下街';
  document.getElementById('m-ref').value = 'https://ref.com';
  await saveForm();
  assert.strictEqual(itinerary[0].rain, '逛地下街');
  assert.strictEqual(itinerary[0].ref, 'https://ref.com');
});

check('存檔：兩欄留空時刪除該欄而不是留空字串', async () => {
  reset();
  itinerary = [{ date: '10/21', dest: 'A', trans: 'T', stay: 'S', rain: '舊的', ref: 'https://old.com' }];
  openForm(0);
  document.getElementById('m-rain').value = '';
  document.getElementById('m-ref').value = '';
  await saveForm();
  assert.ok(!('rain' in itinerary[0]), '留空應刪除欄位而不是留下空字串');
  assert.ok(!('ref' in itinerary[0]));
});

check('編輯視窗：帶入現有的雨天備案與參考資料', () => {
  reset();
  itinerary = [{ date: '10/21', dest: 'A', rain: '地下街', ref: 'https://r.com' }];
  openForm(0);
  assert.strictEqual(document.getElementById('m-rain').value, '地下街');
  assert.strictEqual(document.getElementById('m-ref').value, 'https://r.com');
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `node tests/test-dayform.js`
Expected: FAIL，`mystery` 欄位在存檔後消失、`m-rain` 的值沒有寫回。

- [ ] **Step 3: 加表單 HTML**

`index.html:372`（備註那行）之後插入：

```html
      <div class="field full"><label id="ml-rain" for="m-rain"></label><textarea id="m-rain" rows="2"></textarea></div>
      <div class="field full"><label id="ml-ref" for="m-ref"></label><input type="text" id="m-ref" placeholder="https://"></div>
```

- [ ] **Step 4: 加 UI 標籤常數**

`index.html:503`（`fNote2:'備註（選填）',`）之後插入：

```js
 fRain:'雨天備案（選填）',
 fRef:'參考資料（選填）',
```

- [ ] **Step 5: 在 openDayForm 帶入現值與標籤**

`index.html:959`（`m-note` 那行）之後插入：

```js
 document.getElementById('m-rain').value=t(d.rain);
 document.getElementById('m-ref').value=d.ref||'';
```

`index.html:971`（`ml-note` 那行）之後插入：

```js
 document.getElementById('ml-rain').textContent=t(UI.fRain);
 document.getElementById('ml-ref').textContent=t(UI.fRef);
```

- [ ] **Step 6: 改 saveDayForm 為 merge**

`index.html:988-994` 換成：

```js
 // 以現有的那天為基底，表單沒列到的欄位（未來新增的欄位、只存在於試算表的資料）才不會被丟掉。
 // 表單管理的欄位語意不變：留空就刪除該欄。
 const base=editingIndex!=null?itinerary[editingIndex]:{};
 const day=Object.assign({},base,{date:v('m-date'),r:document.getElementById('m-region').value,
  dest:dest,trans:v('m-trans'),stay:v('m-stay'),stayUrl:v('m-stayurl'),note:v('m-note'),
  url:v('m-url'),ulabel:v('m-ulabel'),rain:v('m-rain'),ref:v('m-ref'),
  leaf:document.getElementById('m-leaf').checked});
 if(!day.note)delete day.note;
 if(!day.stayUrl)delete day.stayUrl;
 if(!day.rain)delete day.rain;
 if(!day.ref)delete day.ref;
 if(!day.url){delete day.url;delete day.ulabel;}
 if(editingIndex!=null)itinerary[editingIndex]=day; else itinerary.push(day);
```

- [ ] **Step 7: 執行測試確認通過**

Run: `node tests/test-dayform.js`
Expected: PASS

- [ ] **Step 8: 更新中文字串快照**

```sh
node tests/i18n-snapshot.js > tests/baseline.json
git diff tests/baseline.json
```

Expected: diff 只有 `fRain`、`fRef` 兩項新增。

- [ ] **Step 9: Commit**

```bash
git add index.html tests/test-dayform.js tests/baseline.json
git commit -m "$(cat <<'EOF'
編輯視窗可修改雨天備案與參考資料，存檔改為 merge

原本 itinerary[i]=day 是整包覆蓋，表單沒列到的欄位會在使用者
編輯那天時被靜默丟掉。改成以現有那天為基底 merge。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 端對端測試與文件收尾

**Files:**
- Modify: `tests/test-sheet-e2e.js`
- Modify: `tests/README.md`
- Modify: `docs/superpowers/specs/2026-08-05-sheet-import-design.md`

- [ ] **Step 1: 執行端對端測試看現況**

Run: `node tests/test-sheet-e2e.js`
Expected: 全部通過。既有七項斷言都不該因新欄位而改變——`add`／`missing` 筆數不受影響、冪等性不受影響、`leaf`／`r`／住宿連結的保護也不受影響。**若有任何一項紅了，先查清楚原因再繼續，不要直接改斷言遷就結果。**

唯一需要主動擴充的是「全部套用後，行程內容與試算表一致」那項的欄位清單（第 65 行），把兩個新欄位納入檢查：

```js
    ['dest', 'trans', 'stay', 'note', 'url', 'rain', 'ref'].forEach(f => {
      assert.strictEqual(FN.t(day[f]), sd[f], `${sd.date} 的 ${f} 不一致`);
    });
```

- [ ] **Step 2: 加端對端測試**

該檔已有模組層級的 `csv`（fixture 內容）與 `parsed`（解析結果），受測函式掛在 `FN` 上。加到既有測試之後：

```js
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

check('端對端：未使用的欄位會被回報', () => {
  const rows = FN.parseCsv(csv);
  const withExtra = rows.map((r, i) => i === 0 ? r.concat(['預算']) : r.concat(['3000']));
  const p2 = FN.sheetRowsToDays(withExtra);
  assert.deepStrictEqual(p2.unknownCols, ['預算']);
  assert.deepStrictEqual(p2.missingCols, [], '多出欄位不該影響匯入');
});
```

- [ ] **Step 3: 跑全部測試**

Run: `sh tests/run-all.sh`
Expected: 全部通過，最後一行 `全部通過`。若 `i18n-snapshot` MISMATCH，代表 Task 4／Task 5 的 baseline 更新沒做完整，重跑 `node tests/i18n-snapshot.js > tests/baseline.json` 並檢視 diff。

- [ ] **Step 4: 更新測試文件的項數表**

`tests/README.md` 的表格中 `test-sheet-import.js`、`test-sheet-e2e.js`、`test-render.js`、`test-dayform.js` 四列的項數改成實際數字（各支測試執行後最後一行會印出通過項數），並更新表格下方的總數。

同時把 fixture 那段說明補上一句，因為欄位缺席的行為已經改變：

```markdown
- **`tests/fixtures/sheet-sample.csv` 是 Google 試算表的副本。** 試算表若增減欄位或改欄位名稱，`test-sheet-import.js` 會紅——那是正確的警示，代表匯入功能的欄位對應要跟著更新，不是測試壞了。其中「雨天備案」與「參考資料」是選用欄，從試算表移除它們不會中止匯入，也不會清空 app 上已有的資料。
```

- [ ] **Step 5: 更新舊設計文件的限制段落**

`docs/superpowers/specs/2026-08-05-sheet-import-design.md:159` 的限制清單補上一行，指向新的設計文件：

```markdown
- **欄位對應已於 2026-08-06 擴充**：新增「雨天備案」「參考資料」兩個選用欄，見 `2026-08-06-sheet-new-columns-design.md`。
```

- [ ] **Step 6: Commit**

```bash
git add tests/ docs/
git commit -m "$(cat <<'EOF'
補端對端測試與文件更新

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 完成後的人工驗證

自動測試涵蓋不到「在真實瀏覽器裡看起來對不對」。實作完成後：

1. 用瀏覽器開啟 `index.html`
2. 進入編輯模式 → 按「⇩ 從試算表更新」
3. 確認差異視窗列出雨天備案的內容，且**沒有**出現任何非預期的「（清空）」項目
4. 套用後確認卡片上出現 ☂ 那列，以及 10/25 那天（唯一有參考資料的）出現 📖 按鈕
5. 編輯任一天並存檔，再按一次「從試算表更新」，確認不會冒出剛剛編輯過的欄位以外的差異
