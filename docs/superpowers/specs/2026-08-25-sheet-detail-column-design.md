# 試算表新增欄位：行程詳細版 — 設計

日期：2026-08-25

## 問題

試算表新增了「行程詳細版」欄，用來放每天的詳細說明頁網址。目前 app 的 `SHEET_COLS` 沒有這個標題，匯入時它只會出現在差異視窗底部的「app 未使用的欄位」提示裡，內容不會顯示在行程卡片上。

試算表現況（15 天）：

| 欄位 | 有值天數 | 型態 |
|---|---|---|
| 行程詳細版 | 1/15（僅 10/25） | 網址 |

10/25 的值是立山黑部橫越手冊的 artifact 網址。使用者已確認**這欄之後一律放網址**，不會放純文字。

## 為什麼不沿用「參考資料」欄

10/25 的 `ref` 已經是 `https://www.alpen-route.com/diainfo/`（阿爾卑斯路線運行狀況查詢），是當天要看的另一份資料，不能被覆蓋。

而且這不是單一天的巧合：10/28 河口湖那天的轉乘與刷卡細節同樣夠寫一份獨立說明頁，屆時會再次撞上同一個問題。一天需要兩個不同性質的連結是常態，不是例外。

## 為什麼不做泛用的「連結陣列」

曾評估把 `url` / `ref` / `detail` 抽成一個連結陣列，未來加連結不必改程式。否決理由：

- 這是 15 天的個人專案，第三個連結槽就重構資料結構，成本高於收益
- Firebase 上已有既有資料，改結構要處理遷移，而遷移是這個 app 唯一會造成資料損毀的操作類型
- 沿用既有的具名欄位模式，與 2026-08-06 那次（雨天備案、參考資料）的決策一致

## 設計

### 資料

`SHEET_COLS` 新增一個**選用欄**：

```js
const SHEET_COLS=[['date','日期'],['dest','目的地'],['trans','詳細交通與行程細節'],
 ['stay','住宿地點'],['note','備註'],['url','訂票網址'],
 ['rain','雨天備案',true],['ref','參考資料',true],['detail','行程詳細版',true]];
```

選用（第三個元素為 `true`）的語意沿用 2026-08-06 的定義，不新增機制：

- 該欄從試算表消失 → 不進 `missingCols`、不中止匯入
- 且 `diffSheet` **完全跳過該欄位**，不退化成「當作空字串」——後者會對每一天產生一筆預設勾選的清空差異，整欄被抹掉

15 天裡有 14 天空白，這欄設成必要欄是不合理的。

### 顯示

卡片底部第三顆連結按鈕，沿用既有的 `.booklink` 樣式，排在 `reflink` 之後：

```
🎫 訂票
📖 參考資料 ↗
📋 詳細版 ↗       ← 新增
```

與 `reflink` 同構：`d.detail` 為空時**不渲染任何元素**，不是渲染一顆空按鈕。

### 編輯

day form 新增一格「行程詳細版」，比照 `ref`：留空即從該天的資料裡刪除該欄（`if(!day.detail)delete day.detail;`），不留空字串。

### 要改的位置

| 位置 | 改動 |
|---|---|
| `SHEET_COLS` | 加 `['detail','行程詳細版',true]` |
| `SHEET_FIELDS` | 加 `['detail','行程詳細版']`，差異比對才會納入 |
| `DIFF_LABEL` | 加 `detail:'行程詳細版'`，差異視窗才顯示得出欄位名 |
| `UI` | 加 `detailGeneric:'詳細版'` 與 form label `fDetail` |
| `renderTimeline` | 加 `detaillink`，插在 `${reflink}` 之後 |
| modal HTML | 加 `m-detail` 輸入格與 `ml-detail` label |
| `openDayForm` / `saveDayForm` | 讀寫 `m-detail`，空值刪欄 |

`sheetRowsToDays` 的 `day` 物件是用 `val(row,'detail')` 取值，需一併加上。

### 欄位順序不影響匯入

使用者這次同時把「參考資料」與「雨天備案」的順序對調了。`sheetRowsToDays` 是用 `head.indexOf(name)` 依**欄名**查索引，不依位置，所以對調無影響。已對照現行程式碼確認。

## 測試

`tests/fixtures/sheet-sample.csv` 是試算表的副本。依 `tests/README.md` 的既有做法重抓成現況：

```sh
curl -sL "https://docs.google.com/spreadsheets/d/<SHEET_ID>/export?format=csv&gid=<SHEET_GID>" -o tests/fixtures/sheet-sample.csv
```

連帶更新：

- `test-sheet-import.js` 的「真實試算表：15 列資料、8 個欄位」→ 9 個欄位
- 新增：`detail` 欄缺席時不中止匯入、且不對既有資料產生清空差異（比照 `rain`／`ref` 的現有測試）
- 新增：`d.detail` 為空時 timeline 不渲染 `detaillink`（比照 `test-render.js:177` 的 `reflink` 測試）

`tests/baseline.json` 會因 `UI` 新增字串而變動，依 `run-all.sh` 註解的做法重新產生。

## 非目標

- 不驗證 `detail` 的值是不是合法網址。既有的 `url`、`ref` 都不驗證，維持一致；填錯了點下去打不開，使用者自己看得到。
- 不做「自動偵測是網址還是文字」的分支。使用者已確認一律是網址。
- 不動 Firebase 上的既有資料。新欄位在舊資料上就是 `undefined`，`renderTimeline` 的空值判斷會處理。
