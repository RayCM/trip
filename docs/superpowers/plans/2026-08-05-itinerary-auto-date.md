# 行程日期自動接續 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 行程表的日期永遠維持一段連續日期，上下移動、刪除、新增之後自動接續，不需手動調整。

**Architecture:** 新增 `resequenceDates()`，以第 1 天的日期為錨點把每一天的日期重寫成連續日期，掛在四個資料異動點（移動 / 兩處刪除 / 儲存）。星期改成一律從日期即時推算，不再讀存檔欄位。編輯視窗中除了第 1 天（與行程為空時的第一天）之外，日期欄位唯讀。

**Tech Stack:** 單檔 vanilla JS（`index.html`，無建置流程、無測試框架）、Firebase Realtime Database。

**測試策略：** 本專案沒有測試框架。`resequenceDates()` 是純邏輯，用 Node 腳本從 `index.html` 原始碼把函式抽出來 `eval` 後斷言——測到的是真正的程式碼而非副本。UI 行為則以瀏覽器手動驗證。

**Spec:** `docs/superpowers/specs/2026-08-05-itinerary-auto-date-design.md`

**測試位置：** 本次產出的測試腳本已收進 repo 的 `tests/` 目錄，用 `sh tests/run-all.sh` 一次跑完。下方步驟裡的 `tests/xxx.js` 即為該目錄下的檔案。

---

### Task 1: `resequenceDates()` 核心邏輯

**Files:**
- Modify: `index.html`（在 `moveDay` 前面新增函式）
- Test: `tests/test-resequence.js`

- [ ] **Step 1: 寫失敗測試**

建立 `tests/test-resequence.js`：

```js
const fs = require('fs');
const assert = require('assert');

const SRC = '/Users/raychang/tirp/index.html';
const src = fs.readFileSync(SRC, 'utf8');

const m = src.match(/function resequenceDates\(\)\{[\s\S]*?\n\}/);
if (!m) {
  console.error('FAIL: 在 index.html 找不到 resequenceDates()');
  process.exit(1);
}

// 直接 eval，讓函式綁到本檔案的 itinerary（sloppy mode 下 direct eval 共用作用域）
let itinerary = [];
eval(m[0]);

const dates = () => itinerary.map(d => d.date);
let passed = 0;
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; }
}

check('15 天從 10/21 起連續編號，跨月進位正確', () => {
  itinerary = Array.from({ length: 15 }, (_, i) => ({ date: i === 0 ? '10/21' : 'XX/XX' }));
  resequenceDates();
  assert.deepStrictEqual(dates().slice(0, 3), ['10/21', '10/22', '10/23']);
  assert.deepStrictEqual(dates().slice(10, 15), ['10/31', '11/01', '11/02', '11/03', '11/04']);
});

check('對調兩天後日期仍依位置遞增（內容跟著走、日期不跟）', () => {
  itinerary = [
    { date: '10/21', dest: 'A' }, { date: '10/22', dest: 'B' }, { date: '10/23', dest: 'C' },
  ];
  [itinerary[1], itinerary[2]] = [itinerary[2], itinerary[1]];
  resequenceDates();
  assert.deepStrictEqual(dates(), ['10/21', '10/22', '10/23']);
  assert.deepStrictEqual(itinerary.map(d => d.dest), ['A', 'C', 'B']);
});

check('刪除中間一天後日期往前遞補，無缺口', () => {
  itinerary = [
    { date: '10/21' }, { date: '10/22' }, { date: '10/23' }, { date: '10/24' },
  ];
  itinerary.splice(1, 1);
  resequenceDates();
  assert.deepStrictEqual(dates(), ['10/21', '10/22', '10/23']);
});

check('改第 1 天日期，整趟平移', () => {
  itinerary = [{ date: '10/22' }, { date: '10/22' }, { date: '10/23' }];
  resequenceDates();
  assert.deepStrictEqual(dates(), ['10/22', '10/23', '10/24']);
});

check('月與日都補零', () => {
  itinerary = [{ date: '9/8' }, { date: 'x' }];
  resequenceDates();
  assert.deepStrictEqual(dates(), ['09/08', '09/09']);
});

check('清掉存檔的 wd 欄位', () => {
  itinerary = [{ date: '10/21', wd: 5 }, { date: 'x', wd: 6 }];
  resequenceDates();
  assert.ok(!('wd' in itinerary[0]), 'itinerary[0] 仍有 wd');
  assert.ok(!('wd' in itinerary[1]), 'itinerary[1] 仍有 wd');
});

check('空陣列不丟例外', () => {
  itinerary = [];
  resequenceDates();
  assert.deepStrictEqual(itinerary, []);
});

check('錨點日期解析不出來時原樣不動', () => {
  itinerary = [{ date: '' }, { date: '10/22' }];
  resequenceDates();
  assert.deepStrictEqual(dates(), ['', '10/22']);
});

console.log(`\n${passed}/8 passed`);
```

