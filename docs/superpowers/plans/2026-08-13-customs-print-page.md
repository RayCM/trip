# 入境用列印頁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 產出 `customs.html` —— 一張 A4 可列印的英日雙語摘要，只含進出境航班與每段住宿的名稱、地址、電話，供入境審查時出示。

**Architecture:** 獨立單頁，行程資料讀自 Firebase（與 `index.html` 同一份），住宿地址電話與航班寫死在頁面常數。純函式（分組、渲染）與 init 分離，測試沿用 `tests/test-render.js` 的「抽出 `<script>` 區塊在 Node 裡 eval」手法。

**Tech Stack:** 原生 HTML/CSS/JS、Firebase compat SDK（v10.12.5）、Node 內建 assert（無測試框架、無建置流程）

**設計文件：** `docs/superpowers/specs/2026-08-13-customs-print-page-design.md`

---

## File Structure

| 檔案 | 責任 |
|---|---|
| `customs.html`（新增） | 版面、`STAY_INFO` / `FLIGHTS` 常數、分組與渲染函式、Firebase 載入 |
| `tests/test-customs.js`（新增） | 分組、渲染、fallback、錯誤處理的驗證 |
| `tests/run-all.sh`（修改） | 把 `test-customs` 加進測試清單 |

`index.html`、`config.js`、`sw.js` 都不動。`sw.js` 是 network-first 且自動快取同源 GET，新頁面會被自動快取，不需修改。

---

### Task 1: 查證住宿地址與電話（資料取得，人工核對關卡）

**這一步不寫程式碼。** 產出是一份給使用者核對的清單，核對通過後才進 Task 2。

**Files:** 無（產出是對話中的清單）

- [ ] **Step 1: 從行程資料取出五個 Google Maps 短連結**

```bash
TOKEN=$(curl -s -X POST -H "Content-Type: application/json" -d '{"returnSecureToken":true}' \
  "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=$(grep -o 'apiKey: "[^"]*"' config.js | cut -d'"' -f2)" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['idToken'])")
curl -s "$(grep -o 'databaseURL: "[^"]*"' config.js | cut -d'"' -f2)/trips/$(grep -o 'tripId: "[^"]*"' config.js | cut -d'"' -f2)/itinerary.json?auth=$TOKEN" \
  | python3 -c "
import sys,json
seen={}
for d in json.load(sys.stdin):
    if d.get('stayUrl') and d['stay'] not in seen: seen[d['stay']]=d['stayUrl']
for k,v in seen.items(): print(k,v)
"
```

預期輸出五行：飯店名稱 + `https://maps.app.goo.gl/...`

- [ ] **Step 2: 逐一解析短連結取得店名與座標**

對每個短連結用 WebFetch。短連結會 302 到 `https://www.google.com/maps/place/<店名>/@<lat>,<lng>,17z/...`，從 redirect URL 本身就能讀出店名與座標，不需要真的抓 Google Maps 頁面（那是 JS 渲染，抓不到內容）。

- [ ] **Step 3: 查該飯店官網取得正式地址與電話**

用 WebSearch 或 WebFetch 找官網的アクセス／店舗情報頁。用 Step 2 的座標交叉驗證是同一間（東橫INN、Tabino 這類連鎖同市有多家分店）。

- [ ] **Step 4: 列表給使用者核對**

以表格呈現五筆：飯店名（現行中文名）、英文名、日文名、〒郵遞區號＋日文地址、電話、來源網址。英日文名可直接用下表（2026-08-05 移除多語系時刪掉的 `STAY`，已從 git 歷史取回）：

| 現行名稱 | en | ja |
|---|---|---|
| 名古屋花園皇宮飯店 | Nagoya Garden Palace Hotel | 名古屋ガーデンパレス |
| 富山地鐵飯店 | Toyama Chitetsu Hotel | 富山地鉄ホテル |
| 東橫INN 松本站東口 | Toyoko Inn Matsumoto Sta. East | 東横INN松本駅東口 |
| Tabino Hotel Satellite | Tabino Hotel Satellite (Takayama) | Tabino Hotel Satellite（高山） |
| 東橫INN 名古屋丸之內 | Toyoko Inn Nagoya Marunouchi | 東横INN名古屋丸の内 |

