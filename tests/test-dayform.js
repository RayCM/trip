// 用最小 DOM stub 跑真正的 openDayForm / saveDayForm，驗證日期欄位唯讀與格式驗證。
// 所有受測函式都從 index.html 原始碼抽出來 eval，不是副本。
const fs = require('fs');
const assert = require('assert');

const path = require('path');
const SRC = path.join(__dirname, '..', 'index.html');
const src = fs.readFileSync(SRC, 'utf8');

const grab = (re, label) => {
  const m = src.match(re);
  if (!m) { console.error('FAIL: 找不到 ' + label); process.exit(1); }
  return m[0];
};

// 資料區塊（UI / REGION_OPTS 等，openDayForm 會用到）
const dataStart = src.indexOf('const WD=');
const dataEnd = src.indexOf('const SEED_TOTAL=');
if (dataStart < 0 || dataEnd < 0) { console.error('FAIL: 找不到資料區塊'); process.exit(1); }
const dataBlock = src.slice(dataStart, dataEnd);

// ---- DOM stub ----
const els = {};
const mkEl = id => ({
  id, value: '', readOnly: false, checked: false,
  textContent: '', innerHTML: '',
  style: {}, classList: { add() {}, remove() {}, toggle() {} },
});
let document = { getElementById: id => els[id] || (els[id] = mkEl(id)) };

// ---- 受測程式碼會用到的全域 ----
let LANG = 'zh';
let editingIndex = null;
let itinerary = [];
const alerts = [];
let alert = m => { alerts.push(m); };
let pushed = [];
let pushField = (f, v) => { pushed.push(JSON.parse(JSON.stringify(v))); };
let closedCount = 0;
let closeDayForm = () => { closedCount++; };
let renderTimeline = () => {};

const tDef = "const t=o=>o==null?'':(typeof o==='string'?o:(o[LANG]||o.zh||''));";
const bundle = [
  dataBlock,
  tDef,
  grab(/function parseMD\(str\)\{[\s\S]*?\n\}\nfunction wdFromDate\(str\)\{[\s\S]*?\n\}/, 'wdFromDate()'),
  grab(/function resequenceDates\(\)\{[\s\S]*?\n\}/, 'resequenceDates()'),
  grab(/function isValidAnchorDate\(s\)\{[\s\S]*?\n\}/, 'isValidAnchorDate()'),
  grab(/function openDayForm\(i\)\{[\s\S]*?\n\}/, 'openDayForm()'),
  grab(/async function saveDayForm\(\)\{[\s\S]*?\n\}/, 'saveDayForm()'),
  ';({openDayForm,saveDayForm})',
].join('\n');

// 不能用 openDayForm / saveDayForm 當外層變數名：direct eval 會把函式宣告提升到這個作用域，撞名
const FN = eval(bundle);
const openForm = FN.openDayForm, saveForm = FN.saveDayForm;

// ---- 測試工具 ----
const dateEl = () => document.getElementById('m-date');
const hintEl = () => document.getElementById('m-date-hint');
const mkTrip = () => [
  { date: '10/21', dest: 'A' }, { date: '10/22', dest: 'B' }, { date: '10/23', dest: 'C' },
];
const reset = () => { alerts.length = 0; pushed = []; closedCount = 0; };

let passed = 0, total = 0;
const check = async (name, fn) => {
  total++;
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; }
};

