# DJI Pocket 4P 到貨監控機器人 — 設計

日期：2026-08-18
狀態：已核可，待實作

## 背景

DJI Osmo Pocket 4P 於 2026/06/29 在台灣開賣，首批秒殺，至今（08/18）DJI 台灣官方商城仍顯示「缺貨／到貨通知」、momo 為「預購排單」、PChome 為「補貨中」。DJI 官方從未公布補貨時間表。

使用者需要它作為 2026/10/21–11/04 日本中部之旅的走拍主力，出發前若買不到就退而買 Pocket 4。因此需要一個自動監控三大通路、到貨時立刻推播 LINE 的機器人，把「每天手動刷三個網頁」自動化。

**這支程式的價值窗口到 2026/10 中旬為止**，之後不是買到了就是改買 Pocket 4，屆時停用。

## 目標與非目標

**目標**

- 監控 DJI 官方商城／momo／PChome 三家的 Pocket 4P 標準套裝（黑、珠光白）庫存
- 缺貨→有貨時，數十分鐘內推播到 LINE
- 不誤報（把預購排單、頁面改版當成到貨）
- 不靜默死亡（掛掉時要能被發現）

**非目標**

- 不做自動下單、不做搶購
- 不監控 Vlog 套裝與 Pocket 4（使用者已決定只盯標準套裝兩色）
- 不做網頁介面、不做多使用者

## 決策紀錄

| 決策 | 選擇 | 理由 |
|---|---|---|
| 通知管道 | LINE Messaging API（官方帳號 push） | LINE Notify 已於 2025/03/31 終止。使用者慣用 LINE，免費 200 則/月對「只推狀態轉變」綽綽有餘 |
| 執行環境 | GitHub Actions 排程 | 免費、不用開電腦、10/21 出發後仍持續運作。private repo 每 job 無條件進位計費一分鐘，*/10 會爆免費額度，故用 **public** repo |
| 存放位置 | 新開 public repo `dji-restock-watch` | 與 tirp 隔離：狀態檔 commit 不會觸發 tirp 的 Pages 重新部署，也不會用機器人 commit 洗掉行程網站的歷史 |
| 狀態儲存 | repo 內的 `state.json`，由 workflow commit 回來 | `git log` 直接是一份到貨史，除錯時 `git show` 看得到當時抓到什麼。Actions cache 會在 7 天未命中後被清除，導致狀態歸零並重推假警報 |
| 執行語言 | 零依賴 Node，HTTP 用內建 `https` + `zlib` | 不用 `fetch` 讓使用者本機的 Node v10 也能完整跑（含連網 dry-run），不必為此專案升級 Node。程式碼須避開 `?.` 與 `??` 語法 |
| 輪詢頻率 | `*/10 * * * *` | public repo 不計費。GitHub 共用 runner 尖峰延遲 5–15 分鐘，實際偵測延遲約 10–25 分鐘 |

## 架構

```
dji-restock-watch/
  .github/workflows/watch.yml   排程 + 手動觸發
  src/http.js                   HTTP 抓取（gzip 解壓、timeout、重試）
  src/sources/dji.js            解析 __PRELOADED_STATE__
  src/sources/pchome.js         解析 button API 的 JSONP
  src/sources/momo.js           解析手機版商品頁 HTML
  src/state.js                  狀態機：判斷該不該推播
  src/notify.js                 LINE push
  src/main.js                   編排
  targets.json                  監控品項（人工維護）
  state.json                    執行狀態（機器人維護）
  tests/                        fixture 驅動、不連網
  tests/fixtures/               實抓的真實頁面
  docs/design.md                本文件副本（實作 repo 需自給自足）
```

**模組邊界**：每個 `sources/*.js` 只導出一個純函式 `parse(rawText, target) -> { status, price, title }`，`status` 為 `'in' | 'out' | 'unknown'`。所有網路 I/O 集中在 `http.js`，所有時間判斷集中在 `state.js`（時間以參數注入，不在模組內呼叫 `Date.now()`，否則無法測試節流邏輯）。

