# 試算表「行程詳細版」欄 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓試算表的「行程詳細版」欄（每天一個詳細說明頁網址）匯入 app，並在行程卡片上顯示成可點的連結按鈕。

**Architecture:** 新增一個標記為選用的 `detail` 欄，完全比照既有的 `ref`（參考資料）欄——同樣的選用語意、同樣的 `.booklink` 按鈕形狀、同樣的「留空即刪欄」表單行為。不新增任何機制。

**Tech Stack:** 單檔 `index.html`（原生 JS，無建置流程）。測試是 `tests/*.js`，用 node 從 `index.html` 原始碼把函式 eval 出來跑，沒有測試框架。跑法：`sh tests/run-all.sh`。

**設計文件：** `docs/superpowers/specs/2026-08-25-sheet-detail-column-design.md`

---

## File Structure

單一檔案專案，所有程式改動都在 `index.html`。各段落職責：

| 位置 | 職責 | 本次改動 |
|---|---|---|
| `index.html` `UI`（約 480–540 行） | 所有中文介面字串 | 加 `fDetail`、`detailGeneric` |
| `index.html` modal HTML（約 386–390 行） | 編輯視窗的欄位 | 加 `m-detail` 輸入格 |
| `index.html` `renderTimeline()`（約 740–765 行） | 行程卡片渲染 | 加 `detaillink` |
| `index.html` `SHEET_COLS`（842 行） | 試算表欄名 ↔ 內部欄位的對應 | 加選用欄 `detail` |
| `index.html` `sheetRowsToDays()`（845 行起） | CSV → day 物件 | day 物件加 `detail` |
| `index.html` `SHEET_FIELDS`（876 行） | 差異比對要看哪些欄位 | 加 `detail` |
| `index.html` `DIFF_LABEL`（931 行） | 差異視窗的欄位中文名 | 加 `detail` |
| `index.html` `openDayForm()`/`saveDayForm()`（約 1000–1055 行） | 編輯視窗讀寫 | 讀寫 `m-detail` |
| `tests/fixtures/sheet-sample.csv` | 試算表副本 | **只加一欄，不整份重抓**（見 Task 4） |

---

## ⚠️ 兩個實作前必須知道的陷阱

**1. `tests/fixtures/sheet-sample.csv` 不能照 `tests/README.md` 說的整份重抓。**

`tests/README.md` 寫「試算表若增減欄位…更新 fixture：`curl … -o tests/fixtures/sheet-sample.csv`」。**這次不能照做。**

`test-sheet-e2e.js` 的設計前提是「fixture 的內容與 `DEFAULT_DAYS` 不一致」，用來模擬 app 與試算表有落差的情境。它明確斷言 fixture 的 10/27 是「新倉淺間神社、河口湖」而 `DEFAULT_DAYS` 的 10/27 是上高地。

但 repo 與試算表現在已經完全同步（15 天 × 4 欄逐格比對過）。整份重抓會讓 fixture 與 `DEFAULT_DAYS` 一模一樣，差異比對測試就沒有東西可比，等於把測試掏空。

**正確做法：只在 fixture 上補一欄**，其餘內容原封不動。fixture 的職責是「一份欄位結構正確、但內容與 app 不同的試算表」，不是「試算表的即時鏡像」。Task 4 會同時把這個理由寫進 `tests/README.md`，避免下次有人照舊做法把測試弄壞。

**2. 加 `detail` 到 day 物件會讓一個既有斷言變紅，那是預期的。**

`sheetRowsToDays()` 的 `day` 物件把每個欄位都設值，欄位不存在時 `val()` 回 `''`。所以加了 `detail:val(row,'detail')` 之後，即使試算表沒有這欄，產生的 day 也會有 `detail:''`。

`tests/test-sheet-import.js:102` 用 `deepStrictEqual` 比對完整的 day 物件（目前列 8 個 key），會因此變紅。Task 1 會一併更新它。**這是正確的行為**：`presentCols.detail` 為 `false` 時 `diffSheet` 會整個跳過該欄，`''` 不會造成清空。

---

## Task 1: 匯入層認得「行程詳細版」

**Files:**
- Modify: `index.html:842`（`SHEET_COLS`）、`index.html:869`（`sheetRowsToDays` 的 day 物件）、`index.html:876`（`SHEET_FIELDS`）、`index.html:931`（`DIFF_LABEL`）
- Test: `tests/test-sheet-import.js`

- [ ] **Step 1: 寫失敗的測試**