(async () => {
  await check('編輯第 1 天：日期可輸入，提示隱藏', () => {
    itinerary = mkTrip(); reset();
    openForm(0);
    assert.strictEqual(dateEl().readOnly, false, 'readOnly 應為 false');
    assert.strictEqual(dateEl().value, '10/21');
    assert.strictEqual(hintEl().style.display, 'none', '提示應隱藏');
  });

  await check('編輯第 2 天：日期唯讀，提示顯示', () => {
    itinerary = mkTrip(); reset();
    openForm(1);
    assert.strictEqual(dateEl().readOnly, true, 'readOnly 應為 true');
    assert.strictEqual(dateEl().value, '10/22');
    assert.strictEqual(hintEl().style.display, 'block', '提示應顯示');
  });

  await check('新增一天（行程非空）：日期唯讀且留空', () => {
    itinerary = mkTrip(); reset();
    openForm();
    assert.strictEqual(dateEl().readOnly, true);
    assert.strictEqual(dateEl().value, '');
    assert.strictEqual(hintEl().style.display, 'block');
  });

  await check('行程為空時新增第一天：日期可輸入（要能設錨點）', () => {
    itinerary = []; reset();
    openForm();
    assert.strictEqual(dateEl().readOnly, false, 'readOnly 應為 false');
    assert.strictEqual(hintEl().style.display, 'none');
  });

  await check('唯讀狀態會被重設：先開第 2 天再開第 1 天，仍可輸入', () => {
    itinerary = mkTrip(); reset();
    openForm(1);
    assert.strictEqual(dateEl().readOnly, true);
    openForm(0);
    assert.strictEqual(dateEl().readOnly, false, '第二次開啟沒有重設 readOnly');
    assert.strictEqual(hintEl().style.display, 'none');
  });

  await check('第 1 天改日期：整趟平移，寫回資料庫', async () => {
    itinerary = mkTrip(); reset();
    openForm(0);
    dateEl().value = '10/22';
    await saveForm();
    assert.deepStrictEqual(alerts, [], '不應跳出警告');
    assert.deepStrictEqual(itinerary.map(d => d.date), ['10/22', '10/23', '10/24']);
    assert.strictEqual(pushed.length, 1, '應寫回一次');
    assert.strictEqual(closedCount, 1, '應關閉視窗');
  });

  await check('第 1 天填非法日期：跳警告、不寫回、不關視窗', async () => {
    itinerary = mkTrip(); reset();
    openForm(0);
    dateEl().value = '2026-10-21';
    await saveForm();
    assert.strictEqual(alerts.length, 1, '應跳出一次警告');
    assert.ok(/MM\/DD/.test(alerts[0]), '警告訊息應說明正確格式，實際為: ' + alerts[0]);
    assert.deepStrictEqual(itinerary.map(d => d.date), ['10/21', '10/22', '10/23'], '資料不該被改動');
    assert.strictEqual(pushed.length, 0, '不該寫回資料庫');
    assert.strictEqual(closedCount, 0, '視窗應保持開啟，不遺失已填內容');
  });

  await check('第 1 天清空日期：被擋下，不會讓日期接續靜默失效', async () => {
    itinerary = mkTrip(); reset();
    openForm(0);
    dateEl().value = '';
    document.getElementById('m-dest').value = '名古屋';
    await saveForm();
    assert.strictEqual(alerts.length, 1, '空日期必須被擋下');
    assert.strictEqual(pushed.length, 0, '不該寫回資料庫');
    assert.deepStrictEqual(itinerary.map(d => d.date), ['10/21', '10/22', '10/23']);
  });

  await check('第 1 天用全形斜線：接受並正規化成半形', async () => {
    itinerary = mkTrip(); reset();
    openForm(0);
    dateEl().value = '10／25';
    await saveForm();
    assert.deepStrictEqual(alerts, [], '全形斜線不該被擋');
    assert.deepStrictEqual(itinerary.map(d => d.date), ['10/25', '10/26', '10/27']);
  });

  await check('編輯中間某天：日期唯讀，儲存後日期不受影響', async () => {
    itinerary = mkTrip(); reset();
    openForm(1);
    document.getElementById('m-dest').value = '改過的目的地';
    await saveForm();
    assert.deepStrictEqual(alerts, []);
    assert.deepStrictEqual(itinerary.map(d => d.date), ['10/21', '10/22', '10/23']);
    assert.strictEqual(itinerary[1].dest, '改過的目的地');
  });

  await check('新增一天：日期自動接在最後一天的隔天', async () => {
    itinerary = mkTrip(); reset();
    openForm();
    document.getElementById('m-dest').value = '新的一天';
    await saveForm();
    assert.deepStrictEqual(alerts, []);
    assert.deepStrictEqual(itinerary.map(d => d.date), ['10/21', '10/22', '10/23', '10/24']);
    assert.strictEqual(itinerary[3].dest, '新的一天');
  });

  await check('寫回資料庫的內容不含 wd 欄位', async () => {
    itinerary = mkTrip().map(d => ({ ...d, wd: 99 })); reset();
    openForm(0);
    dateEl().value = '10/21';
    await saveForm();
    assert.strictEqual(pushed.length, 1);
    pushed[0].forEach((d, i) => assert.ok(!('wd' in d), `第 ${i + 1} 天仍帶 wd`));
  });

  await check('存檔：保留未列在表單中的欄位', async () => {
    itinerary = [{ date: '10/21', dest: 'A', trans: 'T', stay: 'S', mystery: '不該消失' }]; reset();
    openForm(0);
    await saveForm();
    assert.strictEqual(itinerary[0].mystery, '不該消失', '表單沒列到的欄位不能被丟掉');
  });

  await check('存檔：雨天備案與參考資料會寫回', async () => {
    itinerary = [{ date: '10/21', dest: 'A', trans: 'T', stay: 'S' }]; reset();
    openForm(0);
    document.getElementById('m-rain').value = '逛地下街';
    document.getElementById('m-ref').value = 'https://ref.com';
    await saveForm();
    assert.strictEqual(itinerary[0].rain, '逛地下街');
    assert.strictEqual(itinerary[0].ref, 'https://ref.com');
  });

  await check('存檔：兩欄留空時刪除該欄而不是留空字串', async () => {
    itinerary = [{ date: '10/21', dest: 'A', trans: 'T', stay: 'S', rain: '舊的', ref: 'https://old.com' }]; reset();
    openForm(0);
    document.getElementById('m-rain').value = '';
    document.getElementById('m-ref').value = '';
    await saveForm();
    assert.ok(!('rain' in itinerary[0]), '留空應刪除欄位而不是留下空字串');
    assert.ok(!('ref' in itinerary[0]));
  });

  await check('編輯視窗：帶入現有的雨天備案與參考資料', async () => {
    itinerary = [{ date: '10/21', dest: 'A', rain: '地下街', ref: 'https://r.com' }]; reset();
    openForm(0);
    assert.strictEqual(document.getElementById('m-rain').value, '地下街');
    assert.strictEqual(document.getElementById('m-ref').value, 'https://r.com');
  });

  console.log(`\n${passed}/${total} passed`);
})();