如此一來，全部解析與狀態邏輯都能用存下來的真實頁面離線測試。

## 資料模型

### targets.json

```jsonc
[
  { "id": "dji-black",  "source": "dji",    "label": "DJI官方・標準套裝(黑)",
    "url": "https://store.dji.com/tw/product/osmo-pocket-4p",
    "skuTitle": "Osmo Pocket 4P 標準套裝" },
  { "id": "dji-white",  "source": "dji",    "label": "DJI官方・標準套裝(珠光白)",
    "url": "https://store.dji.com/tw/product/osmo-pocket-4p",
    "skuTitle": "Osmo Pocket 4P 標準套裝（珠光白）" },
  { "id": "pchome-std", "source": "pchome", "label": "PChome・標準套裝",
    "prodId": "DGCF6H-A900K53U9" },
  { "id": "momo-std",   "source": "momo",   "label": "momo・標準套裝",
    "iCode": "待實作時確認" }
]
```

DJI 兩個 target 共用同一個 URL，抓取層須**以 URL 去重**，一次請求餵給多個 target。每輪總計 3 個 HTTP 請求。

### state.json

```jsonc
{
  "updatedAt": "2026-08-18T04:00:00.000Z",
  "quota": { "month": "2026-08", "sent": 12 },
  "lastErrorNotifiedAt": null,
  "targets": {
    "dji-black": {
      "status": "out",              // 只會是 in 或 out；unknown 不寫入，維持前值
      "since": "2026-08-18T04:00:00.000Z",   // 進入此狀態的時間
      "lastSeenAt": "2026-08-18T04:00:00.000Z", // 最後一次成功抓取
      "notifiedAt": null,           // 最後一次為此狀態推播的時間
      "notifyCount": 0,             // 本段 in 狀態已推播次數
      "failStreak": 0
    }
  }
}
```

## 判定規則

| 來源 | `in` | `out` | `unknown` |
|---|---|---|---|
| DJI | SKU 的 `status.code === 'on_sale'` | `'out_of_stock'` | JSON 解析失敗，或找不到該 SKU |
| PChome | `ButtonType === 'ForSale'` 且 `SaleStatus === 1` | `OrderRefill` / `NotReady` / `SoldOut` | 出現不在已知清單內的 `ButtonType` |
| momo | 有「加入購物車」且無預購／售完字樣 | 有「預購」「售完」「補貨中」任一 | 三種字樣皆未出現 |

實測佐證（2026-08-18）：

- DJI 頁面 `window.__PRELOADED_STATE__` 內每個 SKU 具備 `"status":{"code":"out_of_stock","text":"對不起，暫時缺貨。"}` 與 `"title"`。同一份頁面同時存在 `on_sale` 的 SKU（DJI Mic 3 發射器、Osmo Pocket 4 補光燈等），故單一 fixture 即可測到兩條分支。
- PChome 缺貨真值：`{"ButtonType":"OrderRefill","SaleStatus":0,"Qty":0}`；有貨真值（以現貨 Pocket 3 `DGCF41-A900ID91A` 問出）：`{"ButtonType":"ForSale","SaleStatus":1,"Qty":1}`。
- momo 手機版 `m.momoshop.com.tw/goods.momo?i_code=N` 為伺服器端渲染，原始碼含「預購」「加入購物車」字樣。

### 三條必須守住的規則

1. **DJI 的 SKU 標題比對必須是完全相等，不能用 `includes`。** `Osmo Pocket 4P 標準套裝` 是 `Osmo Pocket 4P 標準套裝（珠光白）` 的前綴，用包含比對會讓黑色 target 誤中白色 SKU，兩者狀態永遠一致，等於白監控一個。

