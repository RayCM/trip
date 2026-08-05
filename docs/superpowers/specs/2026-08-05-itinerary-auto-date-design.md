# 行程日期自動接續 — 設計

日期：2026-08-05

## 問題

行程表用 ↑ ↓ 調整順序時，`moveDay` 把整個「天」物件對調，`date` 欄位存在物件裡，所以日期跟著內容一起搬走。使用者每次移動後都得手動把兩天的日期改回來。

刪除中間某一天也有同樣性質的問題：剩下的日期會留下缺口（10/21、10/22、10/24…）。

## 目標

行程表的日期永遠是一段連續日期，由第 1 天往後推。上下移動、刪除、新增之後都自動維持連續，不需要手動調整。

## 核心規則

第 i 天的日期 = 第 1 天的日期 + i 天（i 從 0 起算）。

第 1 天的日期是整趟旅程的錨點，只有它可以手動修改；改它等於整趟行程平移（用於班機延誤等情況）。

## 現況（改動前）

檔案：`index.html`（單檔應用，無建置流程）

- `itinerary`：陣列，每個元素是一天，欄位有 `date`（`'10/23'`，MM/DD 字串）、`wd`（星期，Mon=0）、`r`、`dest`、`trans`、`stay`、`note`、`url` 等。
- `wdFromDate(str)`（`index.html:673`）：從 MM/DD 字串推算星期，年份寫死 2026。
- `renderTimeline()`（`index.html:683`）：`const wd=(typeof d.wd==='number')?d.wd:wdFromDate(d.date);` — **存檔的 `wd` 優先於日期推算**。
- `moveDay(i,dir)`（`index.html:721`）：整個物件對調後 `pushField('itinerary',…)` 並重繪。
- `deleteDay(i)`（`index.html:726`）／`delDayFromForm()`（`index.html:778`）：`splice` 後推送重繪。
- `saveDayForm()`（`index.html:764`）：組出 `day` 物件，寫入 `day.wd=wdFromDate(day.date)`，依 `editingIndex` 決定覆蓋或 push。
- 編輯視窗的日期欄位是 `#m-date`，標籤是 `#ml-date`。

已驗證：`DEFAULT_DAYS` 全部 15 天存檔的 `wd` 與 `wdFromDate` 推算結果一致，因此把星期改成純推算是行為等價的改動。

`wd` 全檔只有兩處用到：`index.html:683` 讀、`index.html:771` 寫。

## 改動內容

### 1. 新增 `resequenceDates()`

以 `itinerary[0].date` 為錨點，把每一天的 `date` 重寫成連續日期。

- 解析錨點：沿用 `wdFromDate` 的解析方式（`/(\d{1,2})\D+(\d{1,2})/`），組出 `new Date(2026, month-1, day)`。
- 逐日遞增：用 `Date` 的日期加法，跨月自動進位（10/31 → 11/01）。
- 格式化回 `MM/DD`，月與日都補零，與現有資料格式一致（`'11/01'`）。
- 同時 `delete d.wd`，讓星期完全由日期推算，存檔資料不再保留可能過時的欄位。
- 防呆：`itinerary` 為空、或錨點日期無法解析時直接 return，不做任何事。

### 2. 四個異動點呼叫

在資料異動完成後、`pushField('itinerary',…)` 之前呼叫 `resequenceDates()`：

- `moveDay(i,dir)`
- `deleteDay(i)`
- `delDayFromForm()`
- `saveDayForm()`

### 3. 星期改為純推算

`index.html:683` 改成 `const wd=wdFromDate(d.date);`，不再優先讀存檔的 `wd`。

`saveDayForm()` 中的 `day.wd=wdFromDate(day.date);` 移除。

（未經 `resequenceDates()` 處理的舊資料若仍帶 `wd`，因為沒有人讀它，不影響顯示。）

### 4. 編輯視窗日期欄位

`openDayForm(i)` 依情境決定 `#m-date` 是否可輸入：

- **可輸入**：`editingIndex===0`（編輯第 1 天，改它整趟平移），或 `itinerary.length===0`（行程被清空後新增第一天，需要重新建立錨點）。
- **唯讀**：其餘所有情況。設 `readOnly`，加上灰底樣式表示不可編輯。

唯讀時在日期欄位下方顯示提示文字「日期依順序自動計算」，三語系（zh / en / ja）都要有，加進既有的 `UI` 字典並用 `t()` 取值。可輸入時隱藏提示。

新增一天（`itinerary` 非空）時 `#m-date` 留空且唯讀，存檔後由 `resequenceDates()` 補上最後一天的隔天。

`saveDayForm()` 的取消條件 `if(!v('m-date')&&!dest)` 維持不變：編輯既有天時日期欄一定有值，新增天時兩者皆空才取消，行為正確。

## 資料流

```
使用者操作（↑↓ / 🗑 / 儲存）
  → 修改 itinerary 陣列
  → resequenceDates()      ← 重寫全部 date、清掉 wd
  → pushField('itinerary', itinerary)   ← 寫回 Firebase
  → renderTimeline()       ← 星期由 date 即時推算
```

## 測試方式

單檔應用無測試框架，以瀏覽器手動驗證：

1. 進入編輯模式，把第 3 天往下移到第 4 天位置 → 日期維持 10/23、10/24 不變，只有目的地／交通／住宿內容互換，星期標籤同步正確（五 / 六）。
2. 刪除中間任一天 → 後面所有日期往前遞補一天，無缺口，星期全部正確。
3. 新增一天 → 日期自動接在最後一天的隔天。
4. 編輯第 1 天，把日期從 10/21 改成 10/22 → 全部 15 天往後平移一天，末日從 11/04 變 11/05，跨月進位正確。
5. 編輯第 5 天 → 日期欄位唯讀且顯示提示文字。
6. 重新整理頁面 → Firebase 讀回的資料日期正確，與畫面一致。

## 範圍外

- **記帳頁不連動**：`TRANSPORT_EST` 與 `expenses` 各自用 ISO 日期（`'2026-10-23'`）記錄，與 `itinerary` 沒有關聯。行程對調後，該日的交通預估費用不會跟著移動，需要自行到記帳頁調整。
- **`wdFromDate` 年份寫死 2026**：本趟行程為 2026 年 10–11 月，不受影響。若日後用於跨年行程，星期會算錯。本次不處理。
- **`DEFAULT_DAYS` 的 `n:1..15` 欄位**：渲染用的是 `String(i+1)`，`saveDayForm` 也已經不寫這個欄位，屬於殘留欄位，不重新編號、不清理。
