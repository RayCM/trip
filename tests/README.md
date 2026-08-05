# 測試

```sh
sh tests/run-all.sh
```

需要 `node`。**不需要 npm、不需要安裝任何套件、不需要建置流程。**

## 為什麼能在沒有測試框架的專案裡跑

整個 app 是單一的 `index.html`，程式碼寫在 inline `<script>` 裡，沒有模組系統可以 import。

這些測試的作法是：用 regex 從 `index.html` 的**原始碼**把要測的函式抽出來，配上必要的 stub（`pushField`、`renderTimeline`、最小 DOM）後 `eval`。因此測到的是真正上線的那段程式碼，不是複製一份出來的副本——改了 `index.html` 而忘記改測試，測試會紅。

代價是抽取用的 regex 依賴函式的寫法。若某支測試回報「找不到 xxx()」，通常是那個函式被改名或改寫了，更新對應的 regex 即可。

## 各支測試

| 檔案 | 項數 | 測什麼 |
|---|---|---|
| `test-resequence.js` | 8 | `resequenceDates()`：以第 1 天為錨點重算連續日期、跨月進位、清除 `wd`、錨點無效時不動作 |
| `test-moveday.js` | 6 | `moveDay()`：日期釘在位置上不隨內容移動（含第 1 天，這裡曾有整趟平移的 bug）、資料不連續時的自我修復 |
| `test-datevalidate.js` | 17 | `isValidAnchorDate()`：接受 `10/21`、全形斜線、前後空白；擋下空字串、`2026-10-21`、`02/30` 等 |
| `test-dayform.js` | 12 | `openDayForm()` / `saveDayForm()`：日期欄位唯讀的四種情境、驗證失敗時不寫回也不關視窗 |
| `test-legacy.js` | 7 | 線上舊資料相容性：`t()` 讀得懂 `{zh,en,ja}` 物件、會被誤讀的日期格式必須被擋下 |
| `test-render.js` | 14 | 用 DOM stub 實際執行整段主 script 與 `renderAll()`，檢查三個分頁的渲染輸出 |
| `test-sheet-import.js` | 41 | CSV 解析、列轉換、差異計算、套用差異、差異視窗渲染 |
| `test-sheet-e2e.js` | 7 | 用真實試算表 fixture 跑完整條匯入流程，含冪等性 |

共 112 項。

## 中文字串快照

`i18n-snapshot.js` 把 `index.html` 裡所有介面文字正規化成一份 JSON，`baseline.json` 是基準線。`run-all.sh` 會比對兩者，用來確保重構時沒有任何一個字串被誤刪或改動。

**若你刻意修改了文案**（新增待辦、改行程說明等），快照會 MISMATCH。確認 diff 內容是你要的之後，更新基準線：

```sh
node tests/i18n-snapshot.js > tests/baseline.json
```

## 兩個要小心的地方

- **`t()` 的 `o.zh` fallback 不可移除。** Firebase 上的共用行程資料仍是 `{zh,en,ja}` 物件結構，拿掉 fallback 會讓線上內容整片顯示空白。`test-legacy.js` 守著這一點。
- **`STAY` 不可壓平成字串。** `url` 與名稱在同一個物件裡，壓平會讓住宿的 Google Maps 連結消失。`test-render.js` 守著這一點。
- **`tests/fixtures/sheet-sample.csv` 是 Google 試算表的副本。** 試算表若增減欄位或改欄位名稱，`test-sheet-import.js` 會紅——那是正確的警示，代表匯入功能的欄位對應要跟著更新，不是測試壞了。更新 fixture：

  ```sh
  curl -sL "https://docs.google.com/spreadsheets/d/<SHEET_ID>/export?format=csv&gid=<SHEET_GID>" -o tests/fixtures/sheet-sample.csv
  ```

  `SHEET_ID` 與 `SHEET_GID` 的值在 `index.html` 裡。
