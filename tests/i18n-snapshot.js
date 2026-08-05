const fs = require('fs');

const path = require('path');
const SRC = path.join(__dirname, '..', 'index.html');
const src = fs.readFileSync(SRC, 'utf8');

// 抽出資料區塊（const WD= 起，到 const SEED_TOTAL= 之前）
const start = src.indexOf('const WD=');
const end = src.indexOf('const SEED_TOTAL=');
if (start < 0 || end < 0 || end <= start) {
  console.error('FAIL: 找不到資料區塊邊界（const WD= / const SEED_TOTAL=）');
  process.exit(1);
}
const block = src.slice(start, end);

// eval 後把需要的常數回傳出來（const 在 eval 內是區塊作用域，必須用尾端運算式取值）
const D = eval(block + '\n;({WD,UI,STAY,DEFAULT_DAYS,TODOS,CATS,TRANSPORT_EST,L_E5489,L_HWB})');

// 語系物件與純字串都解析成中文
const s = o => o == null ? '' : (typeof o === 'string' ? o : (o.zh || ''));
const arr = o => Array.isArray(o) ? o : ((o && o.zh) || []);

const LANG_KEYS = ['regions', 'route', 'regionKey'];

const snap = {
  WD: arr(D.WD),
  UI_regions: arr(D.UI.regions),
  UI_route: arr(D.UI.route),
  UI_regionKey: arr(D.UI.regionKey),
  UI: Object.keys(D.UI).filter(k => !LANG_KEYS.includes(k)).sort()
    .reduce((acc, k) => { acc[k] = s(D.UI[k]); return acc; }, {}),
  L_E5489: s(D.L_E5489),
  L_HWB: s(D.L_HWB),
  STAY: Object.keys(D.STAY).sort()
    .reduce((acc, k) => { acc[k] = { name: s(D.STAY[k]), url: D.STAY[k].url || '' }; return acc; }, {}),
  DEFAULT_DAYS: D.DEFAULT_DAYS.map(d => ({
    date: d.date, r: d.r, leaf: !!d.leaf,
    dest: s(d.dest), trans: s(d.trans), note: s(d.note),
    url: d.url || '', ulabel: s(d.ulabel),
    stay: s(d.stay), stayUrl: (d.stay && d.stay.url) || '',
  })),
  TODOS: D.TODOS.map(x => ({
    id: x.id, due: x.due, time: x.time, url: x.url,
    title: s(x.title), forDay: s(x.forDay),
  })),
  CATS: D.CATS.map(c => ({ id: c.id, color: c.color, name: s(c.name) })),
  TRANSPORT_EST: D.TRANSPORT_EST.map(x => ({ date: x.date, jpy: x.jpy, note: s(x.note) })),
};

process.stdout.write(JSON.stringify(snap, null, 1) + '\n');
