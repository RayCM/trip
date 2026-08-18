# DJI Pocket 4P 到貨監控機器人 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每 10 分鐘自動檢查 DJI 官方商城／momo／PChome 三家的 Osmo Pocket 4P 標準套裝（黑、珠光白）庫存，缺貨轉有貨時推播 LINE。

**Architecture:** 零依賴 Node 腳本跑在 GitHub Actions 排程上。抓取層（`src/http.js`）與解析層（`src/sources/*.js`）分離，解析器都是純函式（吃字串吐狀態），狀態機（`src/state.js`）也是純函式（時間由參數注入），因此全部邏輯都能用存下來的真實頁面離線測試。狀態存在 repo 的 `state.json`，由 workflow commit 回來，`git log` 即到貨史。

**Tech Stack:** Node（內建 `https` / `zlib`，不使用 `fetch`，相容 Node v10）、GitHub Actions、LINE Messaging API。無 npm 套件、無建置流程。

**設計文件：** `/Users/raychang/tirp/docs/superpowers/specs/2026-08-18-dji-restock-watch-design.md`

**實作位置：** `/Users/raychang/dji-restock-watch`（新 repo，與 tirp 分離）

---

## 與 spec 的兩處刻意差異

1. **`state.json` 不存 `lastSeenAt`。** 若每輪都寫入「最後抓取時間」，`state.json` 每 10 分鐘就變動一次，workflow 會每 10 分鐘 commit 一次，一個月 4000 筆 commit，`git log` 直接失去可讀性。改為只存 `lastRunDate`（台北日期字串），於是：狀態沒變的日子每天只 commit 一次（正好就是 spec 要求的 60 天保活機制），狀態變了才多一筆。**「只在有事發生時 commit」與「每日保活」由同一個機制達成。**

2. **`src/http.js` 不寫單元測試。** 它是純 I/O 殼層，離線測它只能測到自己寫的 mock。它的驗證方式是 Task 5 的 CI 連通性探針（真的連三家）與 Task 12 的 dry-run。所有值得測的邏輯都不在這一層。

---

## 檔案結構

| 檔案 | 職責 |
|---|---|
| `src/http.js` | HTTPS GET：UA、gzip/deflate 解壓、轉址、timeout、重試一次。唯一碰網路的地方 |
| `src/sources/dji.js` | 純函式：DJI 頁面 HTML → 狀態 |
| `src/sources/pchome.js` | 純函式：PChome button API 的 JSONP → 狀態 |
| `src/sources/momo.js` | 純函式：momo 手機版 HTML → 狀態 |
| `src/state.js` | 純函式：(舊狀態, 本輪結果, 現在時間) → (新狀態, 要推播的訊息) |
| `src/notify.js` | LINE push |
| `src/main.js` | 編排：讀設定 → 抓 → 解析 → 狀態機 → 推播 → 寫檔 |
| `scripts/probe.js` | 一次性連通性探針（Task 5） |
| `scripts/find-momo-icode.js` | 一次性 momo 商品編號掃描（Task 2） |
| `targets.json` | 監控品項（人工維護） |
| `state.json` | 執行狀態（機器人維護） |
| `tests/harness.js` | 12 行的測試小工具 |
| `tests/test-*.js` | 各模組測試，全部離線 |
| `tests/fixtures/` | 實抓的真實頁面（含有貨與缺貨兩態） |
| `tests/run-all.sh` | 跑完全部測試 |

---

## Task 1: repo 初始化

**Files:**
- Create: `/Users/raychang/dji-restock-watch/.gitignore`
- Create: `/Users/raychang/dji-restock-watch/README.md`
- Create: `/Users/raychang/dji-restock-watch/targets.json`

- [ ] **Step 1: 建立目錄與 git repo**

```bash
mkdir -p /Users/raychang/dji-restock-watch/src/sources \
         /Users/raychang/dji-restock-watch/scripts \
         /Users/raychang/dji-restock-watch/tests/fixtures
cd /Users/raychang/dji-restock-watch
git init
```

- [ ] **Step 2: 寫 `.gitignore`**

```
.commit-msg.txt
.DS_Store
```

- [ ] **Step 3: 寫 `targets.json`**

momo 那筆的 `iCode` 在 Task 2 填入，此處先不放 momo。

```json
[
  {
    "id": "dji-black",
    "source": "dji",
    "label": "DJI官方・標準套裝(黑)",
    "url": "https://store.dji.com/tw/product/osmo-pocket-4p",
    "skuTitle": "Osmo Pocket 4P 標準套裝"
  },
  {
    "id": "dji-white",
    "source": "dji",
    "label": "DJI官方・標準套裝(珠光白)",
    "url": "https://store.dji.com/tw/product/osmo-pocket-4p",
    "skuTitle": "Osmo Pocket 4P 標準套裝（珠光白）"
  },
  {
    "id": "pchome-std",
    "source": "pchome",
    "label": "PChome・標準套裝",
    "prodId": "DGCF6H-A900K53U9"
  }
]
```

注意 `dji-white` 的 `skuTitle` 用的是**全形括號**「（珠光白）」，這是 DJI 頁面上的原字串，不可改成半形。

- [ ] **Step 4: 寫 `README.md`**

```markdown
# dji-restock-watch

盯著 DJI Osmo Pocket 4P 標準套裝在三家通路的庫存，到貨時推播 LINE。

每 10 分鐘由 GitHub Actions 跑一次。狀態存在 `state.json`，只在狀態轉變或跨日時 commit，
所以 `git log` 就是一份到貨史。

## 設定

需要兩個 repo secrets：`LINE_CHANNEL_TOKEN`、`LINE_USER_ID`。取得方式見下方。

## 本機執行

    node src/main.js --dry-run    # 真的連網抓一次，印出現況，不推播不寫檔
    sh tests/run-all.sh           # 跑全部測試，不連網

## 停用

買到之後到 Actions 頁面停用 watch workflow，或把 `targets.json` 清空。
```

- [ ] **Step 5: 首次 commit**

```bash
cd /Users/raychang/dji-restock-watch
git add -A
git commit -m "chore: repo 初始化與監控目標設定"
```

- [ ] **Step 6: 建立 GitHub public repo 並推上去**

```bash
cd /Users/raychang/dji-restock-watch
gh --version || echo "gh 未安裝：改到 github.com 手動建立 public repo dji-restock-watch，然後 git remote add origin <url> && git push -u origin main"
gh repo create dji-restock-watch --public --source=. --remote=origin --push
```

必須是 **public**：private repo 的 Actions 每個 job 無條件進位計費一分鐘，`*/10` 排程一個月 4,320 分鐘會爆掉免費的 2,000 分鐘額度。

---

## Task 2: 找出 momo 的商品編號

> **2026-08-18 執行結果與決策變更。** 掃描確認 momo 上**沒有**純「Osmo Pocket 4P 標準套裝」
> 賣場：全站【DJI】開頭的 4P 賣場只有三個，全部是主機＋配件的組合包（`15508707` 標準套裝
> 組合包、`15582981`／`15582982` Vlog 套裝組合包）。兩位審查者各自用 5–7 組關鍵字交叉驗證，
> 結論一致。
>
> 組合包售價高於官方定價 NT$19,290，多出來的是配件錢——使用者要買的是純標準套裝，因此
> **決定不監控 momo 組合包**（commit `b54ff94` 已移除該目標）。盯著它只會在半夜把人叫醒去
> 買不想買的東西。
>
> 但 **Task 9 的 momo 解析器仍要照計畫實作**，只是 `targets.json` 裡暫時沒有 momo 目標。
> 日後 momo 若出現純標準套裝賣場，重跑 `scripts/find-momo-icode.js` 找出編號、在
> `targets.json` 加一筆即可啟用，不必再寫程式。
>
> 連帶影響：**CI 連通性探針（Task 5）因此只會測到 DJI 與 PChome 兩家**，momo 從 GitHub
> 機房 IP 是否抓得到並未驗證。日後要啟用 momo 時，記得先把 momo 目標加進 `targets.json`
> 再跑一次探針確認連通性。

momo 的搜尋頁與分類頁都是前端渲染，`curl` 只拿得到前幾筆廣告位。已驗證可用的路徑是**商品頁本身**（`m.momoshop.com.tw/goods.momo?i_code=N` 是伺服器端渲染，標題抓得到）。所以做法是：撈出候選編號 → 逐一開商品頁比對標題。

**Files:**
- Create: `scripts/find-momo-icode.js`
- Modify: `targets.json`

- [ ] **Step 1: 寫掃描工具**

`scripts/find-momo-icode.js`：