在 `tests/test-sheet-import.js` 中，找到 `const HEAD = [...]`（第 98 行）**下方**，加入一個 9 欄的標題常數與三個新測試。`HEAD` 本身保持 8 欄不動——它現在同時扮演「選用欄缺席」的情境。

```js
const HEAD9 = ['日期', '目的地', '詳細交通與行程細節', '住宿地點', '備註', '訂票網址', '雨天備案', '參考資料', '行程詳細版'];

check('轉換：行程詳細版會匯入', () => {
  const r = toDays([HEAD9, ['10/21', 'A', '', '', '', '', '', '', 'https://detail.example/1']]);
  assert.strictEqual(r.days[0].detail, 'https://detail.example/1');
  assert.strictEqual(r.presentCols.detail, true);
});

check('轉換：行程詳細版缺席不算 missingCols', () => {
  const r = toDays([HEAD, ['10/21', 'A', '', '', '', '', '', '']]);
  assert.deepStrictEqual(r.missingCols, [], '選用欄缺席不該中止匯入');
  assert.strictEqual(r.presentCols.detail, false);
});

check('轉換：欄位順序對調不影響匯入', () => {
  const shuffled = ['日期', '目的地', '詳細交通與行程細節', '住宿地點', '備註', '訂票網址', '參考資料', '雨天備案', '行程詳細版'];
  const r = toDays([shuffled, ['10/21', 'A', '', '', '', '', 'https://ref.com', '雨備內容', 'https://detail.example/1']]);
  assert.strictEqual(r.days[0].ref, 'https://ref.com', '欄位是依欄名查索引，不依位置');
  assert.strictEqual(r.days[0].rain, '雨備內容');
  assert.strictEqual(r.days[0].detail, 'https://detail.example/1');
});
```

接著在同檔案的差異比對測試區塊，找到 `const ALL_PRESENT = {...}`（第 224 行），把它換成含 `detail` 的版本，並在其後加一個新測試：

```js
const ALL_PRESENT = { date: true, dest: true, trans: true, stay: true, note: true, url: true, rain: true, ref: true, detail: true };

check('差異：行程詳細版會被比對到', () => {
  const sheet = [{ date: '10/21', dest: 'A', trans: '', stay: '', note: '', url: '', rain: '', ref: '', detail: 'https://d.com' }];
  const app = [{ date: '10/21', dest: 'A' }];
  const d = diffFn(sheet, app, ALL_PRESENT);
  assert.ok(d.some(x => x.field === 'detail' && x.to === 'https://d.com'));
});

check('差異：行程詳細版缺席時完全不比對該欄', () => {
  const sheet = [{ date: '10/21', dest: 'A', trans: '', stay: '', note: '', url: '', rain: '', ref: '', detail: '' }];
  const app = [{ date: '10/21', dest: 'A', detail: 'https://old.com' }];
  const present = Object.assign({}, ALL_PRESENT, { detail: false });
  assert.strictEqual(diffFn(sheet, app, present).filter(x => x.field === 'detail').length, 0,
    '欄位從試算表移除，不等於要清空 app 上已有的資料');
});
```

最後更新第 100–107 行那個既有測試（見上方陷阱 2），把 `detail: ''` 加進預期的 day 物件：

```js
check('轉換：日期正規化、欄位對應', () => {
  const r = toDays([HEAD, ['10/21(週三)', '名古屋', '搭機', '花園皇宮', '記得帶護照', 'https://x.com', '地下街', 'https://ref.com']]);
  assert.deepStrictEqual(r.days, [{
    date: '10/21', dest: '名古屋', trans: '搭機', stay: '花園皇宮',
    note: '記得帶護照', url: 'https://x.com', rain: '地下街', ref: 'https://ref.com',
    detail: '',
  }]);
  assert.deepStrictEqual(r.skipped, []);
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node tests/test-sheet-import.js`
Expected: FAIL。新的三個轉換測試會在 `r.days[0].detail` 是 `undefined` 時失敗；`presentCols.detail` 也是 `undefined`。「轉換：日期正規化、欄位對應」會因為預期多了 `detail: ''` 而失敗。

- [ ] **Step 3: 加上欄位定義**

`index.html:842`，`SHEET_COLS` 末尾加一個選用欄（第三個元素 `true` = 選用）：

```js
const SHEET_COLS=[['date','日期'],['dest','目的地'],['trans','詳細交通與行程細節'],
 ['stay','住宿地點'],['note','備註'],['url','訂票網址'],
 ['rain','雨天備案',true],['ref','參考資料',true],['detail','行程詳細版',true]];
```