- [ ] **Step 2: 執行測試確認失敗**

Run:
```bash
node tests/test-resequence.js
```
Expected: `FAIL: 在 index.html 找不到 resequenceDates()`，exit code 1。

- [ ] **Step 3: 實作函式**

在 `index.html` 的 `function moveDay(i,dir){` 這一行**之前**插入：

```js
function resequenceDates(){
 if(!itinerary.length)return;
 const m=String(itinerary[0].date||'').match(/(\d{1,2})\D+(\d{1,2})/);
 if(!m)return;
 const base=new Date(2026,parseInt(m[1],10)-1,parseInt(m[2],10));
 if(isNaN(base))return;
 itinerary.forEach((d,i)=>{
  const cur=new Date(2026,base.getMonth(),base.getDate()+i);
  d.date=String(cur.getMonth()+1).padStart(2,'0')+'/'+String(cur.getDate()).padStart(2,'0');
  delete d.wd; // 星期一律由 date 推算，不留可能過時的存檔值
 });
}
```

- [ ] **Step 4: 執行測試確認通過**

Run:
```bash
node tests/test-resequence.js
```
Expected: 8 個 `✓`、`8/8 passed`，exit code 0。

- [ ] **Step 5: Commit**

```bash
cd /Users/raychang/tirp
git add index.html
git commit -m "新增 resequenceDates()，以第 1 天為錨點重算連續日期"
```

---

### Task 2: 星期改為純推算

**Files:**
- Modify: `index.html`（`renderTimeline()` 內）

- [ ] **Step 1: 改掉 render 的星期取值**

在 `renderTimeline()` 中找到這一行：

```js
  const wd=(typeof d.wd==='number')?d.wd:wdFromDate(d.date);
```

改成：

```js
  const wd=wdFromDate(d.date);
```

- [ ] **Step 2: 確認沒有其他地方讀 `wd`**

Run:
```bash
cd /Users/raychang/tirp && grep -n "d\.wd\|day\.wd\|\.wd=" index.html
```
Expected: 兩行——`saveDayForm()` 裡的 `day.wd=wdFromDate(day.date);`（下一步移除），以及 `resequenceDates()` 裡的 `delete d.wd;`（Task 1 已加入，保留不動）。`.card .wd{` 是 CSS class 名稱，不會被這個 pattern 命中。

- [ ] **Step 3: 移除 `saveDayForm()` 的 wd 寫入**

在 `saveDayForm()` 中刪掉這一行：

```js
 day.wd=wdFromDate(day.date);
```

- [ ] **Step 4: 驗證預設 15 天的星期推算結果不變**

Run:
```bash
node -e '
const days=[["10/21",2],["10/22",3],["10/23",4],["10/24",5],["10/25",6],["10/26",0],["10/27",1],["10/28",2],["10/29",3],["10/30",4],["10/31",5],["11/01",6],["11/02",0],["11/03",1],["11/04",2]];
let bad=0;
for(const [s,wd] of days){const [m,d]=s.split("/").map(Number);const calc=(new Date(2026,m-1,d).getDay()+6)%7;if(calc!==wd){console.log("MISMATCH",s,wd,calc);bad++;}}
console.log(bad?bad+" mismatches":"OK: 15 天推算結果與原存檔值一致");
'
```
Expected: `OK: 15 天推算結果與原存檔值一致`

- [ ] **Step 5: Commit**

```bash
cd /Users/raychang/tirp
git add index.html
git commit -m "星期改為一律從日期推算，不再讀存檔的 wd"
```

---

### Task 3: 四個異動點呼叫 `resequenceDates()`