```js
'use strict';

// 一次性工具：從 momo 搜尋頁撈候選 i_code，逐一開商品頁印出標題。
// 用法：node scripts/find-momo-icode.js "OSMO POCKET 4P 標準套裝"

var http = require('../src/http');

var keyword = process.argv[2] || 'OSMO POCKET 4P 標準套裝';
var searchUrl = 'https://www.momoshop.com.tw/search/' +
  encodeURIComponent(keyword) + '?viewport=desktop';

http.fetchText(searchUrl, 'desktop').then(function (res) {
  var codes = {};
  var re = /i_code=(\d+)/g;
  var m;
  while ((m = re.exec(res.body)) !== null) { codes[m[1]] = true; }
  var list = Object.keys(codes);
  console.log('候選 ' + list.length + ' 筆：' + list.join(' '));
  return list.reduce(function (chain, code) {
    return chain.then(function () {
      return http.fetchText('https://m.momoshop.com.tw/goods.momo?i_code=' + code, 'mobile')
        .then(function (page) {
          var t = page.body.match(/<title>([^<]*)/);
          console.log(code + '  ' + (t ? t[1].slice(0, 70) : '(無標題)'));
        })
        .catch(function (e) { console.log(code + '  抓取失敗: ' + e.message); });
    });
  }, Promise.resolve());
}).catch(function (e) {
  console.error(e);
  process.exit(1);
});
```

此工具依賴 Task 3 的 `src/http.js`，所以**執行順序上 Task 2 的 Step 2 之後要先做 Task 3**。若想先跑，可暫時用 `curl` 手動做同樣的事：

```bash
curl -sL --compressed -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" \
  "https://www.momoshop.com.tw/search/OSMO%20POCKET%204P%20%E6%A8%99%E6%BA%96%E5%A5%97%E8%A3%9D?viewport=desktop" \
  | grep -o -E 'i_code=[0-9]+' | sed 's/i_code=//' | sort -u
```

- [ ] **Step 2: 找出正確編號**

驗收標準：商品頁標題以「【DJI】」開頭且含「Osmo Pocket 4P 標準套裝」，且不是配件（收納包、保護殼、鋼化貼、濾鏡）。

若 curl 路徑掃不出來（2026-08-18 實測時搜尋頁 SSR 只吐 5 筆，全是 Sunnylife 配件），改用瀏覽器：開 `https://www.momoshop.com.tw/search/OSMO%20POCKET%204P`，在結果頁找到 DJI 官方那筆，從網址列或連結取得 `i_code`。

**備案**：若 momo 上根本沒有純標準套裝賣場，就用 `15508707`（`【DJI】Osmo Pocket 4P 標準套裝+12150143收納包+12150130保護殼+鋼化貼*3組入+0632防丟`，2026-08-18 實測存在的 DJI 4P 組合賣場），並把 label 改成 `momo・標準套裝(組合包)`，README 註明這是組合賣場、價格與官方標準套裝不同。

- [ ] **Step 3: 寫進 `targets.json`**

在陣列最後加入（`<i_code>` 換成上一步找到的數字）：

```json
  {
    "id": "momo-std",
    "source": "momo",
    "label": "momo・標準套裝",
    "iCode": "<i_code>"
  }
```

- [ ] **Step 4: Commit**

```bash
cd /Users/raychang/dji-restock-watch
git add targets.json scripts/find-momo-icode.js
git commit -m "feat: 加入 momo 監控目標與商品編號掃描工具"
```

---

## Task 3: HTTP 抓取層

**Files:**
- Create: `src/http.js`

不寫單元測試（理由見開頭「與 spec 的差異」第 2 點），驗證交給 Task 5 的探針。

- [ ] **Step 1: 寫 `src/http.js`**

> **2026-08-18 審查後修正。** 這段程式碼的初版有一個 Critical 缺陷，已由品質審查以本地
> HTTPS 伺服器在 node v10 與 v20 上實測重現：回應中途斷線時，因為沒有掛 `res.on('error')`
> 也沒檢查 `res.complete`，**node 20（GitHub Actions 實際跑的版本）會讓 Promise 永遠不 settle**
> ——job 卡死、`state.json` 不寫、`failStreak` 不累加、「抓取異常」警報永遠不會響，機器人
> 安靜死掉；node 10 則會以 `status=200` 回傳半截頁面。另外非 2xx 回應原本被當成正常內容
> 交給解析器，403 阻擋頁對 momo 那條「無關鍵字即判有貨」的規則會造成假到貨推播。
>
> 以下是實際上線版本。除了上述修正，Task 5 的 CI 連通性關卡又追加了一項：
> `fetchText` 多一個選用的 `extraHeaders` 參數，用來送 DJI 的地區覆寫 cookie
> （美國機房 IP 不帶它會被導去美國站然後 404，見 Task 5 與 Task 12 的說明）。
> 轉址與重試路徑都必須把它傳下去，否則跟隨轉址後 cookie 就掉了。

```js
'use strict';

var https = require('https');
var zlib = require('zlib');
var urlLib = require('url');

var UA = {
  desktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  mobile: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
          '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
};

// TIMEOUT_MS 必須小於 DEADLINE_MS，否則 deadline 永遠先觸發，下面那個 socket
// 閒置逾時就成了永不執行的死碼，log 上也分不出「伺服器完全沒回應」與
// 「傳到一半停住／慢速滴水」——這兩種故障的處置方式並不一樣。
var TIMEOUT_MS = 10000;
var MAX_REDIRECTS = 3;
var RETRY_DELAY_MS = 3000;
var DEADLINE_MS = 15000;

// extraHeaders 用來覆寫／補上個別目標需要的 header（例如 DJI 的地區 cookie，
// 見下方 request() 的說明），其餘預設 header 維持不變。手寫迴圈而非
// Object.assign 純粹是跟本檔案其餘部分的寫法一致，沒有相容性考量。
function mergeHeaders(base, extra) {
  var out = {};
  var k;
  for (k in base) { if (base.hasOwnProperty(k)) { out[k] = base[k]; } }
  if (extra) {
    for (k in extra) { if (extra.hasOwnProperty(k)) { out[k] = extra[k]; } }
  }
  return out;
}

// 只宣告 gzip/deflate，不要 br：Node v10 沒有 brotliDecompress。
//
// extraHeaders（選用第四參數）：目前唯一用途是 DJI 的地區覆寫。DJI 會依請求
// 來源 IP 的地理位置，把 /tw/ 開頭的網址轉址到沒有國碼前綴的頁面，而 Osmo
// Pocket 4P 因 FCC 認證從未在美上市，於是在美國機房 IP 下轉址後 404。實測
// 帶上 DJI 自己核發的 `region=TW` cookie 即可讓它依然回台灣站內容，且與台灣
// 住宅 IP 逐位元組相同。調查過程與其他候選方案見 scripts/probe-dji-variants.js。
function request(url, ua, redirectsLeft, extraHeaders) {
  return new Promise(function (resolve, reject) {
    var opts = urlLib.parse(url);
    opts.headers = mergeHeaders({
      'User-Agent': ua,
      'Accept': 'text/html,application/json,*/*',
      'Accept-Encoding': 'gzip, deflate',
      'Accept-Language': 'zh-TW,zh;q=0.9'
    }, extraHeaders);

    var req = https.get(opts, function (res) {
      var status = res.statusCode;
      var loc = res.headers.location;

      // 只支援 https 轉址：轉址到 http:// 會以 ERR_INVALID_PROTOCOL 失敗（實測），
      // 失敗方式安全但該目標會永久抓不到，未來 debug 時不必對著 unknown 發呆。
      // extraHeaders 要跟著轉址傳下去，否則跟隨轉址後 cookie 就掉了——
      // 這正是我們要用 extraHeaders 解決的問題本身。
      if (status >= 300 && status < 400 && loc && redirectsLeft > 0) {
        res.resume();
        resolve(request(urlLib.resolve(url, loc), ua, redirectsLeft - 1, extraHeaders));
        return;
      }

      // 非 2xx（含轉址預算用完、3xx 無 Location）一律當失敗，不要把錯誤頁交給解析器。
      // 拋錯會被 main.js 降級成 unknown（維持前一狀態、不推播），這是安全方向。
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error('HTTP ' + status + ': ' + url));
        return;
      }

      var chunks = [];
      // 連線中途斷掉：v10 會照常觸發 'end'（半截 body），v20 則是 'end' 永不觸發。
      // 兩條都必須擋，否則不是安靜回傳半截頁面，就是 Promise 永遠不 settle。
      res.on('aborted', function () { reject(new Error('response aborted: ' + url)); });
      res.on('error', reject);
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        if (!res.complete) { reject(new Error('incomplete response: ' + url)); return; }
        var buf = Buffer.concat(chunks);
        var enc = String(res.headers['content-encoding'] || '').toLowerCase();
        var done = function (err, out) {
          if (err) { reject(err); return; }
          // 寫死 UTF-8，目前三個目標都是 UTF-8，若未來新增 Big5 通路要在這裡處理。
          resolve({ status: status, body: out.toString('utf8') });
        };
        if (enc === 'gzip') { zlib.gunzip(buf, done); }
        else if (enc === 'deflate') {
          zlib.inflate(buf, function (err, out) {
            if (err) { zlib.inflateRaw(buf, done); return; }   // 有些伺服器回 raw deflate
            done(null, out);
          });
        }
        else { done(null, buf); }
      });
    });

    // 總時長硬上限：setTimeout 只管 socket 閒置，擋不住慢速滴水的伺服器。
    // 注意順序：先 reject 再 destroy。對已關閉的 request 呼叫 destroy(err) 不會發出 'error'。
    var deadline = setTimeout(function () {
      reject(new Error('deadline ' + DEADLINE_MS + 'ms exceeded: ' + url));
      req.destroy();
    }, DEADLINE_MS);
    deadline.unref();

    req.setTimeout(TIMEOUT_MS, function () {
      req.destroy(new Error('timeout after ' + TIMEOUT_MS + 'ms: ' + url));
    });
    req.on('error', reject);
  });
}

function delay(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

// 失敗重試一次。連兩次失敗才算真的失敗。
// extraHeaders 是選用第三參數，不傳就是原本兩參數的呼叫方式，向後相容。
function fetchText(url, kind, extraHeaders) {
  var ua = kind === 'mobile' ? UA.mobile : UA.desktop;
  return request(url, ua, MAX_REDIRECTS, extraHeaders).catch(function (e1) {
    console.error('[http] 第一次失敗，3 秒後重試：' + url + ' -> ' + e1.message);
    return delay(RETRY_DELAY_MS).then(function () {
      return request(url, ua, MAX_REDIRECTS, extraHeaders);
    });
  });
}

// fetchText 回傳的是 { status: Number, body: String } 物件，不是字串，呼叫端要自己取 .body。
module.exports = { fetchText: fetchText, UA: UA };
```

