# 移除多語系殘留資料 — 設計

日期：2026-08-05

## 問題

`index.html` 1004 行中有 167 行帶 `en:` 或 `ja:`。這些是早期多語系版本的殘留：`LANG` 已在 init 寫死 `'zh'`（`index.html:958`），介面上沒有語言切換器，英文與日文的字串永遠不會被顯示。

## 目標

移除所有 en / ja 字串與語系切換機制，畫面顯示結果完全不變。

## 執行順序

**先完成「行程日期自動接續」（`2026-08-05-itinerary-auto-date-design.md`），再做本次清理，兩者分開 commit。**

日期功能是實際需求且範圍小；本次清理是 167 行的機械式改動，風險在於手誤漏改。放在一個已知正常的狀態之後，出問題容易回退。

## 改動內容

### 1. 壓平多語系物件

把 `{zh:'…',en:'…',ja:'…'}` 改成純字串 `'…'`，保留中文那份。

涵蓋範圍：

| 位置 | 結構 |
|---|---|
| `index.html:428` `UI` | 大量 `{zh,en,ja}` 項目 |
| `index.html:524-525` `L_E5489` / `L_HWB` | 訂票連結標籤 |
| `index.html:534` `DEFAULT_DAYS` | 每天的 `dest` / `trans` / `note` / `ulabel` |
| `index.html:600` `TODOS` | 每項的 `title` / `forDay` |
| `index.html:630` `CATS` | 每項的 `name` |
| `index.html:641` `TRANSPORT_EST` | 每項的 `note` |

呼叫端多數透過 `t()` 取值，`t()` 本來就接受純字串，因此不需要改動。

**唯一例外：`STAY`（`index.html:515-522`）不可壓平成字串。**

`STAY` 的每個住宿是 `{zh,en,ja,url}`——`url` 與語系鍵在**同一個物件裡**：

```js
 ngo:{zh:'名古屋花園皇宮飯店',en:'Nagoya Garden Palace Hotel',ja:'名古屋ガーデンパレス',url:'https://maps.app.goo.gl/kP9Ns6WdLcvb99FJA'},
```

壓平成字串會弄丟住宿的 Google Maps 連結（`renderTimeline()` 讀的是 `d.stay.url`）。`STAY` 只刪 `en` / `ja`，保留 `{zh, url}` 形狀；沒有 url 的 `home` 則保留 `{zh}`。

這是全檔唯一一處語系鍵與其他鍵混在同一物件的結構，已逐行確認。`CATS` 的 `name`、`TODOS` 的 `title`、`DEFAULT_DAYS` 的 `note` / `ulabel` 雖然與 `id` / `color` / `url` 寫在同一行，但語系物件本身是獨立的巢狀物件，可正常壓平。

### 2. 改掉 `[LANG]` 索引

| 位置 | 現況 | 改為 |
|---|---|---|
| `index.html:425` `WD` | `{zh:[…],en:[…],ja:[…]}` | 純陣列 `['一','二','三','四','五','六','日']` |
| `index.html:486` `UI.regions` | `{zh:[…],en:[…],ja:[…]}` | 純陣列 |
| `UI.route` | 同上 | 純陣列 |
| `UI.regionKey` | 同上 | 純陣列 |
| `index.html:698` | `WD[LANG][wd]` | `WD[wd]` |
| `index.html:736` | `UI.regions[LANG][k]` | `UI.regions[k]` |
| `index.html:925` | `UI.route[LANG].map(…)` | `UI.route.map(…)` |
| `index.html:932` | `UI.regionKey[LANG]` | `UI.regionKey` |

### 3. 兩個內嵌語系物件

- `index.html:503`（倒數天數文案）：`const L={zh:{…},en:{…},ja:{…}}[LANG];` → 直接留下 zh 那個物件。
- `index.html:510`（記帳頁預估說明 `seedSubHtml`）：`return T[LANG];` → 直接回傳中文那則模板字串。

### 4. 移除語系機制本身

- `index.html:423` `let LANG='zh';` 刪除
- `index.html:426` `const HTMLLANG={…};` 刪除
- `index.html:958` init 裡的 `LANG='zh';` 刪除
- `index.html:921` `document.documentElement.lang=HTMLLANG[LANG];` → `document.documentElement.lang='zh-Hant';`
- `index.html:919` 的 `/* ===== language ===== */` 區塊註解改成貼合 `applyStatic()` 實際用途的名稱

### 5. `t()` 保留但簡化

```js
const t=o=>o==null?'':(typeof o==='string'?o:(o.zh||''));
```

**`t()` 不可刪除。** Firebase 上的共用行程資料是以 `{zh,en,ja}` 結構存進去的，本次不動資料庫，因此 `t()` 必須保留讀 `o.zh` 的能力，否則線上載回的行程內容會整片顯示空白。

（`saveDayForm()` 存的是純字串，資料庫中兩種格式本來就並存，`t()` 兩者都要能處理。）

## 驗證方式

清理前後畫面必須完全一致。

1. 清理前先截圖三個分頁（行程 / 記帳 / 待辦）的完整內容備查。
2. 清理後逐頁比對：行程 15 天的目的地、交通、住宿、備註、星期標籤；記帳頁的分類名稱、預估說明文字、幣別標籤；待辦頁的所有項目文字；頁首路線列與地區圖例。
3. 確認 `grep -c "en:'\|en:\`\|ja:'\|ja:\`" index.html` 回傳 0。
4. 確認全檔已無 `LANG` 識別字（`URL_E5489` 網址中的 `LANG=tc` 是外部連結參數，不算）。
5. 開啟已連上 Firebase 的正式頁面，確認從資料庫讀回的行程內容正常顯示（驗證 `t()` 的物件 fallback 仍有效）。

## 範圍外

- **不動 Firebase 資料**：資料庫中既有的 `{zh,en,ja}` 行程內容原樣保留，由 `t()` 的 fallback 處理。
- **不重構其他東西**：只移除多語系，不順手調整命名、結構或樣式。