`index.html:869` 附近，`sheetRowsToDays()` 裡建立 `day` 物件的地方加上 `detail`：

```js
  const day={date,dest:val(row,'dest'),trans:val(row,'trans'),
   stay:val(row,'stay'),note:val(row,'note'),url:val(row,'url'),
   rain:val(row,'rain'),ref:val(row,'ref'),detail:val(row,'detail')};
```

`index.html:876`，`SHEET_FIELDS` 末尾加一項（沒加的話差異比對永遠看不到這欄）：

```js
const SHEET_FIELDS=[['dest','目的地'],['trans','交通與行程'],['stay','住宿'],['note','備註'],['url','訂票網址'],['rain','雨天備案'],['ref','參考資料'],['detail','行程詳細版']];
```

`index.html:931`，`DIFF_LABEL` 加一項（沒加的話差異視窗會顯示英文 key）：

```js
const DIFF_LABEL={dest:'目的地',trans:'交通與行程',stay:'住宿',note:'備註',url:'訂票網址',rain:'雨天備案',ref:'參考資料',detail:'行程詳細版'};
```

- [ ] **Step 4: 跑測試確認通過**

Run: `node tests/test-sheet-import.js`
Expected: PASS，全部通過（原本 63 條 + 新增 5 條 = 68 條）。

- [ ] **Step 5: 跑全部測試**

Run: `sh tests/run-all.sh`
Expected: 全部通過。`test-sheet-e2e.js` 此時仍用 8 欄 fixture，`presentCols.detail` 為 `false`，差異比對會跳過該欄，不受影響。

- [ ] **Step 6: Commit**

```bash
git add index.html tests/test-sheet-import.js
git commit -m "feat: 試算表匯入認得「行程詳細版」欄

比照雨天備案與參考資料，加一個標記為選用的 detail 欄：欄位從試算表消失時
不中止匯入，diffSheet 也完全跳過該欄而不是當成空字串——後者會對每天產生
一筆預設勾選的清空差異，把整欄抹掉。

同時補上欄位順序無關的測試。使用者這次把參考資料與雨天備案的順序對調了，
sheetRowsToDays 是依欄名查索引不依位置，但先前沒有測試把這個性質釘住。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 行程卡片顯示連結按鈕

**Files:**
- Modify: `index.html:532` 附近（`UI.detailGeneric`）、`index.html:746` 附近（`renderTimeline`）
- Test: `tests/test-render.js`

- [ ] **Step 1: 寫失敗的測試**

在 `tests/test-render.js`，找到「行程卡片：沒有參考資料時不渲染按鈕」那條測試（約第 176 行）**下方**，加入：

```js
check('行程卡片：行程詳細版渲染成連結', () => {
  withDays([{ date: '10/21', dest: 'A', trans: 'T', stay: 'S', detail: 'https://detail.com' }], () => {
    const tl = html('timeline');
    assert.ok(tl.includes('href="https://detail.com"'));
    assert.ok(tl.includes('詳細版'));
  });
});