- [ ] **Step 2: 手動驗證抓得到 DJI 頁面**

```bash
cd /Users/raychang/dji-restock-watch
node -e "require('./src/http').fetchText('https://store.dji.com/tw/product/osmo-pocket-4p','desktop').then(function(r){console.log(r.status, r.body.length, r.body.indexOf('__PRELOADED_STATE__'));})"
```

預期：印出 `200`、六位數的長度、以及一個大於 0 的位置索引（例如 `200 730763 147539`）。若長度只有幾萬或索引是 `-1`，表示解壓或轉址有問題。

- [ ] **Step 3: Commit**

```bash
git add src/http.js
git commit -m "feat: HTTP 抓取層（gzip 解壓、轉址、timeout、重試）"
```

---

## Task 4: 存下 fixtures（含有貨態）

這一步是整個計畫最容易被跳過、跳過就會在到貨當天壞掉的地方：**「有貨」是我們從沒在這三個目標商品上觀測過的狀態**。解析器與商品無關（吃字串吐狀態），所以現在就能用別的現貨商品把 `in` 這條分支釘死。

**Files:**
- Create: `scripts/save-fixtures.js`
- Create: `tests/fixtures/dji-product.html`
- Create: `tests/fixtures/pchome-out.jsonp`
- Create: `tests/fixtures/pchome-in.jsonp`
- Create: `tests/fixtures/momo-out.html`
- Create: `tests/fixtures/momo-in.html`

- [ ] **Step 1: 寫存檔工具**

`scripts/save-fixtures.js`：

```js
'use strict';

// 一次性工具：把三家的真實回應存成 fixture。
// DJI 那一頁同時含 out_of_stock 與 on_sale 的 SKU，一份就夠測兩條分支。

var fs = require('fs');
var path = require('path');
var http = require('../src/http');

var DIR = path.join(__dirname, '..', 'tests', 'fixtures');

var JOBS = [
  { file: 'dji-product.html', kind: 'desktop',
    url: 'https://store.dji.com/tw/product/osmo-pocket-4p' },
  { file: 'pchome-out.jsonp', kind: 'desktop',
    url: 'https://ecapi.pchome.com.tw/ecshop/prodapi/v2/prod/button&id=DGCF6H-A900K53U9&fields=Id,Price,ButtonType,SaleStatus,Qty&_callback=x' },
  // 有貨態：用現貨的 Osmo Pocket 3 問出 ButtonType 的真值
  { file: 'pchome-in.jsonp', kind: 'desktop',
    url: 'https://ecapi.pchome.com.tw/ecshop/prodapi/v2/prod/button&id=DGCF41-A900ID91A&fields=Id,Price,ButtonType,SaleStatus,Qty&_callback=x' }
];

// momo 的兩份 fixture 要用實際的 i_code，在 Step 2 以參數指定
var momoOut = process.env.MOMO_OUT_ICODE;
var momoIn = process.env.MOMO_IN_ICODE;
if (momoOut) {
  JOBS.push({ file: 'momo-out.html', kind: 'mobile',
    url: 'https://m.momoshop.com.tw/goods.momo?i_code=' + momoOut });
}
if (momoIn) {
  JOBS.push({ file: 'momo-in.html', kind: 'mobile',
    url: 'https://m.momoshop.com.tw/goods.momo?i_code=' + momoIn });
}

JOBS.reduce(function (chain, job) {
  return chain.then(function () {
    return http.fetchText(job.url, job.kind).then(function (res) {
      fs.writeFileSync(path.join(DIR, job.file), res.body);
      console.log(job.file + '  http=' + res.status + '  ' + res.body.length + ' bytes');
    });
  });
}, Promise.resolve()).catch(function (e) {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: 執行，存下五份 fixture**

`MOMO_OUT_ICODE` 用 Task 2 找到的 4P 編號。`MOMO_IN_ICODE` 用任何一個 momo 現貨商品——挑一個確定買得到、不是預購的便宜小東西即可（在 momo 網站上確認該頁顯示「加入購物車」且沒有「預購」字樣，再把編號填進來）。

```bash
cd /Users/raychang/dji-restock-watch
MOMO_OUT_ICODE=15508707 MOMO_IN_ICODE=<任一現貨商品的i_code> node scripts/save-fixtures.js
```

`MOMO_OUT_ICODE` 用 `15508707`（DJI 的 4P 組合包賣場）。**雖然已決定不監控這個賣場，
但它仍是取得「缺貨態」momo 頁面最合適的來源**——解析器與商品無關（吃字串吐狀態），
fixture 只是用來釘住解析規則。

預期輸出五行，每行 `http=200` 且 bytes 為合理大小（DJI 約 70 萬、PChome 約 200、momo 約 3 萬）。

- [ ] **Step 3: 確認 fixture 的內容真的涵蓋兩種狀態**

```bash
cd /Users/raychang/dji-restock-watch
grep -c 'out_of_stock' tests/fixtures/dji-product.html
grep -c 'on_sale' tests/fixtures/dji-product.html
grep -o 'ButtonType":"[A-Za-z]*' tests/fixtures/pchome-out.jsonp tests/fixtures/pchome-in.jsonp
grep -c '預購' tests/fixtures/momo-in.html
```

預期：前兩個都 > 0；PChome 兩檔分別是 `OrderRefill` 與 `ForSale`；**`momo-in.html` 的「預購」計數必須是 0**。

若 `momo-in.html` 也含「預購」，代表「頁面出現預購字樣就判定為缺貨」這條規則太寬（推薦商品區之類的地方也會出現這兩個字），必須在 Task 8 改成只在購買按鈕附近的區塊比對。這正是這份 fixture 存在的意義。

- [ ] **Step 4: Commit**

```bash
git add scripts/save-fixtures.js tests/fixtures
git commit -m "test: 存下三家的真實 fixture，含有貨與缺貨兩態"
```

---

## Task 5: CI 連通性探針（**放行關卡**）

所有可行性驗證都是從台灣住宅 IP 做的，GitHub Actions runner 是美國 Azure 機房 IP。momo 有 Akamai 前置、PChome 的 API 也可能對機房 IP 有不同待遇。**在寫狀態機與推播之前，先確認三家從 CI 抓得到。**

**Files:**
- Create: `scripts/probe.js`
- Create: `.github/workflows/probe.yml`

- [ ] **Step 1: 寫探針腳本**

`scripts/probe.js`：

```js
'use strict';

// 連通性探針：對三個來源各抓一次，印出狀態碼、長度與關鍵字命中。
// 目的是確認 GitHub Actions 的機房 IP 不會被擋、不會拿到不同版本的頁面。

var fs = require('fs');
var path = require('path');
var http = require('../src/http');

var targets = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'targets.json'), 'utf8'));

function urlFor(t) {
  if (t.source === 'dji') { return { url: t.url, kind: 'desktop' }; }
  if (t.source === 'pchome') {
    return {
      url: 'https://ecapi.pchome.com.tw/ecshop/prodapi/v2/prod/button&id=' + t.prodId +
           '&fields=Id,Price,ButtonType,SaleStatus,Qty&_callback=x',
      kind: 'desktop'
    };
  }
  return { url: 'https://m.momoshop.com.tw/goods.momo?i_code=' + t.iCode, kind: 'mobile' };
}

var MARKERS = {
  dji: ['__PRELOADED_STATE__', 'out_of_stock', 'on_sale'],
  pchome: ['ButtonType', 'SaleStatus'],
  momo: ['此為預購商品', '加入購物車']
};

// 同一個 URL 只抓一次
var seen = {};
var jobs = [];
targets.forEach(function (t) {
  var u = urlFor(t);
  if (seen[u.url]) { return; }
  seen[u.url] = true;
  jobs.push({ source: t.source, url: u.url, kind: u.kind, optional: false });
});

// momo 目前不在 targets.json 裡（只有黃牛價的組合包，見 README），但解析器已備妥。
// 這裡多抓一次純粹是為了知道 GitHub 的美國機房 IP 能不能抓到 momo（它有 Akamai 前置）。
// 失敗不影響本探針的成敗判定，只是資訊——省掉日後想啟用 momo 時再跑一次這個關卡。
jobs.push({
  source: 'momo',
  url: 'https://m.momoshop.com.tw/goods.momo?i_code=15508707',
  kind: 'mobile',
  optional: true
});