**Files:**
- Modify: `index.html`（`moveDay` / `deleteDay` / `delDayFromForm` / `saveDayForm`）

呼叫時機一律是：**修改完 `itinerary` 之後、`pushField` 之前。**

- [ ] **Step 1: `moveDay`（交換內容，日期釘在位置上）**

找到：

```js
function moveDay(i,dir){
 const j=i+dir;if(j<0||j>=itinerary.length)return;
 const a=itinerary;[a[i],a[j]]=[a[j],a[i]];
 pushField('itinerary',itinerary);renderTimeline();
}
```

改成：

```js
function moveDay(i,dir){
 const j=i+dir;if(j<0||j>=itinerary.length)return;
 // 交換的是內容，日期留在原本的位置上（第 1 天是錨點，尤其不能被換走）
 const a=itinerary;const di=a[i].date,dj=a[j].date;[a[i],a[j]]=[a[j],a[i]];a[i].date=di;a[j].date=dj;
 resequenceDates();
 pushField('itinerary',itinerary);renderTimeline();
}
```

**為什麼不能只加 `resequenceDates()` 就好：**

`moveDay` 對調的是整個「天」物件，`date` 會跟著內容走。第 1 天的 ↓ 按鈕**沒有**被 disabled（`index.html:689` 只在最後一天才 disable），所以 `moveDay(0,1)` 是使用者按得到的。一旦按下去，原本第 2 天的物件（帶著 `10/22`）會落到位置 0，`resequenceDates()` 就以 `10/22` 當錨點重算，整趟行程往後平移一天——而且重複按會持續累加：

```
10/21(A) 10/22(B) 10/23(C)
按一次 → 10/22(B) 10/23(A) 10/24(C)
按兩次 → 10/23(A) 10/24(B) 10/25(C)
```

先把兩個位置的日期保存下來、交換後再放回去，日期就完全不隨內容移動，錨點自然不會被換走。

- [ ] **Step 2: `deleteDay`**

找到：

```js
 itinerary.splice(i,1);await pushField('itinerary',itinerary);renderTimeline();
```

改成：

```js
 itinerary.splice(i,1);resequenceDates();await pushField('itinerary',itinerary);renderTimeline();
```

- [ ] **Step 3: `delDayFromForm`**

找到：

```js
 itinerary.splice(editingIndex,1);await pushField('itinerary',itinerary);closeDayForm();renderTimeline();
```

改成：

```js
 itinerary.splice(editingIndex,1);resequenceDates();await pushField('itinerary',itinerary);closeDayForm();renderTimeline();
```

- [ ] **Step 4: `saveDayForm`**

找到：

```js
 if(editingIndex!=null)itinerary[editingIndex]=day; else itinerary.push(day);
 await pushField('itinerary',itinerary);closeDayForm();renderTimeline();
```

改成：

```js
 if(editingIndex!=null)itinerary[editingIndex]=day; else itinerary.push(day);
 resequenceDates();
 await pushField('itinerary',itinerary);closeDayForm();renderTimeline();
```

- [ ] **Step 5: 確認四處都掛上了**

Run:
```bash
cd /Users/raychang/tirp && for f in moveDay deleteDay delDayFromForm saveDayForm; do
  n=$(awk "/^(async )?function $f\(/,/^}/" index.html | grep -c "resequenceDates()")
  echo "$f: $n"
done
```
Expected: 四行都是 `1`。

- [ ] **Step 6: 加迴歸測試，鎖住第 1 天不被換走**

建立 `tests/test-moveday.js`。這支測試從 `index.html` 原始碼把 `resequenceDates` 與 `moveDay` 兩個函式一起抽出來 eval，並把 `pushField` / `renderTimeline` 換成空殼，因此測到的是真正的 `moveDay`：