check('行程卡片：沒有行程詳細版時不渲染按鈕', () => {
  withDays([{ date: '10/21', dest: 'A', trans: 'T', stay: 'S' }], () => {
    assert.ok(!html('timeline').includes('detaillink'), '空值不能渲染出空按鈕');
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node tests/test-render.js`
Expected: FAIL，「行程詳細版渲染成連結」找不到 `href="https://detail.com"`。

- [ ] **Step 3: 加上 UI 字串與渲染**

`index.html:532` 附近，在 `refGeneric:'參考資料',` 下一行加：

```js
 detailGeneric:'詳細版',
```

`index.html:746` 附近，在 `const reflink=...` 那一行**下方**加一行：

```js
  const detaillink=d.detail?`<a class="booklink reflink" href="${esc(d.detail)}" target="_blank" rel="noopener">📋 ${esc(t(UI.detailGeneric))} ↗</a>`:'';
```

同一函式的樣板字串裡（約第 761 行），把 `${noteRow}${rainRow}${link}${reflink}${tools}` 改成：

```js
    ${noteRow}${rainRow}${link}${reflink}${detaillink}${tools}
```

沿用 `.booklink.reflink` 的既有樣式，不新增 CSS——兩顆按鈕視覺一致、靠圖示與文字區分，符合這個 codebase 目前的作法。

- [ ] **Step 4: 跑測試確認通過**

Run: `node tests/test-render.js`
Expected: PASS，全部通過（原本 20 條 + 新增 2 條 = 22 條）。

- [ ] **Step 5: 重新產生 baseline 並跑全部測試**

`UI` 多了一個字串，中文快照必定不同，依 `tests/run-all.sh` 註解的做法重產：

```bash
node tests/i18n-snapshot.js > tests/baseline.json
sh tests/run-all.sh
```

Expected: 全部通過、`i18n-snapshot SNAPSHOT OK`。

重產前可先 `node tests/i18n-snapshot.js > /tmp/snap.json && diff tests/baseline.json /tmp/snap.json` 確認差異只有新增的 `detailGeneric`，不是別的東西被誤改。

- [ ] **Step 6: Commit**

```bash
git add index.html tests/test-render.js tests/baseline.json
git commit -m "feat: 行程卡片顯示「行程詳細版」連結

比照參考資料的按鈕形狀，沿用 .booklink.reflink 樣式不新增 CSS。空值時
整顆按鈕不渲染，不是渲染一顆點不開的空按鈕。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 編輯視窗可以改這一欄

**Files:**
- Modify: `index.html:388` 附近（modal HTML）、`index.html:523` 附近（`UI.fDetail`）、`index.html:1010` / `1024` / `1046` / `1051` 附近（`openDayForm`、`saveDayForm`）
- Test: `tests/test-dayform.js`

- [ ] **Step 1: 寫失敗的測試**

`tests/test-dayform.js` 已有三條關於 `rain`／`ref` 的測試（第 194–219 行）。在它們**下方**、同一個 `async` 區塊內加入三條同型測試。

**該檔的慣例（照抄，別自創）：** 受測函式取出後改名為 `openForm` / `saveForm`（不是 `FN.openDayForm`，因為 direct eval 會把函式宣告提升到外層撞名）；每條測試是 `await check(名稱, async () => {...})`；改完值要 `await saveForm()`；每次重設用 `itinerary = [...]; reset();`。

```js
  await check('存檔：行程詳細版會寫回', async () => {
    itinerary = [{ date: '10/21', dest: 'A', trans: 'T', stay: 'S' }]; reset();
    openForm(0);
    document.getElementById('m-detail').value = 'https://detail.com';
    await saveForm();
    assert.strictEqual(itinerary[0].detail, 'https://detail.com');
  });

  await check('存檔：行程詳細版留空時刪除該欄', async () => {
    itinerary = [{ date: '10/21', dest: 'A', trans: 'T', stay: 'S', detail: 'https://old.com' }]; reset();
    openForm(0);
    document.getElementById('m-detail').value = '';
    await saveForm();
    assert.ok(!('detail' in itinerary[0]), '留空應刪除欄位而不是留下空字串');
  });

  await check('編輯視窗：帶入現有的行程詳細版', async () => {
    itinerary = [{ date: '10/21', dest: 'A', detail: 'https://d.com' }]; reset();
    openForm(0);
    assert.strictEqual(document.getElementById('m-detail').value, 'https://d.com');
  });
```

**注意 DOM 替身的行為：** `document.getElementById` 取不到時會**自動生出一個空元素**（`mkEl`），所以 `m-detail` 即使還沒加進 modal HTML 也不會回 `null`。這代表這些測試驗的是 `openDayForm`／`saveDayForm` 的讀寫邏輯，**驗不到 modal HTML 有沒有真的加上那一格**——那由 Task 5 的實機檢查負責。HTML 一定要加，否則使用者在真的瀏覽器裡看不到欄位。

- [ ] **Step 2: 跑測試確認失敗**

Run: `node tests/test-dayform.js`
Expected: FAIL。三條都會紅：前兩條因為 `saveDayForm` 還沒讀 `m-detail`，`itinerary[0].detail` 是 `undefined`；第三條因為 `openDayForm` 還沒寫入該元素，值是空字串。（不會是 `null` 錯誤——DOM 替身會自動生元素。）

- [ ] **Step 3: 加上表單欄位**

`index.html:388`，在 `m-ref` 那一行**下方**加：

```html
      <div class="field full"><label id="ml-detail" for="m-detail"></label><input type="text" id="m-detail" placeholder="https://"></div>
```

`index.html:523` 附近，在 `fRef:'參考資料（選填）',` 下一行加：

```js
 fDetail:'行程詳細版（選填）',
```

`index.html:1010` 附近，在 `document.getElementById('m-ref').value=d.ref||'';` 下一行加：

```js
 document.getElementById('m-detail').value=d.detail||'';
```

`index.html:1024` 附近，在 `document.getElementById('ml-ref').textContent=t(UI.fRef);` 下一行加：

```js
 document.getElementById('ml-detail').textContent=t(UI.fDetail);
```

`index.html:1046`，把該行的 `ref:v('m-ref'),` 改成：

```js
  url:v('m-url'),ulabel:v('m-ulabel'),rain:v('m-rain'),ref:v('m-ref'),detail:v('m-detail'),
```

`index.html:1051` 附近，在 `if(!day.ref)delete day.ref;` 下一行加：

```js
 if(!day.detail)delete day.detail;
```

- [ ] **Step 4: 跑測試確認通過**

Run: `node tests/test-dayform.js`
Expected: PASS，全部通過（原本 16 條 + 新增 3 條 = 19 條）。

- [ ] **Step 5: 重新產生 baseline 並跑全部測試**

```bash
node tests/i18n-snapshot.js > tests/baseline.json
sh tests/run-all.sh
```

Expected: 全部通過。

- [ ] **Step 6: Commit**

```bash
git add index.html tests/test-dayform.js tests/baseline.json
git commit -m "feat: 編輯視窗可修改「行程詳細版」

比照 ref 的行為：留空即刪除該欄，不留下空字串。少了這格的話，在 app 上
改過這欄之後下次匯入會被靜默覆蓋，使用者也沒有辦法不動試算表就修掉打錯
的網址。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: fixture 補欄位，端對端驗證

**Files:**
- Modify: `tests/fixtures/sheet-sample.csv`、`tests/test-sheet-import.js:88`、`tests/test-sheet-e2e.js`、`tests/README.md`
- Test: `tests/test-sheet-e2e.js`

**先讀本檔開頭的「陷阱 1」。** fixture 只加一欄，不整份重抓。

- [ ] **Step 1: 在 fixture 補上第 9 欄**

用腳本改，不要手動編輯——fixture 的儲存格含換行與逗號，手改容易破壞 CSV 結構：

```bash
python3 - <<'PY'
import csv, io
p = 'tests/fixtures/sheet-sample.csv'
rows = list(csv.reader(open(p, newline='', encoding='utf-8')))
rows[0].append('行程詳細版')
for r in rows[1:]:
    # 只有 10/25 有值，其餘留空——與真實試算表現況一致
    r.append('https://claude.ai/code/artifact/30fdc380-2d27-4317-9f1c-20f89f974642' if r[0].startswith('10/25') else '')
buf = io.StringIO()
csv.writer(buf, lineterminator='\n').writerows(rows)
io.open(p, 'w', encoding='utf-8', newline='').write(buf.getvalue())
print('fixture 已補上第 9 欄')
PY
```

驗證欄數與內容：

```bash
python3 -c "
import csv
rows=list(csv.reader(open('tests/fixtures/sheet-sample.csv',newline='',encoding='utf-8')))
print('欄數', len(rows[0]), rows[0][-1])
print('列數', len(rows)-1)
print('有值的天:', [r[0] for r in rows[1:] if r[-1]])
"
```

Expected:
```
欄數 9 行程詳細版
列數 15
有值的天: ['10/25(週日)']
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node tests/test-sheet-import.js`
Expected: FAIL，「真實試算表：15 列資料、8 個欄位」的 `deepStrictEqual(rows[0], [...])` 因為 fixture 多了一欄而不符。

- [ ] **Step 3: 更新欄數斷言**

`tests/test-sheet-import.js:88`，把測試名稱與標題陣列都改成 9 欄：

```js
check('真實試算表：15 列資料、9 個欄位', () => {
  const csv = fs.readFileSync(path.join(__dirname, 'fixtures', 'sheet-sample.csv'), 'utf8');
  const rows = parseCsvFn(csv).filter(r => r.some(c => c.trim()));
  assert.strictEqual(rows.length, 16, '應為 1 列標題 + 15 列資料');
  assert.deepStrictEqual(rows[0], ['日期', '目的地', '詳細交通與行程細節', '住宿地點', '備註', '訂票網址', '雨天備案', '參考資料', '行程詳細版']);
  assert.strictEqual(rows[1][0], '10/21(週三)');
  assert.strictEqual(rows[15][0], '11/04(週三)');
```

（該測試後續的斷言不動。）

- [ ] **Step 4: 加端對端測試**

`tests/test-sheet-e2e.js`，把「全部套用後，行程內容與試算表一致」測試裡的欄位清單加上 `detail`（約第 68 行）：

```js
    ['dest', 'trans', 'stay', 'note', 'url', 'rain', 'ref', 'detail'].forEach(f => {
      assert.strictEqual(FN.t(day[f]), sd[f], `${sd.date} 的 ${f} 不一致`);
    });
```

並在該檔最後一條測試（「端對端：未使用的欄位會被回報」）**下方**加一條：

```js
check('端對端：行程詳細版從試算表貫穿到行程資料', () => {
  itinerary = JSON.parse(JSON.stringify(FN.DEFAULT_DAYS));
  FN.applySheetDiff(FN.diffSheet(parsed.days, itinerary, parsed.presentCols));
  const d1025 = itinerary.find(d => d.date === '10/25');
  assert.ok(d1025.detail && d1025.detail.indexOf('http') === 0, '10/25 應有詳細版網址');
  const others = itinerary.filter(d => d.date !== '10/25' && d.detail);
  assert.deepStrictEqual(others, [], '其餘 14 天不該有值');
});
```

- [ ] **Step 5: 跑測試確認通過**

Run: `node tests/test-sheet-import.js && node tests/test-sheet-e2e.js`
Expected: 兩支都 PASS。

- [ ] **Step 6: 把 fixture 的維護方式寫進 README**

`tests/README.md`，找到說明 `sheet-sample.csv` 的那一段，在 `curl` 更新指令**之後**補一段警告：

```markdown
**⚠️ 欄位變動時只補欄，不要整份重抓。** `test-sheet-e2e.js` 的前提是 fixture 的
內容與 `DEFAULT_DAYS` **不一致**（它斷言 fixture 的 10/27 是河口湖、而
`DEFAULT_DAYS` 的 10/27 是上高地），用來驗差異比對與套用。repo 與試算表同步
之後整份重抓，會讓 fixture 與 `DEFAULT_DAYS` 一模一樣，差異測試就沒有東西可比、
等於被掏空。fixture 的職責是「欄位結構正確、但內容與 app 不同的一份試算表」，
不是試算表的即時鏡像。上面的 `curl` 只適用於「fixture 本來就該整份換掉」的情況。
```

- [ ] **Step 7: 跑全部測試**

Run: `sh tests/run-all.sh`
Expected: 全部通過。

- [ ] **Step 8: Commit**

```bash
git add tests/fixtures/sheet-sample.csv tests/test-sheet-import.js tests/test-sheet-e2e.js tests/README.md
git commit -m "test: fixture 補上行程詳細版欄，並記下不能整份重抓的理由

fixture 只補第 9 欄、內容原封不動。README 原本說欄位變動就 curl 重抓，
但 test-sheet-e2e.js 的前提是 fixture 與 DEFAULT_DAYS 內容不一致——repo
與試算表同步後整份重抓會讓兩邊一模一樣，差異比對測試就沒東西可比。把這個
理由寫進 README，免得下次照舊做法把測試掏空。

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 實機驗證

**Files:** 無（只驗證，不改碼）

- [ ] **Step 1: 起本機伺服器**

```bash
python3 -m http.server 8765
```

- [ ] **Step 2: 用瀏覽器檢查**

開 `http://localhost:8765/`，確認：

1. 10/25 那張卡片底部有三顆按鈕：🎫 訂票、📖 參考資料 ↗、📋 詳細版 ↗
2. 點 📋 詳細版會開啟立山黑部橫越手冊
3. 其餘 14 天**沒有** 📋 按鈕
4. 按「✏️ 編輯」→ 點 10/25 的鉛筆，編輯視窗有「行程詳細版（選填）」欄且帶出網址
5. 按「⇩ 從試算表更新」，差異視窗**不再**出現「試算表有 app 未使用的欄位：行程詳細版」

**注意：** 本機開啟時如果沒連上 Firebase 會顯示黃色警示、用 `DEFAULT_DAYS` 當資料，第 1～4 點仍可驗證。第 5 點需要能連上網抓試算表。

- [ ] **Step 3: 關掉伺服器**

`Ctrl+C`

- [ ] **Step 4: 回報結果**

把五點的實際結果回報給使用者。有任何一點不符就停下來，不要自行改設計。

---

## 完成後

程式改動不會動到 Firebase 上的既有資料——新欄位在舊資料上是 `undefined`，`renderTimeline` 的空值判斷會處理。

要讓 10/25 的手冊連結真的出現在使用者的手機上，仍需在網頁按「⇩ 從試算表更新」把試算表的值同步進 Firebase。**這一步由使用者自己做**，實作者不要嘗試代勞（需要登入）。