var failed = false;

jobs.reduce(function (chain, job) {
  return chain.then(function () {
    // 注意：src/http.js 對非 2xx 一律 reject，所以 403／503 會走下面的 catch，
    // 而不是以 res.status 回來——這正是我們要在 CI 上看到的訊號。
    return http.fetchText(job.url, job.kind).then(function (res) {
      var hits = MARKERS[job.source].map(function (m) {
        return m + '=' + (res.body.split(m).length - 1);
      }).join(' ');
      console.log((job.optional ? '[選用] ' : '') + job.source + '  http=' + res.status +
                  '  ' + res.body.length + ' bytes  ' + hits);
      if (res.status !== 200 && !job.optional) { failed = true; }
    }).catch(function (e) {
      console.log((job.optional ? '[選用] ' : '') + job.source + '  失敗: ' + e.message);
      if (!job.optional) { failed = true; }
    });
  });
}, Promise.resolve()).then(function () {
  process.exit(failed ? 1 : 0);
});
```

- [ ] **Step 2: 寫探針 workflow**

`.github/workflows/probe.yml`：

```yaml
name: probe

on:
  workflow_dispatch:

jobs:
  probe:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: node scripts/probe.js
```

- [ ] **Step 3: 本機先跑一次當對照組**

```bash
cd /Users/raychang/dji-restock-watch
node scripts/probe.js
```

預期三行都是 `http=200`，且 dji 行的 `__PRELOADED_STATE__=1`、momo 行的關鍵字至少命中一個。記下這三行，等一下要跟 CI 的輸出比對。

- [ ] **Step 4: 推上去並在 CI 跑**

```bash
git add scripts/probe.js .github/workflows/probe.yml
git commit -m "chore: CI 連通性探針"
git push
gh workflow run probe.yml
sleep 45 && gh run list --workflow=probe.yml --limit 1
gh run view --log | tail -20
```

- [ ] **Step 5: 放行判斷**

| CI 結果 | 動作 |
|---|---|
| 三家都 200 且關鍵字命中數與本機相近 | 通過，繼續 Task 6 |
| 某家 403 / 302 到驗證頁 / 長度異常小 | **停下來回報**。這是設計轉向：要嘛該來源改由本機 launchd 補一條腿，要嘛放棄該來源。不要硬做下去 |

---

## Task 6: 測試小工具

**Files:**
- Create: `tests/harness.js`
- Create: `tests/run-all.sh`

- [ ] **Step 1: 寫 `tests/harness.js`**

```js
'use strict';

var pass = 0;
var fail = 0;

function test(name, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    fail++;
    console.log('  ✗ ' + name + ' — ' + e.message);
  }
}

function done(label) {
  console.log(label + ': ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail > 0 ? 1 : 0);
}

module.exports = { test: test, done: done, assert: require('assert') };
```

- [ ] **Step 2: 寫 `tests/run-all.sh`**

```sh
#!/bin/sh
# 跑完全部測試。只需要 node，不需要 npm 或任何套件。
#   sh tests/run-all.sh
# 全部測試都吃 tests/fixtures/ 下的真實頁面，不連網。
cd "$(dirname "$0")" || exit 1
fail=0

for f in test-dji test-pchome test-momo test-state; do
  printf '%-16s ' "$f"
  out=$(node "$f.js" 2>&1)
  status=$?
  echo "$out" | tail -1
  if [ $status -ne 0 ]; then
    echo "$out" | grep '✗'
    fail=1
  fi
done

exit $fail
```

- [ ] **Step 3: Commit**

```bash
git add tests/harness.js tests/run-all.sh
git commit -m "test: 測試小工具與執行腳本"
```

---

## Task 7: DJI 解析器

DJI 頁面裡有 `window.__PRELOADED_STATE__ = {...};`，是一個 482KB 的純 JSON 物件字面值，目標 SKU 位在 `products.variants[]`，每筆有 `title`、`status.code`（`out_of_stock` / `on_sale`）、`price`（19290）。取法是從 `{` 開始做括號配對（要處理字串與跳脫字元），再 `JSON.parse`。

**Files:**
- Create: `tests/test-dji.js`
- Create: `src/sources/dji.js`

- [ ] **Step 1: 寫失敗的測試**

`tests/test-dji.js`：

```js
'use strict';

var fs = require('fs');
var path = require('path');
var h = require('./harness');
var dji = require('../src/sources/dji');

var html = fs.readFileSync(path.join(__dirname, 'fixtures', 'dji-product.html'), 'utf8');

h.test('缺貨的 SKU 判定為 out', function () {
  var r = dji.parse(html, { skuTitle: 'Osmo Pocket 4P 標準套裝' });
  h.assert.strictEqual(r.status, 'out');
  h.assert.strictEqual(r.price, 19290);
});

h.test('珠光白同樣判定為 out', function () {
  var r = dji.parse(html, { skuTitle: 'Osmo Pocket 4P 標準套裝（珠光白）' });
  h.assert.strictEqual(r.status, 'out');
});

h.test('有貨的 SKU 判定為 in', function () {
  // 同一份頁面裡的現貨商品，用來釘住 on_sale 這條分支
  var r = dji.parse(html, { skuTitle: 'DJI Mic 3 發射器' });
  h.assert.strictEqual(r.status, 'in');
});

h.test('標題比對必須完全相等，不可用包含', function () {
  // 「Osmo Pocket 4P 標準套裝」是「Osmo Pocket 4P 標準套裝（珠光白）」的前綴。
  // 若用 indexOf 比對，黑色 target 會誤中白色 SKU，兩者狀態永遠一致，等於白監控一個。
  var black = dji.parse(html, { skuTitle: 'Osmo Pocket 4P 標準套裝' });
  h.assert.strictEqual(black.title, 'Osmo Pocket 4P 標準套裝');
});

h.test('找不到 SKU 時回 unknown，不可回 out', function () {
  var r = dji.parse(html, { skuTitle: '這個 SKU 不存在' });
  h.assert.strictEqual(r.status, 'unknown');
});

h.test('頁面沒有 __PRELOADED_STATE__ 時回 unknown', function () {
  var r = dji.parse('<html><body>維護中</body></html>', { skuTitle: 'Osmo Pocket 4P 標準套裝' });
  h.assert.strictEqual(r.status, 'unknown');
});

h.test('JSON 壞掉時回 unknown 而不是丟例外', function () {
  var r = dji.parse('window.__PRELOADED_STATE__ = {"products":{oops}', { skuTitle: 'x' });
  h.assert.strictEqual(r.status, 'unknown');
});

h.done('test-dji');
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd /Users/raychang/dji-restock-watch && node tests/test-dji.js
```

預期：`Cannot find module '../src/sources/dji'`。

- [ ] **Step 3: 寫實作**

`src/sources/dji.js`：

```js
'use strict';

var MARKER = 'window.__PRELOADED_STATE__ = ';

// 從 HTML 取出 __PRELOADED_STATE__ 的 JSON。用括號配對找結尾，
// 因為這個物件後面直接接著別的 script，沒有可靠的結束標記。
function extractPreloadedState(html) {
  var at = html.indexOf(MARKER);
  if (at < 0) { return null; }

  var start = at + MARKER.length;
  if (html.charAt(start) !== '{') { return null; }

  var depth = 0;
  var inStr = false;
  var esc = false;

  for (var i = start; i < html.length; i++) {
    var c = html.charAt(i);

    if (inStr) {
      if (esc) { esc = false; }
      else if (c === '\\') { esc = true; }
      else if (c === '"') { inStr = false; }
      continue;
    }

    if (c === '"') { inStr = true; }
    else if (c === '{') { depth++; }
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch (e) {
          return null;
        }
      }
    }
  }
  return null;
}

function parse(html, target) {
  var state = extractPreloadedState(html);
  if (!state || !state.products || !Array.isArray(state.products.variants)) {
    return { status: 'unknown', reason: '找不到 __PRELOADED_STATE__.products.variants' };
  }

  var variants = state.products.variants;
  for (var i = 0; i < variants.length; i++) {
    var v = variants[i];
    // 必須完全相等：「…標準套裝」是「…標準套裝（珠光白）」的前綴
    if (v && v.title === target.skuTitle) {
      var code = v.status && v.status.code;
      if (code === 'on_sale') {
        return { status: 'in', title: v.title, price: v.price };
      }
      if (code === 'out_of_stock') {
        return { status: 'out', title: v.title, price: v.price };
      }
      return { status: 'unknown', reason: '未知的 status.code: ' + code };
    }
  }

  return { status: 'unknown', reason: '找不到 SKU: ' + target.skuTitle };
}