2. **momo 的「預購」優先於「加入購物車」。** 預購商品同樣可以加入購物車，兩個字串會同時出現在頁面上（已實測）。若不定這個優先序，機器人會把「預購排單」誤報成到貨——而預購排單正是本專案最需要區分的狀態。

3. **`unknown` 不等於缺貨。** 抓取失敗、頁面改版、SKU 改名都會落到 unknown。此時維持前一個已知狀態、不推播、`failStreak + 1`。把改版誤判為缺貨，會讓真正到貨時的 `out → in` 轉變被吃掉，機器人在最關鍵的一刻靜音。

## 推播狀態機

| 轉變 | 行為 |
|---|---|
| `out → in` | 立即推播「🟢 到貨」，`notifyCount = 1` |
| `in → in` | 距 `notifiedAt` ≥ 60 分鐘且 `notifyCount < 5` → 再推一次提醒，`notifyCount + 1` |
| `in → out` | 推播「🔴 已售罄，這波開了 X 分鐘」（X 由 `since` 計算） |
| 抓到 `unknown` | 不推播、不改變 `status`，`failStreak + 1` |
| 任一 target `failStreak >= 4`（約 1 小時） | 推播抓取異常警報；同類警報 24 小時內只推一次（`lastErrorNotifiedAt`） |

- 同一輪多個 target 同時轉變時**合成一則訊息**，不逐一推播。
- 成功抓取時 `failStreak` 歸零。

### 訊息格式

```
🟢 到貨了！
DJI官方・標準套裝(黑) NT$19,290
https://store.dji.com/tw/product/osmo-pocket-4p

其他：PChome 補貨中／momo 預購排單
18:32 偵測（本月已用 12/200 則）
```

時間一律以 **Asia/Taipei** 格式化。Runner 時區是 UTC，直接輸出會差 8 小時。

### 額度保護

LINE 免費方案 200 則/月，超額不是扣款而是**發送失敗**——靜默失效正是最糟的失敗模式。

- `state.quota` 記錄當月已推播則數，月份變更時歸零
- `sent >= 180` 後，只保留 `out → in` 推播，關閉「仍有貨提醒」與「售罄通知」
- 最壞情況（每天有貨 5 次）本來就只有 150 則，此保護幾乎不會觸發，防的是未預期的迴圈

## 排程與保活

`.github/workflows/watch.yml`：

- 觸發：`schedule: '*/10 * * * *'` ＋ `workflow_dispatch`
- 權限：`permissions: contents: write`（commit state.json，用內建 `GITHUB_TOKEN`）
- **必須設 `concurrency` group 且不取消進行中的 run**：延遲的 cron 可能與下一輪重疊，兩個 run 同時 push `state.json` 會 non-fast-forward 失敗
- 因為只掛 `schedule` 與 `workflow_dispatch`，機器人的 commit 不會遞迴觸發自己

### 每日保活 commit

**GitHub 會在 repo 連續 60 天無活動後自動停用排程 workflow。** 今天（08/18）到出發日（10/21）是 64 天——若 4P 一路缺貨、狀態從未轉變，機器人會在最後幾天被 GitHub 悄悄關掉，而使用者選擇的通知策略是「只在壞掉時通知」，不會有任何人察覺。

因此：**每天第一輪必定 commit 一次 `state.json`**（至少更新 `updatedAt`），其餘輪次僅在狀態轉變時 commit。一個月約 30 筆 commit，同時讓 `git log` 成為一份無聲的心跳記錄。

## 設定與祕密

Repo secrets：`LINE_CHANNEL_TOKEN`、`LINE_USER_ID`。README 需寫明取得步驟：

1. LINE Developers Console 建立 Messaging API channel
2. Basic settings 最下方複製 **Your user ID**
3. Messaging API 分頁發行 **long-lived channel access token**
4. **用手機加該官方帳號為好友**——未加好友時 push 會回 403，這是最常見的卡關點
5. 兩個值填入 repo 的 Actions secrets