**停下來等使用者確認。** 地址錯了比沒有更糟 —— 對方會照著這張紙判斷你住在哪裡。使用者確認後才進 Task 2。

---

### Task 2: 建立 `customs.html` 骨架與常數

**Files:**
- Create: `customs.html`
- Create: `tests/test-customs.js`

- [ ] **Step 1: 寫失敗的測試**

建立 `tests/test-customs.js`：

```js
// 沿用 test-render.js 的手法：抽出 customs.html 的 inline <script> 在 Node 裡 eval，
// 測到的是真正會跑的程式碼，不需要建置流程或測試框架。
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = path.join(__dirname, '..', 'customs.html');
const src = fs.readFileSync(SRC, 'utf8');

// 帶 src 屬性的 <script src="..."> 不會被這個 regex 匹配到，抓到的是 inline 那段
const blocks = [];
const re = /<script>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(src))) blocks.push(m[1]);
if (!blocks.length) { console.error('FAIL: 找不到 <script> 區塊'); process.exit(1); }
const app = blocks[0];

// ---- DOM stub ----
const els = {};
const mkEl = id => ({
  id, textContent: '', innerHTML: '', style: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  addEventListener() {},
});
global.document = {
  documentElement: mkEl('html'),
  getElementById: id => els[id] || (els[id] = mkEl(id)),
  addEventListener() {},
};
global.window = { TRIP_CONFIG: undefined, addEventListener() {} };
global.navigator = {};

// FB_READY 會是 false（沒有 window.TRIP_CONFIG、沒有 firebase），走「連不上」分支
let ranWithoutThrow = true, thrown = null, R = null;
try {
  R = eval(app + '\n;({groupStays,renderStays,renderFlights,STAY_INFO,FLIGHTS,t,esc})');
} catch (e) {
  ranWithoutThrow = false;
  thrown = e;
}

let passed = 0, total = 0;
const check = (name, fn) => {
  total++;
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; }
};

check('整段 script 載入並執行不拋錯', () => {
  assert.ok(ranWithoutThrow, '拋錯: ' + (thrown && thrown.stack));
});

check('五間住宿都有地址與電話，溫暖的家標記為 skip', () => {
  ['名古屋花園皇宮飯店', '富山地鐵飯店', '東橫INN 松本站東口',
   'Tabino Hotel Satellite', '東橫INN 名古屋丸之內'].forEach(n => {
    const i = R.STAY_INFO[n];
    assert.ok(i, '缺少 ' + n);
    assert.ok(i.en && i.ja, n + ' 缺英文或日文名');
    assert.ok(i.addr && i.addr.length > 5, n + ' 缺地址');
    assert.ok(i.tel && /\d/.test(i.tel), n + ' 缺電話');
    // 骨架階段的佔位值（〒000-0000 / 052-000-0000）必須被換掉，
    // 否則假地址會一路留到印出來的那張紙上，而測試還是綠的
    assert.ok(!/000-0000/.test(i.addr), n + ' 的地址還是佔位值');
    assert.ok(!/000-0000/.test(i.tel), n + ' 的電話還是佔位值');
    assert.ok(/〒\d{3}-\d{4}/.test(i.addr), n + ' 的地址缺郵遞區號');
  });
  assert.strictEqual(R.STAY_INFO['溫暖的家'].skip, true);
});

check('航班有進出境兩筆', () => {
  assert.strictEqual(R.FLIGHTS.length, 2);
  assert.strictEqual(R.FLIGHTS[0].no, 'CX530');
  assert.strictEqual(R.FLIGHTS[1].no, 'CX531');
});

console.log(`\n${passed}/${total} passed`);
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `node tests/test-customs.js`
Expected: FAIL —— `ENOENT: no such file or directory, open '.../customs.html'`

- [ ] **Step 3: 建立 `customs.html`**

**下方 `STAY_INFO` 裡的 `〒000-0000` 與 `052-000-0000` 是格式示意，不是要照抄的值。** 建檔時必須換成 Task 1 經使用者核對過的真實地址與電話 —— Step 1 的測試會擋下佔位值，這是刻意的，不要為了讓測試變綠而放寬那幾條斷言。

```html
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Itinerary / 旅程表</title>
<style>
:root{--ink:#241f19;--ink-soft:#5e564c;--line:#c9c2b6;--paper:#fff;}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:#e8e4dc;color:var(--ink);font-family:"Hiragino Sans","Noto Sans JP","Helvetica Neue",Arial,sans-serif;line-height:1.6;padding:24px 12px;}
.sheet{background:var(--paper);max-width:190mm;margin:0 auto;padding:16mm 14mm;box-shadow:0 2px 12px rgba(0,0,0,.12);}
h1{font-size:20px;letter-spacing:.04em;}
.period{color:var(--ink-soft);font-size:13px;margin-top:4px;}
h2{font-size:12px;letter-spacing:.12em;color:var(--ink-soft);border-bottom:1px solid var(--line);padding-bottom:4px;margin:22px 0 10px;}
.flight{display:flex;gap:10px;font-size:13px;padding:3px 0;}
.flight .kind{min-width:150px;font-weight:700;}
.stay{padding:9px 0;border-bottom:1px dotted var(--line);}
.stay:last-child{border-bottom:none;}
.when{font-size:13px;font-weight:700;}
.when .nights{font-weight:400;color:var(--ink-soft);}
.name{font-size:14px;margin-top:2px;}
.addr,.tel{font-size:13px;color:var(--ink-soft);}
#status{max-width:190mm;margin:12px auto;padding:10px 14px;background:#fdecea;color:#8a2418;border:1px solid #e8b4ad;font-size:13px;display:none;}
#print{display:block;margin:16px auto;padding:9px 22px;font-size:14px;cursor:pointer;}
@media print{
  body{background:#fff;padding:0;}
  .sheet{box-shadow:none;max-width:none;padding:0;}
  #print,#status{display:none !important;}
  @page{size:A4 portrait;margin:14mm;}
}
</style>
</head>
<body>
<div class="sheet">
 <h1>ITINERARY ／ 旅程表</h1>
 <div class="period" id="period"></div>
 <h2>FLIGHT ／ 航空便</h2>
 <div id="flights"></div>
 <h2>ACCOMMODATION ／ 宿泊先</h2>
 <div id="stays"></div>
</div>
<div id="status"></div>
<button id="print" onclick="window.print()">列印 ／ 印刷</button>

<script src="config.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.5/firebase-database-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.5/firebase-auth-compat.js"></script>
<script>
/* 設定與 index.html 共用同一份 config.js */
const CFG=(typeof window!=='undefined'&&window.TRIP_CONFIG)||{};
const FIREBASE_CONFIG=CFG.firebase||{};
const TRIP_ID=CFG.tripId||'PASTE_YOUR_TRIP_ID';
const FB_READY=(typeof firebase!=='undefined')&&FIREBASE_CONFIG.databaseURL&&FIREBASE_CONFIG.databaseURL.indexOf('PASTE')===-1;

/* Firebase 上的舊資料仍可能是 {zh,en,ja} 物件，與 index.html 的 t() 同義 */
const t=o=>o==null?'':(typeof o==='string'?o:(o.zh||''));
function esc(s){return (s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}

const FLIGHTS=[
 {kind:'ARRIVAL ／ 到着',no:'CX530',date:'10/21',time:'15:30',airport:'NGO Chubu Centrair'},
 {kind:'DEPARTURE ／ 出発',no:'CX531',date:'11/04',time:'16:40',airport:'NGO Chubu Centrair'}
];

/* key 是行程資料裡的住宿名稱（Firebase 上的 stay 欄）。
   skip:true 代表不是在日住宿，不列入宿泊先——與「查無此筆」是兩條不同的路徑，
   查無此筆要顯示未登録提醒使用者補，不能被靜默跳過。 */
const STAY_INFO={
 '名古屋花園皇宮飯店':{en:'Nagoya Garden Palace Hotel',ja:'名古屋ガーデンパレス',addr:'〒000-0000 愛知県名古屋市…',tel:'052-000-0000'},
 '富山地鐵飯店':{en:'Toyama Chitetsu Hotel',ja:'富山地鉄ホテル',addr:'〒000-0000 富山県富山市…',tel:'076-000-0000'},
 '東橫INN 松本站東口':{en:'Toyoko Inn Matsumoto Sta. East',ja:'東横INN松本駅東口',addr:'〒000-0000 長野県松本市…',tel:'0263-00-0000'},
 'Tabino Hotel Satellite':{en:'Tabino Hotel Satellite (Takayama)',ja:'Tabino Hotel Satellite（高山）',addr:'〒000-0000 岐阜県高山市…',tel:'0577-00-0000'},
 '東橫INN 名古屋丸之內':{en:'Toyoko Inn Nagoya Marunouchi',ja:'東横INN名古屋丸の内',addr:'〒000-0000 愛知県名古屋市…',tel:'052-000-0000'},
 '溫暖的家':{skip:true}
};

function groupStays(list){return [];}
function renderStays(groups){return '';}
function renderFlights(){return '';}
</script>
</body>
</html>
```

- [ ] **Step 4: 執行測試，確認通過**

Run: `node tests/test-customs.js`
Expected: `3/3 passed`

若看到「的地址還是佔位值」，代表 Step 3 沒有把示意值換成 Task 1 的真實資料，回頭補上。

- [ ] **Step 5: Commit**

```bash
git add customs.html tests/test-customs.js
git commit -m "feat: 入境用列印頁的骨架與住宿資料"
```

---

### Task 3: 住宿分組

**Files:**
- Modify: `customs.html`（`groupStays`）
- Modify: `tests/test-customs.js`

- [ ] **Step 1: 寫失敗的測試**

加在 `tests/test-customs.js` 的 `console.log` 之前：

```js
// 15 天的真實行程形狀（只留分組需要的欄位）
const DAYS = [
  { date: '10/21', stay: '名古屋花園皇宮飯店' }, { date: '10/22', stay: '名古屋花園皇宮飯店' },
  { date: '10/23', stay: '富山地鐵飯店' }, { date: '10/24', stay: '富山地鐵飯店' },
  { date: '10/25', stay: '東橫INN 松本站東口' }, { date: '10/26', stay: '東橫INN 松本站東口' },
  { date: '10/27', stay: '東橫INN 松本站東口' }, { date: '10/28', stay: '東橫INN 松本站東口' },
  { date: '10/29', stay: 'Tabino Hotel Satellite' }, { date: '10/30', stay: 'Tabino Hotel Satellite' },
  { date: '10/31', stay: 'Tabino Hotel Satellite' },
  { date: '11/01', stay: '東橫INN 名古屋丸之內' }, { date: '11/02', stay: '東橫INN 名古屋丸之內' },
  { date: '11/03', stay: '東橫INN 名古屋丸之內' },
  { date: '11/04', stay: '溫暖的家' },
];

check('連續住同一間併成一段，晚數正確', () => {
  const g = R.groupStays(DAYS);
  assert.strictEqual(g.length, 5, '應該是 5 段（溫暖的家不算），實際 ' + g.length);
  assert.deepStrictEqual(g.map(x => x.nights), [2, 2, 4, 3, 3]);
  assert.strictEqual(g[0].from, '10/21');
  assert.strictEqual(g[0].to, '10/22');
  assert.strictEqual(g[2].from, '10/25');
  assert.strictEqual(g[2].to, '10/28');
});

check('11/04 溫暖的家不列入宿泊先', () => {
  const g = R.groupStays(DAYS);
  assert.ok(!g.some(x => x.name === '溫暖的家'), '溫暖的家不該出現');
});

check('同一間飯店分成不相鄰的兩段時不會被併起來', () => {
  const g = R.groupStays([
    { date: '10/21', stay: 'A' }, { date: '10/22', stay: 'B' }, { date: '10/23', stay: 'A' },
  ]);
  assert.strictEqual(g.length, 3);
  assert.deepStrictEqual(g.map(x => x.nights), [1, 1, 1]);
});

check('住宿名稱是舊的 {zh,url} 物件時也能分組', () => {
  const g = R.groupStays([
    { date: '10/21', stay: { zh: '富山地鐵飯店', url: 'https://maps.example/x' } },
    { date: '10/22', stay: '富山地鐵飯店' },
  ]);
  assert.strictEqual(g.length, 1, '物件與字串是同一間，應該併成一段');
  assert.strictEqual(g[0].nights, 2);
});

check('住宿欄空白的日子被略過，不產生無名分段', () => {
  const g = R.groupStays([
    { date: '10/21', stay: '富山地鐵飯店' }, { date: '10/22', stay: '' }, { date: '10/23' },
  ]);
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].nights, 1);
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `node tests/test-customs.js`
Expected: FAIL —— `應該是 5 段（溫暖的家不算），實際 0`

- [ ] **Step 3: 實作 `groupStays`**

把 `customs.html` 裡的 `function groupStays(list){return [];}` 換成：

```js
/* 連續住同一間的日子併成一段。晚數＝該段的天數（最後一天仍住在那裡）。
   標了 skip 的（回程日的「溫暖的家」）不列入宿泊先；查無此筆的仍要列出，交給 renderStays 標未登録。 */
function groupStays(list){
 const groups=[];
 (list||[]).forEach(d=>{
  const name=t(d&&d.stay);
  if(!name)return; // 住宿欄空白的日子跳過，不產生無名分段
  const last=groups[groups.length-1];
  if(last&&last.name===name){last.to=d.date;last.nights++;}
  else groups.push({name:name,from:d.date,to:d.date,nights:1});
 });
 return groups.filter(g=>{const i=STAY_INFO[g.name];return !(i&&i.skip);});
}
```

- [ ] **Step 4: 執行測試，確認通過**

Run: `node tests/test-customs.js`
Expected: `8/8 passed`

- [ ] **Step 5: Commit**

```bash
git add customs.html tests/test-customs.js
git commit -m "feat: 住宿依連續入住分段"
```

---

### Task 4: 渲染住宿區塊

**Files:**
- Modify: `customs.html`（`renderStays`）
- Modify: `tests/test-customs.js`

- [ ] **Step 1: 寫失敗的測試**

```js
check('住宿列印出英日名、地址與電話', () => {
  const h = R.renderStays(R.groupStays(DAYS));
  assert.ok(h.includes('Nagoya Garden Palace Hotel'), '缺英文名');
  assert.ok(h.includes('名古屋ガーデンパレス'), '缺日文名');
  assert.ok(h.includes(R.STAY_INFO['名古屋花園皇宮飯店'].addr), '缺地址');
  assert.ok(h.includes(R.STAY_INFO['名古屋花園皇宮飯店'].tel), '缺電話');
});

check('日期區間與晚數都印出來', () => {
  const h = R.renderStays(R.groupStays(DAYS));
  assert.ok(h.includes('10/25 – 10/28'), '缺日期區間');
  assert.ok(h.includes('4 nights'), '缺晚數');
  assert.ok(h.includes('4泊'), '缺日文晚數');
});

check('只住一晚時用單數 night 且不印區間', () => {
  const h = R.renderStays(R.groupStays([{ date: '10/21', stay: '富山地鐵飯店' }]));
  assert.ok(h.includes('1 night ／ 1泊'), '單數形式不對: ' + h);
  assert.ok(!h.includes('–'), '單日不該印日期區間');
});

check('飯店沒登記在 STAY_INFO 時仍列出該段並標未登録', () => {
  const h = R.renderStays(R.groupStays([
    { date: '10/21', stay: '某某新飯店' }, { date: '10/22', stay: '某某新飯店' },
  ]));
  assert.ok(h.includes('某某新飯店'), '飯店名不該消失');
  assert.ok(h.includes('未登録'), '應該標示未登録');
  assert.ok(h.includes('2 nights'), '晚數仍要算');
});

check('飯店名有 HTML 特殊字元時被跳脫', () => {
  const h = R.renderStays(R.groupStays([{ date: '10/21', stay: '<script>x</script>' }]));
  assert.ok(!h.includes('<script>x'), '沒有跳脫: ' + h);
  assert.ok(h.includes('&lt;script&gt;'), '應該跳脫成實體');
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `node tests/test-customs.js`
Expected: FAIL —— `缺英文名`

- [ ] **Step 3: 實作 `renderStays`**

```js
/* 查無登記的住宿仍要列出來，地址電話標未登録——少印一段比印出一張看似完整、
   實際漏掉好幾晚的紙難被發現。 */
function renderStays(groups){
 const NOT_REG='未登録 ／ not registered';
 return (groups||[]).map(g=>{
  const i=STAY_INFO[g.name]||null;
  const name=i&&i.en?(i.en+' ／ '+i.ja):g.name;
  const addr=i&&i.addr?i.addr:NOT_REG;
  const tel=i&&i.tel?('TEL '+i.tel):NOT_REG;
  const when=g.from===g.to?g.from:(g.from+' – '+g.to);
  const nights=g.nights+(g.nights===1?' night':' nights')+' ／ '+g.nights+'泊';
  return '<div class="stay">'+
   '<div class="when">'+esc(when)+'　<span class="nights">'+esc(nights)+'</span></div>'+
   '<div class="name">'+esc(name)+'</div>'+
   '<div class="addr">'+esc(addr)+'</div>'+
   '<div class="tel">'+esc(tel)+'</div>'+
   '</div>';
 }).join('');
}
```

- [ ] **Step 4: 執行測試，確認通過**

Run: `node tests/test-customs.js`
Expected: `13/13 passed`

- [ ] **Step 5: Commit**

```bash
git add customs.html tests/test-customs.js
git commit -m "feat: 渲染宿泊先區塊"
```

---

### Task 5: 渲染航班區塊

**Files:**
- Modify: `customs.html`（`renderFlights`）
- Modify: `tests/test-customs.js`

- [ ] **Step 1: 寫失敗的測試**

```js
check('航班兩行都印出班次、日期、時間、機場', () => {
  const h = R.renderFlights();
  assert.ok(h.includes('CX530') && h.includes('CX531'), '缺班次');
  assert.ok(h.includes('10/21') && h.includes('11/04'), '缺日期');
  assert.ok(h.includes('15:30') && h.includes('16:40'), '缺時間');
  assert.ok(h.includes('NGO'), '缺機場');
  assert.ok(h.includes('ARRIVAL') && h.includes('到着'), '缺雙語標籤');
});
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `node tests/test-customs.js`
Expected: FAIL —— `缺班次`

- [ ] **Step 3: 實作 `renderFlights`**

```js
function renderFlights(){
 return FLIGHTS.map(f=>
  '<div class="flight"><span class="kind">'+esc(f.kind)+'</span>'+
  '<span>'+esc(f.no)+'</span><span>'+esc(f.date)+'</span>'+
  '<span>'+esc(f.time)+'</span><span>'+esc(f.airport)+'</span></div>'
 ).join('');
}
```

- [ ] **Step 4: 執行測試，確認通過**

Run: `node tests/test-customs.js`
Expected: `14/14 passed`

- [ ] **Step 5: Commit**

```bash
git add customs.html tests/test-customs.js
git commit -m "feat: 渲染航空便區塊"
```

---

### Task 6: Firebase 載入與錯誤處理

**Files:**
- Modify: `customs.html`（新增 `renderAll`、`showError`、init IIFE）
- Modify: `tests/test-customs.js`

- [ ] **Step 1: 寫失敗的測試**

```js
check('沒有 Firebase 設定時顯示錯誤，且不產生任何住宿列', () => {
  // eval 當下 FB_READY 就是 false，init 已經跑過
  assert.ok(els['status'], '沒有 status 元素');
  assert.ok(/連不上|設定/.test(els['status'].innerHTML), '錯誤訊息不明確: ' + els['status'].innerHTML);
  assert.strictEqual((els['stays'] && els['stays'].innerHTML) || '', '', '不該印出住宿列');
});

check('renderAll 收到空陣列時顯示錯誤且不印表格', () => {
  R.renderAll([]);
  assert.strictEqual(els['stays'].innerHTML, '', '空資料不該印出住宿列');
  assert.ok(els['status'].innerHTML.length > 0, '空資料應該有錯誤訊息');
});

check('renderAll 收到正常資料時印出住宿與期間', () => {
  R.renderAll(DAYS);
  assert.ok(els['stays'].innerHTML.includes('Nagoya Garden Palace Hotel'), '沒印出住宿');
  assert.ok(els['period'].textContent.includes('10/21'), '期間缺開始日');
  assert.ok(els['period'].textContent.includes('11/04'), '期間缺結束日');
  assert.ok(/15\s*days/.test(els['period'].textContent), '期間缺天數: ' + els['period'].textContent);
});
```

同時把 Task 2 的尾端運算式改成（加入 `renderAll`）：

```js
  R = eval(app + '\n;({groupStays,renderStays,renderFlights,renderAll,STAY_INFO,FLIGHTS,t,esc})');
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `node tests/test-customs.js`
Expected: FAIL —— `沒有 status 元素`（init 還沒寫）

- [ ] **Step 3: 實作 `renderAll` 與 init**

接在 `renderFlights` 之後：

```js
function showError(msg){
 const el=document.getElementById('status');
 el.innerHTML=msg;
 el.style.display='block';
}

/* 資料不完整時寧可整張不印，也不要印出一張缺了幾晚、看起來卻很完整的紙。 */
function renderAll(list){
 document.getElementById('flights').innerHTML=renderFlights();
 if(!Array.isArray(list)||!list.length){
  document.getElementById('stays').innerHTML='';
  document.getElementById('period').textContent='';
  showError('<b>讀不到行程資料</b>　請確認網路連線與 config.js 設定，先不要列印這張表。');
  return;
 }
 const from=list[0].date,to=list[list.length-1].date;
 document.getElementById('period').textContent=
  '2026/'+from+' – '+to+'　·　'+list.length+' days ／ '+list.length+'日間';
 document.getElementById('stays').innerHTML=renderStays(groupStays(list));
}

(function init(){
 if(!FB_READY){
  renderAll([]);
  showError('<b>連不上資料庫</b>　config.js 未設定或 Firebase SDK 沒載入，這張表沒有資料，請勿列印。');
  return;
 }
 firebase.initializeApp(FIREBASE_CONFIG);
 const dbRef=firebase.database().ref('trips/'+TRIP_ID+'/itinerary');
 firebase.auth().onAuthStateChanged(function(user){
  if(!user)return;
  dbRef.once('value').then(function(snap){
   renderAll(snap.val());
  }).catch(function(err){
   renderAll([]);
   showError('<b>讀取資料庫失敗</b>　'+esc(err&&err.message||'')+'　請勿列印這張表。');
  });
 });
 firebase.auth().signInAnonymously().catch(function(e){
  renderAll([]);
  showError('<b>匿名登入失敗</b>　'+esc(e&&e.message||'')+'　請勿列印這張表。');
 });
})();
```

- [ ] **Step 4: 執行測試，確認通過**

Run: `node tests/test-customs.js`
Expected: `17/17 passed`

- [ ] **Step 5: Commit**

```bash
git add customs.html tests/test-customs.js
git commit -m "feat: 從 Firebase 載入行程並處理讀取失敗"
```

---

### Task 7: 納入測試套件

**Files:**
- Modify: `tests/run-all.sh:11`

- [ ] **Step 1: 把 test-customs 加進清單**

把這一行：

```sh
for f in test-resequence test-moveday test-datevalidate test-dayform test-legacy test-render test-sheet-import test-sheet-e2e; do
```

改成：

```sh
for f in test-resequence test-moveday test-datevalidate test-dayform test-legacy test-render test-sheet-import test-sheet-e2e test-customs; do
```

- [ ] **Step 2: 執行全套測試**

Run: `sh tests/run-all.sh`
Expected: 每一行都 passed，最後一行 `全部通過`。特別確認 `i18n-snapshot` 仍是 `SNAPSHOT OK` —— 這次沒有動 `index.html`，快照不該有變化。

- [ ] **Step 3: Commit**

```bash
git add tests/run-all.sh
git commit -m "test: 把入境列印頁納入測試套件"
```

---

### Task 8: 實際列印驗收

**Files:** 無（人工驗收）

- [ ] **Step 1: 在瀏覽器開啟**

部署後開 `https://<pages-domain>/customs.html`，或本機起 `python3 -m http.server` 後開 `http://localhost:8000/customs.html`（本機開啟時 `config.js` 存在才連得上 Firebase）。

- [ ] **Step 2: 檢查畫面**

確認五段住宿都在、晚數是 2/2/4/3/3、沒有「溫暖的家」、地址電話正確、航班兩行正確。

- [ ] **Step 3: 檢查列印預覽**

按「列印 ／ 印刷」，在預覽中確認：內容在一頁內、背景色與陰影消失、列印按鈕與錯誤區塊沒被印出來。

- [ ] **Step 4: 若溢出第二頁**

調整 `.sheet` 的 `padding`（16mm→12mm）或 `.stay` 的 `padding`（9px→7px），重新預覽。不要為了塞進一頁把字級縮到 12px 以下 —— 這張紙的用途是給人看。

---

## 完成後

跑 `sh tests/run-all.sh` 全綠、列印預覽確認一頁裝得下，即可 push。`index.html` 全程不動，行程頁行為不變。