module.exports = { parse: parse, extractPreloadedState: extractPreloadedState };
```

- [ ] **Step 4: 跑測試確認通過**

```bash
cd /Users/raychang/dji-restock-watch && node tests/test-dji.js
```

預期：`test-dji: 7 passed, 0 failed`。

- [ ] **Step 5: Commit**

```bash
git add tests/test-dji.js src/sources/dji.js
git commit -m "feat: DJI 商城解析器"
```

---

## Task 8: PChome 解析器

PChome 的 button API 回的是 JSONP：`try{x([{...}]);}catch(e){...}`。實測真值——缺貨 `{"ButtonType":"OrderRefill","SaleStatus":0,"Qty":0}`，有貨 `{"ButtonType":"ForSale","SaleStatus":1,"Qty":1}`。

**Files:**
- Create: `tests/test-pchome.js`
- Create: `src/sources/pchome.js`

- [ ] **Step 1: 寫失敗的測試**

`tests/test-pchome.js`：

```js
'use strict';

var fs = require('fs');
var path = require('path');
var h = require('./harness');
var pchome = require('../src/sources/pchome');

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

h.test('補貨中判定為 out', function () {
  var r = pchome.parse(fixture('pchome-out.jsonp'), { prodId: 'DGCF6H-A900K53U9' });
  h.assert.strictEqual(r.status, 'out');
});

h.test('現貨判定為 in', function () {
  var r = pchome.parse(fixture('pchome-in.jsonp'), { prodId: 'DGCF41-A900ID91A' });
  h.assert.strictEqual(r.status, 'in');
});

h.test('未知的 ButtonType 回 unknown，不猜', function () {
  var jsonp = 'try{x([{"Id":"X-000","Price":{"P":19290},"ButtonType":"SomethingNew","SaleStatus":1,"Qty":1}]);}catch(e){}';
  var r = pchome.parse(jsonp, { prodId: 'X' });
  h.assert.strictEqual(r.status, 'unknown');
});

h.test('ButtonType 可買但 Qty 為 0 時不算有貨', function () {
  var jsonp = 'try{x([{"Id":"X-000","Price":{"P":19290},"ButtonType":"ForSale","SaleStatus":1,"Qty":0}]);}catch(e){}';
  var r = pchome.parse(jsonp, { prodId: 'X' });
  h.assert.notStrictEqual(r.status, 'in');
});

h.test('查無此商品（空陣列）回 unknown', function () {
  var r = pchome.parse('try{x([]);}catch(e){}', { prodId: 'X' });
  h.assert.strictEqual(r.status, 'unknown');
});

h.test('回應不是 JSONP 時回 unknown 而不是丟例外', function () {
  var r = pchome.parse('<html>503 Service Unavailable</html>', { prodId: 'X' });
  h.assert.strictEqual(r.status, 'unknown');
});

h.done('test-pchome');
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd /Users/raychang/dji-restock-watch && node tests/test-pchome.js
```

預期：`Cannot find module '../src/sources/pchome'`。

- [ ] **Step 3: 寫實作**

`src/sources/pchome.js`：

```js
'use strict';

// 實測真值（2026-08-18）：
//   缺貨 {"ButtonType":"OrderRefill","SaleStatus":0,"Qty":0}
//   有貨 {"ButtonType":"ForSale","SaleStatus":1,"Qty":1}
var BUYABLE = ['ForSale'];
var UNAVAILABLE = ['OrderRefill', 'NotReady', 'SoldOut', 'Notify'];

function parse(jsonp, target) {
  var open = jsonp.indexOf('[');
  var close = jsonp.lastIndexOf(']');
  if (open < 0 || close < open) {
    return { status: 'unknown', reason: '回應不是 JSONP' };
  }

  var rows;
  try {
    rows = JSON.parse(jsonp.slice(open, close + 1));
  } catch (e) {
    return { status: 'unknown', reason: 'JSON 解析失敗' };
  }

  if (!rows.length) {
    return { status: 'unknown', reason: '查無商品: ' + target.prodId };
  }

  var row = rows[0];
  var price = row.Price ? row.Price.P : null;
  var bt = row.ButtonType;

  if (BUYABLE.indexOf(bt) >= 0 && row.SaleStatus === 1 && row.Qty > 0) {
    return { status: 'in', price: price };
  }
  if (UNAVAILABLE.indexOf(bt) >= 0) {
    return { status: 'out', price: price };
  }
  // 沒看過的值一律 unknown。猜錯的代價是到貨當天靜音，寧可讓 failStreak 警報叫我。
  return { status: 'unknown', reason: '未知的 ButtonType: ' + bt };
}

module.exports = { parse: parse };
```

- [ ] **Step 4: 跑測試確認通過**

```bash
cd /Users/raychang/dji-restock-watch && node tests/test-pchome.js
```

預期：`test-pchome: 6 passed, 0 failed`。

- [ ] **Step 5: Commit**

```bash
git add tests/test-pchome.js src/sources/pchome.js
git commit -m "feat: PChome 解析器"
```

---

## Task 9: momo 解析器

> **2026-08-18 依 Task 4 實測全面改寫。** 計畫原訂的規則是「頁面出現『預購』『售完』『補貨中』
> 任一字樣就判 out」，**這條規則是壞的**：每一個 momo 商品頁的配送條款樣板都寫著
> 「※若為預購商品，以下單日網頁公告之配送日期…」，所以裸字「預購」會在**現貨頁**上命中，
> 把所有商品都判成缺貨。已用四個確定現貨的商品交叉驗證，並在 fixture 上做過反證測試：
>
> | 規則 | 在 `momo-in.html`（現貨衛生紙）的命中數 | 判定 |
> |---|---|---|
> | 裸字「預購」 | 1 | ❌ 誤判成缺貨 |
> | 子字串「為預購商品」 | 1 | ❌ 誤判成缺貨 |
> | **完整字串「此為預購商品」** | **0** | ✅ 正確 |
>
> 同時排除了兩個看似可用的訊號：`<meta name="product:availability">` 在四個預購樣本上
> 全部是 `in stock`（無鑑別力）；購買按鈕的主要 CTA 條在現貨頁與預購頁**逐字元相同**
> （`momo-out.html` 另含一組規格選擇 drawer 的按鈕，那是 PS5 要選版本才有的元件，
> 與庫存狀態無關）。
>
> **「真正售完」的頁面找不到任何樣本**（搜到的「售完為止」全是促銷標語），因此那條路徑
> 走 `unknown` 而非 `out`——不用零樣本猜出來的規則去冒充有信心的分類。

**Files:**
- Create: `tests/test-momo.js`
- Create: `src/sources/momo.js`

- [ ] **Step 1: 寫失敗的測試**

`tests/test-momo.js`：

```js
'use strict';

var fs = require('fs');
var path = require('path');
var h = require('./harness');
var momo = require('../src/sources/momo');

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

h.test('預購商品判定為 out', function () {
  var r = momo.parse(fixture('momo-out.html'), {});
  h.assert.strictEqual(r.status, 'out');
});

h.test('現貨商品判定為 in', function () {
  var r = momo.parse(fixture('momo-in.html'), {});
  h.assert.strictEqual(r.status, 'in');
});

h.test('現貨頁不可被配送條款樣板誤判為缺貨', function () {
  // 這是本解析器存在的核心風險：momo 每一頁都有「※若為預購商品，以下單日網頁公告之
  // 配送日期…」的樣板文字。實測 momo-in.html（確定是現貨的衛生紙）含「為預購商品」
  // 1 次、裸字「預購」1 次——用那兩種簡化規則會把所有商品都判成缺貨。
  var html = fixture('momo-in.html');
  h.assert.ok(html.indexOf('為預購商品') >= 0, 'fixture 前提：現貨頁確實含「為預購商品」');
  h.assert.strictEqual(momo.parse(html, {}).status, 'in');
});

h.test('只比對完整字串「此為預購商品」', function () {
  var html = '<div>※若為預購商品，以下單日網頁公告之配送日期為準</div><button>加入購物車</button>';
  h.assert.strictEqual(momo.parse(html, {}).status, 'in');
});

h.test('預購標記優先於購買按鈕', function () {
  // 預購商品同樣可以加入購物車，兩者會同時出現在頁面上，順序不可顛倒。
  var html = '<div>此為預購商品，訂單確認後，預計 2026/09/04出貨</div><button>加入購物車</button>';
  h.assert.strictEqual(momo.parse(html, {}).status, 'out');
});

h.test('兩種標記都沒有時回 unknown，不可回 out', function () {
  var r = momo.parse('<html><body>系統忙碌中</body></html>', {});
  h.assert.strictEqual(r.status, 'unknown');
});

h.done('test-momo');
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd /Users/raychang/dji-restock-watch && node tests/test-momo.js
```

預期：`Cannot find module '../src/sources/momo'`。

- [ ] **Step 3: 寫實作**

`src/sources/momo.js`：

```js
'use strict';

// 判定依據全部來自 2026-08-18 對真實頁面的實測。改動前請先讀 tests/fixtures/momo-*.html
// 與 tests/test-momo.js 裡的反證測試。
//
// 必須比對「完整」字串「此為預購商品」，不可簡化成「為預購商品」或裸字「預購」：
// 每一個 momo 商品頁的配送條款樣板都有「※若為預購商品，以下單日網頁公告之配送日期…」，
// 簡化規則會在現貨頁上命中，把所有商品都判成缺貨。
var PREORDER_MARK = '此為預購商品';
var BUY_MARK = '加入購物車';