推播 API：`POST https://api.line.me/v2/bot/message/push`，header `Authorization: Bearer <token>`，body `{ "to": "<userId>", "messages": [{ "type": "text", "text": "..." }] }`。

**LINE push 失敗時 `process.exit(1)`。** 通知管道自己壞掉時，它無法通知你它壞了；讓 job 失敗可換到 GitHub 的排程失敗通知信，得到一條免費的頻外告警管道。

## 實作順序

**里程碑 0 必須排在最前面，它可能推翻既有的執行環境決策。**

### 里程碑 0：CI 連通性驗證

所有可行性實測都是從台灣住宅 IP 跑的，而 GitHub Actions runner 是美國 Azure 機房 IP。momo（Akamai 前置）與 PChome API 可能對機房 IP 阻擋或回傳不同內容。

因此第一步只做兩件事：

1. **先確認 momo 的 `i_code`**（寫一支小工具掃出官方賣場的 Pocket 4P 標準套裝編號）——里程碑 0 的連通性測試與里程碑 1 的 fixture 都需要這個值，不能留到最後。
2. 一個 `workflow_dispatch` 的 workflow，對三個來源各抓一次，印出 HTTP 狀態碼、內容長度與關鍵字命中數。在建狀態機與推播之前先確認三家從 CI 都抓得到。

若 momo／PChome 從 CI 抓不到，屬於設計轉向（改用本機 launchd 補一條腿，或放棄該來源），必須在第一天就知道。

### 里程碑 1：解析器 + fixtures

- 存下三份真實頁面為 fixture
- **同時取得「有貨」態 fixture，不要等到真的補貨**：本專案的目的正是偵測一個尚未觀測過的狀態，而解析器與商品無關（吃字串吐狀態）。DJI 用既有 fixture 內的 `on_sale` SKU；PChome 用現貨商品（如 Pocket 3 `DGCF41-A900ID91A`）；momo 用任一現貨賣場取得「有加入購物車、無預購」的頁面。
  若不先釘住 in 分支，白名單漏值會在到貨當天觸發「抓取異常」而不是「到貨」通知。
- 三支解析測試，涵蓋 in／out／unknown 與上述三條必守規則

### 里程碑 2：狀態機

- `state.js` 純函式：吃 `(舊狀態, 本輪結果, 現在時間)` 吐 `(新狀態, 要推播的訊息或 null)`
- 測試涵蓋：60 分鐘節流、5 次上限、unknown 不改狀態、failStreak 門檻、警報 24 小時冷卻、月額度保護、月份切換歸零

### 里程碑 3：串接與上線

- `notify.js` LINE push（失敗 exit 1）
- `main.js` 編排、URL 去重、合成訊息
- `watch.yml` 排程、concurrency、每日保活 commit
- 用 `workflow_dispatch` 實跑一次，確認能收到 LINE 訊息

## 測試策略

沿用 tirp 的無框架風格：`sh tests/run-all.sh`，只需要 node，不裝任何套件。

- 全部測試不連網，吃 `tests/fixtures/` 下的真實頁面
- 避開 `?.` / `??` 語法，確保 Node v10 可跑
- 另提供 `node src/main.js --dry-run`：真的連網抓一次、印出三家現況、不推播不寫檔

## 已知極限

1. **10 分鐘輪詢擋不住秒殺。** 6/23 中國首賣是數分鐘內清空的；若台灣也是無預警放量，收到通知時可能已無庫存。本機器人真正能贏的情境是「補貨後掛著數小時沒人發現」，而這在缺貨後期比首賣時常見。
2. 因此**應同時訂閱 DJI 官方商城的到貨通知 email** 作為第二道保險，兩者互補。
3. momo 頁面改版會使解析失效，但 `failStreak` 警報會在約一小時後告知。
4. 通路可能先在官方商城以外的賣場放量，`targets.json` 之外的賣場不在監控範圍。

## 停用

買到之後：GitHub Actions 頁面停用該 workflow，或清空 `targets.json`。README 需註明。