```js
const fs = require('fs');
const assert = require('assert');

const src = fs.readFileSync('/Users/raychang/tirp/index.html', 'utf8');
const grab = (re, label) => {
  const m = src.match(re);
  if (!m) { console.error('FAIL: 找不到 ' + label); process.exit(1); }
  return m[0];
};
const rdSrc = grab(/function resequenceDates\(\)\{[\s\S]*?\n\}/, 'resequenceDates()');
const mdSrc = grab(/function moveDay\(i,dir\)\{[\s\S]*?\n\}/, 'moveDay()');

let itinerary = [];
function pushField() {}      // 測試用空殼，不碰 Firebase
function renderTimeline() {} // 測試用空殼，不碰 DOM
eval(rdSrc);
eval(mdSrc);

const mk = () => [
  { date: '10/21', dest: 'A' }, { date: '10/22', dest: 'B' }, { date: '10/23', dest: 'C' },
];
const dates = () => itinerary.map(d => d.date);
const dests = () => itinerary.map(d => d.dest);

let passed = 0;
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; }
}

check('第 1 天往下移，日期不動只有內容互換', () => {
  itinerary = mk();
  moveDay(0, 1);
  assert.deepStrictEqual(dates(), ['10/21', '10/22', '10/23']);
  assert.deepStrictEqual(dests(), ['B', 'A', 'C']);
});

check('第 1 天連按兩次會回到原狀，日期不累加平移', () => {
  itinerary = mk();
  moveDay(0, 1);
  moveDay(0, 1);
  assert.deepStrictEqual(dates(), ['10/21', '10/22', '10/23']);
  assert.deepStrictEqual(dests(), ['A', 'B', 'C']);
});

check('中間往下移，日期釘在位置上', () => {
  itinerary = mk();
  moveDay(1, 1);
  assert.deepStrictEqual(dates(), ['10/21', '10/22', '10/23']);
  assert.deepStrictEqual(dests(), ['A', 'C', 'B']);
});

check('往上移與往下移對稱', () => {
  itinerary = mk();
  moveDay(2, -1);
  assert.deepStrictEqual(dates(), ['10/21', '10/22', '10/23']);
  assert.deepStrictEqual(dests(), ['A', 'C', 'B']);
});

check('超出範圍不做事', () => {
  itinerary = mk();
  moveDay(0, -1);
  moveDay(2, 1);
  assert.deepStrictEqual(dates(), ['10/21', '10/22', '10/23']);
  assert.deepStrictEqual(dests(), ['A', 'B', 'C']);
});

console.log(`\n${passed}/5 passed`);
```

Run:
```bash
node tests/test-moveday.js && node tests/test-resequence.js
```
Expected: `5/5 passed` 與 `8/8 passed`，兩支都是 exit code 0。

- [ ] **Step 7: Commit**

```bash
cd /Users/raychang/tirp
git add index.html
git commit -m "移動、刪除、儲存行程後自動重算日期"
```

---

### Task 4: 編輯視窗日期欄位唯讀

**Files:**
- Modify: `index.html`（modal HTML、CSS、`openDayForm()`）

- [ ] **Step 1: 加入提示文字的 HTML**

找到 modal 內的日期欄位：

```html
      <div class="field"><label id="ml-date" for="m-date"></label><input type="text" id="m-date" placeholder="10/26"></div>
```

改成：

```html
      <div class="field"><label id="ml-date" for="m-date"></label><input type="text" id="m-date" placeholder="10/26"><span class="m-hint" id="m-date-hint">日期依順序自動計算</span></div>
```

- [ ] **Step 2: 加入 CSS**

找到這一行：

```css
.m-grid input:focus,.m-grid select:focus,.m-grid textarea:focus{outline:2px solid var(--slate);outline-offset:0}
```

在它**後面**加入：

```css
.m-grid input[readonly]{background:#f2ede3;color:var(--ink-faint);cursor:default}
.m-grid input[readonly]:focus{outline:none}
.m-hint{font-size:10.5px;color:var(--ink-faint);letter-spacing:.03em;line-height:1.4}
```

- [ ] **Step 3: 改 `openDayForm()` 控制唯讀狀態**

找到：

```js
 document.getElementById('m-date').value=d.date||'';
```

改成：

```js
 // 日期由第 1 天往後推算，只有錨點（第 1 天）可改；行程為空時新增的第一天也要能設錨點
 const dateEl=document.getElementById('m-date');
 const dateEditable=(editingIndex===0)||itinerary.length===0;
 dateEl.value=d.date||'';
 dateEl.readOnly=!dateEditable;
 document.getElementById('m-date-hint').style.display=dateEditable?'none':'block';
```

- [ ] **Step 3b: 加上日期格式驗證**