function parse(html, target) {
  // 順序有意義：預購商品同樣可以加入購物車，兩個標記會同時出現。
  if (html.indexOf(PREORDER_MARK) >= 0) {
    return { status: 'out', mark: PREORDER_MARK };
  }
  if (html.indexOf(BUY_MARK) >= 0) {
    return { status: 'in' };
  }
  // 「真正售完」的 momo 頁面目前找不到樣本，所以不假裝知道它長什麼樣。
  // unknown 會維持前一狀態、不推播、failStreak + 1，連續 4 次才發告警——
  // 比起用零樣本猜出來的規則判 out（那會把真正的補貨永久靜默吃掉）安全得多。
  return { status: 'unknown', reason: '頁面沒有預購標記也沒有購買按鈕' };
}

module.exports = { parse: parse };
```

- [ ] **Step 4: 跑測試確認通過**

```bash
cd /Users/raychang/dji-restock-watch && node tests/test-momo.js
```

預期：`test-momo: 6 passed, 0 failed`。

- [ ] **Step 5: Commit**

```bash
git add tests/test-momo.js src/sources/momo.js
git commit -m "feat: momo 解析器（完整比對「此為預購商品」）"
```

> **注意：`targets.json` 目前沒有 momo 目標**（momo 上只有黃牛價的組合包，見 Task 2 的決策紀錄）。
> 這支解析器是為了日後 momo 出現純標準套裝賣場時能立刻啟用而寫的，寫完不會被實際執行。
> 因此它的正確性**完全**依賴上面那組 fixture 測試——沒有 dry-run 會幫你發現問題。

## Task 10: 狀態機

整份計畫邏輯最密的一塊。所有時間都由參數傳入，不在模組內呼叫 `Date.now()`，否則節流與冷卻邏輯無法測試。

**Files:**
- Create: `tests/test-state.js`
- Create: `src/state.js`

- [ ] **Step 1: 寫失敗的測試**

`tests/test-state.js`：

```js
'use strict';

var h = require('./harness');
var state = require('../src/state');

var T0 = new Date('2026-09-01T00:00:00Z');

function at(minutes) {
  return new Date(T0.getTime() + minutes * 60 * 1000);
}

var TARGETS = [{ id: 'a', label: 'A店・標準套裝', source: 'dji' }];

function fresh() {
  return state.empty();
}

h.test('第一次執行抓到缺貨，不推播', function () {
  var out = state.step(fresh(), TARGETS, { a: { status: 'out' } }, T0);
  h.assert.strictEqual(out.message, null);
  h.assert.strictEqual(out.state.targets.a.status, 'out');
});

h.test('第一次執行就抓到有貨，要推播', function () {
  var out = state.step(fresh(), TARGETS, { a: { status: 'in' } }, T0);
  h.assert.ok(out.message);
  h.assert.ok(out.message.indexOf('到貨') >= 0);
});

h.test('缺貨轉有貨，推播', function () {
  var s1 = state.step(fresh(), TARGETS, { a: { status: 'out' } }, T0).state;
  var out = state.step(s1, TARGETS, { a: { status: 'in' } }, at(10));
  h.assert.ok(out.message);
  h.assert.strictEqual(out.state.targets.a.notifyCount, 1);
});

h.test('持續有貨但未滿 60 分鐘，不重複推播', function () {
  var s1 = state.step(fresh(), TARGETS, { a: { status: 'in' } }, T0).state;
  var out = state.step(s1, TARGETS, { a: { status: 'in' } }, at(50));
  h.assert.strictEqual(out.message, null);
});

h.test('持續有貨滿 60 分鐘，再提醒一次', function () {
  var s1 = state.step(fresh(), TARGETS, { a: { status: 'in' } }, T0).state;
  var out = state.step(s1, TARGETS, { a: { status: 'in' } }, at(60));
  h.assert.ok(out.message);
  h.assert.strictEqual(out.state.targets.a.notifyCount, 2);
});

h.test('同一波有貨最多提醒 5 次', function () {
  var s = state.step(fresh(), TARGETS, { a: { status: 'in' } }, T0).state;
  var minute = 0;
  for (var i = 0; i < 6; i++) {
    minute += 60;
    s = state.step(s, TARGETS, { a: { status: 'in' } }, at(minute)).state;
  }
  h.assert.strictEqual(s.targets.a.notifyCount, 5);
});

h.test('有貨轉缺貨，推播並算出開賣時長', function () {
  var s1 = state.step(fresh(), TARGETS, { a: { status: 'in' } }, T0).state;
  var out = state.step(s1, TARGETS, { a: { status: 'out' } }, at(90));
  h.assert.ok(out.message);
  h.assert.ok(out.message.indexOf('90') >= 0);
});

h.test('unknown 不改變已知狀態也不推播', function () {
  var s1 = state.step(fresh(), TARGETS, { a: { status: 'in' } }, T0).state;
  var out = state.step(s1, TARGETS, { a: { status: 'unknown' } }, at(10));
  h.assert.strictEqual(out.state.targets.a.status, 'in');
  h.assert.strictEqual(out.message, null);
});

h.test('連續 4 次抓取失敗才發警報', function () {
  var s = state.step(fresh(), TARGETS, { a: { status: 'out' } }, T0).state;
  var minute = 0;
  var last = null;
  for (var i = 0; i < 4; i++) {
    minute += 10;
    last = state.step(s, TARGETS, { a: { status: 'unknown' } }, at(minute));
    s = last.state;
  }
  h.assert.ok(last.message);
  h.assert.ok(last.message.indexOf('異常') >= 0);
});

h.test('警報 24 小時內只發一次', function () {
  var s = state.step(fresh(), TARGETS, { a: { status: 'out' } }, T0).state;
  var minute = 0;
  var i;
  for (i = 0; i < 4; i++) { minute += 10; s = state.step(s, TARGETS, { a: { status: 'unknown' } }, at(minute)).state; }
  var next = state.step(s, TARGETS, { a: { status: 'unknown' } }, at(minute + 10));
  h.assert.strictEqual(next.message, null);
});

h.test('抓取成功後 failStreak 歸零', function () {
  var s = state.step(fresh(), TARGETS, { a: { status: 'unknown' } }, T0).state;
  s = state.step(s, TARGETS, { a: { status: 'out' } }, at(10)).state;
  h.assert.strictEqual(s.targets.a.failStreak, 0);
});

h.test('額度用超過 180 則後，只留到貨推播', function () {
  var s = fresh();
  s.quota = { month: '2026-09', sent: 185 };
  s = state.step(s, TARGETS, { a: { status: 'in' } }, T0).state;
  var out = state.step(s, TARGETS, { a: { status: 'out' } }, at(90));
  h.assert.strictEqual(out.message, null, '售罄通知在額度吃緊時應該被關掉');
});

h.test('額度用超過 180 則，到貨推播仍要送出', function () {
  var s = fresh();
  s.quota = { month: '2026-09', sent: 185 };
  var out = state.step(s, TARGETS, { a: { status: 'in' } }, T0);
  h.assert.ok(out.message);
});

h.test('跨月時額度歸零', function () {
  var s = fresh();
  s.quota = { month: '2026-08', sent: 190 };
  var out = state.step(s, TARGETS, { a: { status: 'in' } }, T0);
  h.assert.strictEqual(out.state.quota.month, '2026-09');
  h.assert.strictEqual(out.state.quota.sent, 1);
});

h.test('每次推播都讓額度計數加一', function () {
  var out = state.step(fresh(), TARGETS, { a: { status: 'in' } }, T0);
  h.assert.strictEqual(out.state.quota.sent, 1);
});

h.test('lastRunDate 用台北日期，跨日才會變', function () {
  // 2026-09-01T00:00:00Z 是台北時間 09-01 08:00
  var out = state.step(fresh(), TARGETS, { a: { status: 'out' } }, T0);
  h.assert.strictEqual(out.state.lastRunDate, '2026-09-01');
  // 2026-09-01T16:30:00Z 是台北時間 09-02 00:30
  var next = state.step(out.state, TARGETS, { a: { status: 'out' } }, at(16 * 60 + 30));
  h.assert.strictEqual(next.state.lastRunDate, '2026-09-02');
});

h.test('狀態沒變也沒跨日時，state 內容完全不變', function () {
  // 這是「只在有事發生時 commit」的基礎：state.json 沒變，workflow 就不會 commit
  var s1 = state.step(fresh(), TARGETS, { a: { status: 'out' } }, T0).state;
  var s2 = state.step(s1, TARGETS, { a: { status: 'out' } }, at(10)).state;
  h.assert.strictEqual(JSON.stringify(s1), JSON.stringify(s2));
});

h.test('多個目標同時轉變時合成一則訊息', function () {
  var targets = [
    { id: 'a', label: 'A店・標準套裝', source: 'dji' },
    { id: 'b', label: 'B店・標準套裝', source: 'pchome' }
  ];
  var s = state.step(state.empty(), targets, { a: { status: 'out' }, b: { status: 'out' } }, T0).state;
  var out = state.step(s, targets, { a: { status: 'in' }, b: { status: 'in' } }, at(10));
  h.assert.ok(out.message.indexOf('A店') >= 0);
  h.assert.ok(out.message.indexOf('B店') >= 0);
  h.assert.strictEqual(out.state.quota.sent, 1, '合成一則，額度只扣一次');
});

h.done('test-state');
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd /Users/raychang/dji-restock-watch && node tests/test-state.js
```

預期：`Cannot find module '../src/state'`。

- [ ] **Step 3: 寫實作**

`src/state.js`：

```js
'use strict';

var IN_REMIND_INTERVAL_MS = 60 * 60 * 1000;
var IN_REMIND_MAX = 5;
var FAIL_STREAK_ALERT = 4;
var ERROR_COOLDOWN_MS = 24 * 60 * 60 * 1000;
var QUOTA_GUARD = 180;

// 台灣沒有日光節約時間，固定 +8 小時即可，不必依賴 Intl（Node v10 預設不含完整時區資料）
function taipei(now) {
  var t = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  var iso = t.toISOString();
  return { date: iso.slice(0, 10), month: iso.slice(0, 7), hhmm: iso.slice(11, 16) };
}

function empty() {
  return {
    lastRunDate: null,
    quota: { month: null, sent: 0 },
    lastErrorNotifiedAt: null,
    targets: {}
  };
}

function emptyTarget() {
  return { status: 'unknown', since: null, notifiedAt: null, notifyCount: 0, failStreak: 0 };
}

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

function render(events, tp) {
  var lines = [];
  var i;

  var arrived = events.filter(function (e) { return e.kind === 'in' || e.kind === 'still-in'; });
  var gone = events.filter(function (e) { return e.kind === 'out'; });
  var errors = events.filter(function (e) { return e.kind === 'error'; });

  if (arrived.length) {
    lines.push('🟢 到貨了！');
    for (i = 0; i < arrived.length; i++) {
      var a = arrived[i];
      lines.push(a.label + (a.price ? ' NT$' + a.price : '') +
                 (a.kind === 'still-in' ? '（仍有貨，第 ' + a.notifyCount + ' 次提醒）' : ''));
      if (a.url) { lines.push(a.url); }
    }
  }

  if (gone.length) {
    if (lines.length) { lines.push(''); }
    for (i = 0; i < gone.length; i++) {
      lines.push('🔴 ' + gone[i].label + ' 已售罄，這波開了 ' + gone[i].minutes + ' 分鐘');
    }
  }

  if (errors.length) {
    if (lines.length) { lines.push(''); }
    lines.push('⚠️ 抓取異常：' + errors.map(function (e) { return e.label; }).join('、') +
               ' 連續失敗，可能是頁面改版');
  }

  lines.push('');
  lines.push(tp.hhmm + ' 偵測');
  return lines.join('\n');
}

// prev: 舊狀態；targets: targets.json 的陣列；results: { [targetId]: { status, price } }
// now: Date。回傳 { state, message }（message 為 null 表示不推播）
function step(prev, targets, results, now) {
  var s = clone(prev);
  var tp = taipei(now);
  var nowIso = now.toISOString();
  var events = [];
  var anyFailAlert = false;
  var i;

  if (s.quota.month !== tp.month) {
    s.quota = { month: tp.month, sent: 0 };
  }
  s.lastRunDate = tp.date;

  for (i = 0; i < targets.length; i++) {
    var target = targets[i];
    var t = s.targets[target.id] || emptyTarget();
    var r = results[target.id] || { status: 'unknown' };

    if (r.status === 'unknown') {
      t.failStreak = t.failStreak + 1;
      if (t.failStreak >= FAIL_STREAK_ALERT) { anyFailAlert = true; }
      s.targets[target.id] = t;
      continue;
    }

    t.failStreak = 0;

    if (t.status !== r.status) {
      var was = t.status;
      t.status = r.status;
      t.since = nowIso;
      t.notifyCount = 0;

      if (r.status === 'in') {
        t.notifyCount = 1;
        t.notifiedAt = nowIso;
        events.push({ kind: 'in', label: target.label, price: r.price, url: target.url });
      } else if (was === 'in') {
        var mins = Math.round((now.getTime() - new Date(prev.targets[target.id].since).getTime()) / 60000);
        events.push({ kind: 'out', label: target.label, minutes: mins });
      }
      // unknown → out（第一次執行）不推播
    } else if (r.status === 'in') {
      var elapsed = now.getTime() - new Date(t.notifiedAt).getTime();
      if (elapsed >= IN_REMIND_INTERVAL_MS && t.notifyCount < IN_REMIND_MAX) {
        t.notifyCount = t.notifyCount + 1;
        t.notifiedAt = nowIso;
        events.push({ kind: 'still-in', label: target.label, price: r.price,
                      url: target.url, notifyCount: t.notifyCount });
      }
    }

    s.targets[target.id] = t;
  }

  if (anyFailAlert) {
    var lastErr = s.lastErrorNotifiedAt ? new Date(s.lastErrorNotifiedAt).getTime() : null;
    if (lastErr === null || now.getTime() - lastErr >= ERROR_COOLDOWN_MS) {
      s.lastErrorNotifiedAt = nowIso;
      var broken = targets.filter(function (target) {
        var t2 = s.targets[target.id];
        return t2 && t2.failStreak >= FAIL_STREAK_ALERT;
      }).map(function (target) { return { kind: 'error', label: target.label }; });
      events = events.concat(broken);
    }
  }

  // 額度吃緊時只保留最高優先的到貨推播。LINE 免費方案超額不是扣款而是發送失敗，
  // 靜默失效正是最糟的失敗模式，所以寧可主動關掉次要通知。
  if (s.quota.sent >= QUOTA_GUARD) {
    events = events.filter(function (e) { return e.kind === 'in'; });
  }

  if (!events.length) {
    return { state: s, message: null };
  }

  s.quota.sent = s.quota.sent + 1;
  return { state: s, message: render(events, tp) };
}

module.exports = { empty: empty, step: step, taipei: taipei };
```

- [ ] **Step 4: 跑測試確認通過**

```bash
cd /Users/raychang/dji-restock-watch && node tests/test-state.js
```

預期：`test-state: 18 passed, 0 failed`。

- [ ] **Step 5: 跑全部測試**

```bash
cd /Users/raychang/dji-restock-watch && sh tests/run-all.sh
```

預期四行全綠。

- [ ] **Step 6: Commit**

```bash
git add tests/test-state.js src/state.js
git commit -m "feat: 推播狀態機（節流、失敗警報、額度保護）"
```

---

## Task 11: LINE 推播

**Files:**
- Create: `src/notify.js`

不寫單元測試（純 I/O 殼層），驗證在 Task 13 用真的 token 端對端做。

- [ ] **Step 1: 寫 `src/notify.js`**

```js
'use strict';

var https = require('https');