日期欄位可輸入時（第 1 天／行程為空），它決定整趟 15 天的日期。`resequenceDates()` 用的 regex 是 `/(\d{1,2})\D+(\d{1,2})/`，很寬鬆：輸入 `2026-10-21` 會被解析成「26 月 10 日」，錨點變成 `02/10`，整趟行程改寫到二月並寫回 Firebase。雖然重新輸入正確日期就能救回來（內容不會遺失），但要擋在前面。

在 `saveDayForm()` 中找到：

```js
 const day={date:v('m-date'),r:document.getElementById('m-region').value,
```

在這一行**之前**插入：

```js
 // 日期欄位可輸入時（第 1 天）它決定整趟行程，空白或格式錯了會把全部日期算歪
 const dateEl=document.getElementById('m-date');
 if(!dateEl.readOnly){
  const md=v('m-date').match(/^(\d{1,2})\/(\d{1,2})$/);
  if(!md||+md[1]<1||+md[1]>12||+md[2]<1||+md[2]>31){alert('日期請填 MM/DD，例如 10/21');return;}
 }
```

**注意條件不能寫成 `if(!dateEl.readOnly&&v('m-date'))`。** 空白日期正是最危險的輸入：使用者把第 1 天的日期清空後儲存，`resequenceDates()` 會因為錨點解析失敗而直接 return（什麼都不做），但 `pushField` 照樣把 `date` 為空的資料寫回 Firebase。從那一刻起，之後每一次移動／刪除／儲存都會靜默地不再重算日期，直到有人手動把第 1 天的日期補回來為止——而且全程沒有任何錯誤提示。日期欄位可輸入時，就是必填。

（前面既有的 `if(!v('m-date')&&!dest){closeDayForm();return;}` 只在日期與目的地**都**空白時才靜默關閉，是「開了新增視窗但什麼都沒填」的情境，不會蓋過這個驗證。）

（`alert()` 是這個檔案既有的錯誤提示方式，見 `toggleEdit()`。）

- [ ] **Step 3c: 驗證格式檢查有效**

建立 `tests/test-datevalidate.js`，直接測那段驗證條件的邏輯：

```js
const assert = require('assert');
const ok = s => {
  const md = String(s).match(/^(\d{1,2})\/(\d{1,2})$/);
  return !(!md || +md[1] < 1 || +md[1] > 12 || +md[2] < 1 || +md[2] > 31);
};
const accept = ['10/21', '1/1', '09/08', '12/31'];
// 空字串一定要在擋下之列——清空第 1 天日期是最危險的輸入
const reject = ['', '2026-10-21', '2026/10/21', '10-21', '13/45', '0/5', '10/0', '10/32', 'abc', '10/21 '];
accept.forEach(s => assert.ok(ok(s), '應接受但被擋下: ' + JSON.stringify(s)));
reject.forEach(s => assert.ok(!ok(s), '應擋下但被接受: ' + JSON.stringify(s)));
console.log(`✓ 接受 ${accept.length} 種合法格式，擋下 ${reject.length} 種不合法格式`);
```

Run:
```bash
node tests/test-datevalidate.js
```
Expected: `✓ 接受 4 種合法格式，擋下 10 種不合法格式`，exit code 0。

- [ ] **Step 4: 靜態檢查**

Run:
```bash
cd /Users/raychang/tirp && grep -n "m-date-hint\|dateEditable\|dateEl\|input\[readonly\]" index.html
```
Expected: 10 行——HTML 的 `m-date-hint` 1 行；CSS 的 `input[readonly]` 2 行；`openDayForm()` 裡 5 行（`dateEl` 宣告、`dateEditable` 宣告、`dateEl.value`、`dateEl.readOnly`、`m-date-hint` 的 display 設定）；`saveDayForm()` 裡 2 行（`dateEl` 宣告、`if(!dateEl.readOnly&&…)`）。

- [ ] **Step 5: Commit**

```bash
cd /Users/raychang/tirp
git add index.html
git commit -m "編輯視窗日期欄位改唯讀，只有第 1 天可調整"
```

---

### Task 5: 驗證

**Files:** 無（純驗證）