function push(token, userId, text) {
  return new Promise(function (resolve, reject) {
    var body = JSON.stringify({
      to: userId,
      messages: [{ type: 'text', text: text }]
    });

    var req = https.request({
      hostname: 'api.line.me',
      path: '/v2/bot/message/push',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': 'Bearer ' + token
      }
    }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var out = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode === 200) {
          resolve(out);
        } else {
          // 403 幾乎都是「還沒用手機加這個官方帳號好友」
          reject(new Error('LINE push 失敗 ' + res.statusCode + ': ' + out));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { push: push };
```

- [ ] **Step 2: Commit**

```bash
git add src/notify.js
git commit -m "feat: LINE 推播"
```

---

## Task 12: 編排

**Files:**
- Create: `src/main.js`
- Create: `state.json`

- [ ] **Step 1: 寫初始 `state.json`**

```json
{
  "lastRunDate": null,
  "quota": { "month": null, "sent": 0 },
  "lastErrorNotifiedAt": null,
  "targets": {}
}
```

- [ ] **Step 2: 寫 `src/main.js`**

```js
'use strict';

var fs = require('fs');
var path = require('path');
var http = require('./http');
var state = require('./state');
var notify = require('./notify');

var ROOT = path.join(__dirname, '..');
var TARGETS_PATH = path.join(ROOT, 'targets.json');
var STATE_PATH = path.join(ROOT, 'state.json');
var COMMIT_MSG_PATH = path.join(ROOT, '.commit-msg.txt');

var dryRun = process.argv.indexOf('--dry-run') >= 0;

var PARSERS = {
  dji: require('./sources/dji'),
  pchome: require('./sources/pchome'),
  momo: require('./sources/momo')
};

function urlFor(t) {
  if (t.source === 'dji') {
    // 這個 cookie 不能省。DJI 會依請求來源 IP 的地理位置改寫轉址目的地：
    // GitHub Actions 的美國機房 IP 會被導去沒有 /tw/ 前綴的美國站，而 Osmo Pocket 4P
    // 因 FCC 認證從未在美上市，於是 404——2026-08-18 的 CI 連通性探針實際踩到過。
    // region 是 DJI 自己核發的 cookie（它另外用 ip_region 追蹤偵測到的位置，兩者分開），
    // 帶上它等同於明確指定台灣店，實測內容與台灣住宅 IP 逐位元組相同。
    // 詳見 scripts/probe-dji-variants.js 的調查結果。
    return { url: t.url, kind: 'desktop', headers: { 'Cookie': 'region=TW' } };
  }
  if (t.source === 'pchome') {
    return {
      url: 'https://ecapi.pchome.com.tw/ecshop/prodapi/v2/prod/button&id=' + t.prodId +
           '&fields=Id,Price,ButtonType,SaleStatus,Qty&_callback=x',
      kind: 'desktop'
    };
  }
  return { url: 'https://m.momoshop.com.tw/goods.momo?i_code=' + t.iCode, kind: 'mobile' };
}

var targets = JSON.parse(fs.readFileSync(TARGETS_PATH, 'utf8'));
var prev = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));

// 同一個 URL 只抓一次（DJI 一頁同時含黑白兩個 SKU）
var byUrl = {};
targets.forEach(function (t) {
  var u = urlFor(t);
  if (!byUrl[u.url]) { byUrl[u.url] = { kind: u.kind, headers: u.headers, targets: [] }; }
  byUrl[u.url].targets.push(t);
});

var results = {};

// 三個目標是三個不同網站，並行抓取不算失禮，而且能把最壞情況的總時長
// 從「三個目標相加」壓成「最慢的那一個」，避免逼近 10 分鐘的排程間隔。
Promise.all(Object.keys(byUrl).map(function (url) {
  var job = byUrl[url];
  return http.fetchText(url, job.kind, job.headers).then(function (res) {
    job.targets.forEach(function (t) {
      results[t.id] = PARSERS[t.source].parse(res.body, t);
    });
  }).catch(function (e) {
    job.targets.forEach(function (t) {
      results[t.id] = { status: 'unknown', reason: '抓取失敗: ' + e.message };
    });
  });
})).then(function () {
  targets.forEach(function (t) {
    var r = results[t.id];
    console.log(t.id + '  ' + r.status + (r.reason ? '  (' + r.reason + ')' : '') +
                (r.price ? '  NT$' + r.price : ''));
  });

  var out = state.step(prev, targets, results, new Date());

  if (dryRun) {
    console.log('--- dry-run，不推播不寫檔 ---');
    console.log(out.message === null ? '(本輪無推播)' : out.message);
    return null;
  }

  fs.writeFileSync(STATE_PATH, JSON.stringify(out.state, null, 2) + '\n');

  var changed = targets.filter(function (t) {
    var before = prev.targets[t.id];
    var after = out.state.targets[t.id];
    return (before ? before.status : 'unknown') !== after.status;
  }).map(function (t) {
    return t.id + ' ' + (prev.targets[t.id] ? prev.targets[t.id].status : 'unknown') +
           '→' + out.state.targets[t.id].status;
  });

  fs.writeFileSync(COMMIT_MSG_PATH,
    changed.length ? 'state: ' + changed.join(', ')
                   : 'state: 每日保活 ' + out.state.lastRunDate);

  if (out.message === null) {
    console.log('(本輪無推播)');
    return null;
  }

  console.log('推播內容：\n' + out.message);
  var token = process.env.LINE_CHANNEL_TOKEN;
  var userId = process.env.LINE_USER_ID;
  if (!token || !userId) {
    throw new Error('缺少 LINE_CHANNEL_TOKEN 或 LINE_USER_ID');
  }
  return notify.push(token, userId, out.message);
}).catch(function (e) {
  // 推播管道自己壞掉時，它無法通知你它壞了。
  // 讓 job 失敗，換到 GitHub 的排程失敗通知信，這是唯一的頻外告警管道。
  console.error(e.message);
  process.exit(1);
});
```

- [ ] **Step 3: 本機 dry-run**

```bash
cd /Users/raychang/dji-restock-watch && node src/main.js --dry-run
```

預期：四行目標狀態（`dji-black out`、`dji-white out`、`pchome-std out`、`momo-std out`），接著 `(本輪無推播)`。

若有任何一行是 `unknown`，先看括號裡的原因再往下走——這代表某個解析器對上真實回應時失效了，測試沒抓到。

- [ ] **Step 4: Commit**

```bash
git add src/main.js state.json
git commit -m "feat: 編排、dry-run 與 commit 訊息產生"
```

---

## Task 13: 排程 workflow

**Files:**
- Create: `.github/workflows/watch.yml`

- [ ] **Step 1: 寫 `.github/workflows/watch.yml`**

```yaml
name: watch

on:
  schedule:
    # 每 10 分鐘。GitHub 共用 runner 在尖峰時段會延遲 5–15 分鐘，屬正常現象。
    - cron: '*/10 * * * *'
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  # 延遲的排程可能與下一輪重疊，兩個 run 同時 push state.json 會 non-fast-forward 失敗。
  # cancel-in-progress 必須是 false：寧可排隊，不要砍掉正在推播的那一輪。
  group: watch
  cancel-in-progress: false

jobs:
  check:
    runs-on: ubuntu-latest
    # 第二道保險：程式內已有 15 秒的單次請求硬上限，這裡再擋一次整個 job 卡住的情況。
    # 注意這只止血不治本——job 被砍掉一樣不會寫 state、不會累加 failStreak，
    # 所以程式內的 deadline 才是主要防線。
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: 檢查庫存
        env:
          LINE_CHANNEL_TOKEN: ${{ secrets.LINE_CHANNEL_TOKEN }}
          LINE_USER_ID: ${{ secrets.LINE_USER_ID }}
        run: node src/main.js

      - name: 寫回狀態
        run: |
          if git diff --quiet -- state.json; then
            echo "狀態未變，不 commit"
          else
            git config user.name  "restock-bot"
            git config user.email "restock-bot@users.noreply.github.com"
            git add state.json
            git commit -F .commit-msg.txt
            git push
          fi
```

`state.json` 只在狀態轉變或跨台北日時才會變動，所以 `git diff --quiet` 這一關同時達成了「只在有事發生時 commit」與「每日至少一筆 commit 保活」——後者是必要的，因為 **GitHub 會在 repo 連續 60 天無活動後自動停用排程 workflow**，而今天到出發日是 64 天。

- [ ] **Step 2: 推上去**

```bash
cd /Users/raychang/dji-restock-watch
git add .github/workflows/watch.yml
git commit -m "feat: 每 10 分鐘排程與每日保活 commit"
git push
```

---

## Task 14: LINE 設定與端對端驗證

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 建立 LINE 官方帳號並取得兩個值**

依序做完，缺一不可：

1. 到 https://developers.line.biz/console/ 建立一個 Provider，再建一個 **Messaging API** channel
2. **Basic settings** 分頁滑到最下方，複製 **Your user ID**（`U` 開頭的長字串）→ 這是 `LINE_USER_ID`
3. **Messaging API** 分頁，`Channel access token (long-lived)` 按 Issue，複製 → 這是 `LINE_CHANNEL_TOKEN`
4. 同一頁有這個官方帳號的 QR code，**用手機掃描並加為好友**
5. 同一頁把 `Auto-reply messages` 關掉（不然每次你回訊息它都會自動回你）

第 4 步是最常見的卡關點：沒加好友時 push 會回 403，錯誤訊息不會告訴你原因。

- [ ] **Step 2: 設定 repo secrets**

```bash
cd /Users/raychang/dji-restock-watch
gh secret set LINE_CHANNEL_TOKEN
gh secret set LINE_USER_ID
```

- [ ] **Step 3: 端對端驗證推播真的送得到**

```bash
cd /Users/raychang/dji-restock-watch
LINE_CHANNEL_TOKEN=<貼上token> LINE_USER_ID=<貼上userId> \
  node -e "require('./src/notify').push(process.env.LINE_CHANNEL_TOKEN, process.env.LINE_USER_ID, '測試：到貨監控機器人已上線').then(function(){console.log('已送出');}).catch(function(e){console.error(e.message);process.exit(1);})"
```

預期：印出 `已送出`，且手機 LINE 收到訊息。若是 403，回頭做 Step 1 的第 4 步。

- [ ] **Step 4: 在 CI 實跑一次**

```bash
gh workflow run watch.yml
sleep 60 && gh run list --workflow=watch.yml --limit 1
gh run view --log | tail -30
```

預期：job 綠燈，log 印出四行目標狀態、`(本輪無推播)`，並 commit 一筆 `state: 每日保活 <日期>`。

- [ ] **Step 5: 把設定步驟寫進 README**

把 Step 1 的五個步驟原文補進 `README.md` 的「## 設定」段落，特別標明第 4 步的 403 陷阱。

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: LINE 官方帳號設定步驟"
git push
```

- [ ] **Step 7: 訂閱官方到貨通知作為第二道保險**

到 https://store.dji.com/tw/product/osmo-pocket-4p 點「到貨通知」留 email。10 分鐘輪詢擋不住秒殺，兩道保險互補。這一步是人工的，但屬於本專案的驗收條件之一。

---

## 完成後的驗收

- [ ] `sh tests/run-all.sh` 四支全綠
- [ ] `node src/main.js --dry-run` 印出四個目標的狀態，沒有 `unknown`
- [ ] CI 上的 watch workflow 綠燈跑過至少一次，並產生了一筆 state commit
- [ ] 手機 LINE 收得到測試訊息
- [ ] DJI 官方到貨通知 email 已訂閱