> **執行時的實際情況（2026-08-05）：** Chrome 擴充功能未連線，無法做瀏覽器自動化。改為兩件事取代：
>
> 1. **Node DOM harness**（`tests/test-dayform.js`）：用最小 DOM stub 跑從原始碼抽出來的真正 `openDayForm` / `saveDayForm`，涵蓋唯讀狀態的四種情境、狀態重設、第 1 天平移、非法日期、空白日期、全形斜線、中間天編輯、新增一天、寫回內容不含 `wd`，共 12 項全綠。
> 2. **端對端腳本**：用真實的 `DEFAULT_DAYS` 15 天資料跑 `moveDay`，確認日期釘位、星期同步、第 1 天 ↓ 不會讓末日從 11/04 跑掉。
>
> 累計自動化測試 43 項（12 + 17 + 6 + 8）全綠。
>
> **仍待人工確認的項目**（自動化測不到）：唯讀欄位的灰底樣式與提示文字排版、手機上點唯讀欄位是否會叫出虛擬鍵盤、以及與正式 Firebase 的實際往返。下方步驟保留給人工執行。
>
> 為避免動到共用的真實行程，驗證用的是 scratchpad 裡不含 `config.js` 的沙盒副本（走本機模式，資料存 localStorage）。

- [ ] **Step 1: 啟動本機伺服器**

Run:
```bash
cd /Users/raychang/tirp && python3 -m http.server 8899
```
（背景執行）

- [ ] **Step 2: 開啟頁面並確認初始狀態**

開 `http://localhost:8899/`，確認行程頁 15 天正常顯示、日期 10/21～11/04、星期標籤與截圖一致（10/23 是「五」、10/24 是「六」）。

若右上出現「連不上資料庫」的紅色提示，代表 `config.js` 未設定，此時顯示的是 `DEFAULT_DAYS` 且編輯功能被鎖住——請先確認 `config.js` 存在且設定正確，否則無法驗證編輯行為。

- [ ] **Step 3: 驗證上下移動**

點「✏️ 編輯」進入編輯模式，把第 3 天（10/23 雨晴海岸）按 ↓ 移到第 4 天位置。

Expected:
- 第 3 格日期仍是 `10/23`、星期仍是「五」，內容變成原本的「立山町・稱名瀑布」
- 第 4 格日期仍是 `10/24`、星期仍是「六」，內容變成「雨晴海岸」
- 按 ↑ 移回來後完全還原

- [ ] **Step 3b: 驗證第 1 天往下移不會平移整趟**

把第 1 天（10/21）按 ↓。

Expected:
- 第 1 格日期仍是 `10/21`、第 2 格仍是 `10/22`，只有內容互換
- **整趟結束日仍是 `11/04`**（若變成 `11/05` 代表錨點被換走了）
- 再按一次 ↓ 移回來，完全還原

- [ ] **Step 4: 驗證刪除**

刪除中間任一天（例如第 5 天）。

Expected: 剩 14 天，日期為 10/21～11/03 連續無缺口，每天星期標籤都正確。驗證後用 ↑↓ 與新增還原，或重新整理前先確認再手動復原。

- [ ] **Step 5: 驗證新增**

按「＋ 新增一天」，日期欄位應為唯讀且顯示「日期依順序自動計算」。填目的地後儲存。

Expected: 新的一天日期自動接在最後一天的隔天。

- [ ] **Step 6: 驗證第 1 天平移**

編輯第 1 天，日期欄位應可輸入。把 `10/21` 改成 `10/22` 後儲存。

Expected: 全部 15 天往後平移一天，末日從 `11/04` 變 `11/05`，跨月進位正確，星期全部同步更新。驗證後改回 `10/21`。

- [ ] **Step 7: 驗證中間天唯讀**

編輯第 5 天。

Expected: 日期欄位灰底不可輸入，下方顯示「日期依順序自動計算」。

- [ ] **Step 8: 驗證資料有寫回 Firebase**

重新整理頁面。

Expected: 所有日期與內容與重整前一致（代表 `resequenceDates()` 的結果有透過 `pushField` 寫回資料庫）。

- [ ] **Step 9: 關閉伺服器並確認狀態乾淨**

Run:
```bash
cd /Users/raychang/tirp && git status --short
```
Expected: 無未提交的變更（前面四個 Task 都已 commit）。

---

## 完成後

行程日期功能到此結束。接著執行 `docs/superpowers/plans/2026-08-05-remove-i18n.md`（移除多語系殘留資料）。
