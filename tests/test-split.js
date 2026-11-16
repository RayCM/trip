// 分帳：expenseShares() 算每人在一筆花費裡要攤多少，computeSettlement() 匯總成誰該給誰。
const fs = require('fs');
const assert = require('assert');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extract(name) {
  const m = src.match(new RegExp('function ' + name + '\\([^)]*\\)\\{[\\s\\S]*?\\n\\}'));
  if (!m) { console.error('FAIL: 在 index.html 找不到 ' + name + '()'); process.exit(1); }
  return m[0];
}

// direct eval 讓函式讀到本檔的 members / expenses / rate
let members = [], expenses = [], rate = 0.2;
eval(extract('expenseShares'));
eval(extract('computeSettlement'));
eval(extract('splitFromInputs'));
eval(extract('applyFields'));

const A = { id: 'a', name: 'Ray' }, B = { id: 'b', name: '小明' };
const roundTx = tx => tx.map(x => ({ ...x, amount: Math.round(x.amount) }));
let passed = 0;
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; }
}

check('沒有分法的舊資料照平分', () => {
  assert.deepStrictEqual(expenseShares({ amount: 3000 }, [A, B]), { a: 1500, b: 1500 });
});

check('各自金額：各填自己的，剩下的平分', () => {
  const e = { amount: 2700, split: { mode: 'custom', own: { a: 1000, b: 1200 } } };
  assert.deepStrictEqual(expenseShares(e, [A, B]), { a: 1250, b: 1450 });
});

check('各自金額加總剛好等於總額時，沒有剩下的', () => {
  const e = { amount: 3000, split: { mode: 'custom', own: { a: 1000, b: 2000 } } };
  assert.deepStrictEqual(expenseShares(e, [A, B]), { a: 1000, b: 2000 });
});

check('只填一個人：自己買的東西全算自己', () => {
  const e = { amount: 3000, split: { mode: 'custom', own: { a: 3000 } } };
  assert.deepStrictEqual(expenseShares(e, [A, B]), { a: 3000, b: 0 });
});

check('各自金額加總超過總額時回傳 null', () => {
  const e = { amount: 2000, split: { mode: 'custom', own: { a: 1500, b: 1000 } } };
  assert.strictEqual(expenseShares(e, [A, B]), null);
});

check('有負數金額時回傳 null', () => {
  const e = { amount: 2000, split: { mode: 'custom', own: { a: -500 } } };
  assert.strictEqual(expenseShares(e, [A, B]), null);
});

check('已被刪掉的成員填的金額不算，改進剩下的一起平分', () => {
  const e = { amount: 3000, split: { mode: 'custom', own: { a: 1000, gone: 1000 } } };
  assert.deepStrictEqual(expenseShares(e, [A, B]), { a: 2000, b: 1000 });
});

check('結算：Ray 付 ¥2,700、各自金額，小明要還自己那份（換成台幣）', () => {
  members = [A, B]; rate = 0.2;
  expenses = [{ amount: 2700, cur: 'JPY', paidBy: 'a', split: { mode: 'custom', own: { a: 1000, b: 1200 } } }];
  const r = computeSettlement();
  assert.strictEqual(r.included, 1);
  assert.deepStrictEqual(roundTx(r.tx), [{ from: '小明', to: 'Ray', amount: 290 }]);
  const ray = r.net.find(x => x.id === 'a');
  assert.strictEqual(Math.round(ray.paid), 540);
  assert.strictEqual(Math.round(ray.share), 250);
});

check('結算：日圓與台幣混記，平分與各自金額混用', () => {
  members = [A, B]; rate = 0.2;
  expenses = [
    { amount: 1000, cur: 'TWD', paidBy: 'b' },
    { amount: 5000, cur: 'JPY', paidBy: 'a', split: { mode: 'custom', own: { b: 5000 } } },
  ];
  const r = computeSettlement();
  // Ray 付 1000、自己攤 500；小明付 1000、攤 500 + 1000
  assert.deepStrictEqual(roundTx(r.tx), [{ from: '小明', to: 'Ray', amount: 500 }]);
});

check('結算：沒指定誰付的、或分法不合法的那筆不算', () => {
  members = [A, B]; rate = 0.2;
  expenses = [
    { amount: 1000, cur: 'TWD' },
    { amount: 1000, cur: 'TWD', paidBy: 'a', split: { mode: 'custom', own: { a: 2000 } } },
  ];
  const r = computeSettlement();
  assert.strictEqual(r.included, 0);
});

check('結算：所有人應攤加總等於所有人已付加總', () => {
  members = [A, B, { id: 'c', name: '阿華' }]; rate = 0.21;
  expenses = [
    { amount: 3333, cur: 'JPY', paidBy: 'a' },
    { amount: 2000, cur: 'JPY', paidBy: 'c', split: { mode: 'custom', own: { a: 300, b: 700 } } },
    { amount: 450, cur: 'TWD', paidBy: 'b' },
  ];
  const r = computeSettlement();
  const paid = r.net.reduce((s, x) => s + x.paid, 0);
  const share = r.net.reduce((s, x) => s + x.share, 0);
  assert.ok(Math.abs(paid - share) < 1e-6, `已付 ${paid} ≠ 應攤 ${share}`);
  assert.ok(Math.abs(r.pool - paid) < 1e-6);
});

check('表單：選平分時不存分法', () => {
  assert.deepStrictEqual(splitFromInputs(2700, 'equal', { a: '1000' }), { split: undefined });
});

check('表單：各自金額只收有填、大於 0 的格子', () => {
  assert.deepStrictEqual(
    splitFromInputs(2700, 'custom', { a: '1000', b: ' 1200 ', c: '', d: '0' }),
    { split: { mode: 'custom', own: { a: 1000, b: 1200 } } });
});

check('表單：各自金額一格都沒填，等於平分', () => {
  assert.deepStrictEqual(splitFromInputs(2700, 'custom', { a: '', b: '' }), { split: undefined });
});

check('表單：各自金額加總超過總額時回報 over', () => {
  assert.deepStrictEqual(splitFromInputs(2000, 'custom', { a: '1500', b: '1000' }), { error: 'over' });
});

check('表單：填了不是數字或負數時回報 bad', () => {
  assert.deepStrictEqual(splitFromInputs(2000, 'custom', { a: 'abc' }), { error: 'bad' });
  assert.deepStrictEqual(splitFromInputs(2000, 'custom', { a: '-5' }), { error: 'bad' });
});

check('結算可以改用日圓算：日圓那筆不經過匯率，小明直接還 ¥1,450', () => {
  members = [A, B]; rate = 0.21;
  expenses = [{ amount: 2700, cur: 'JPY', paidBy: 'a', split: { mode: 'custom', own: { a: 1000, b: 1200 } } }];
  const r = computeSettlement('JPY');
  assert.deepStrictEqual(roundTx(r.tx), [{ from: '小明', to: 'Ray', amount: 1450 }]);
  assert.strictEqual(Math.round(r.pool), 2700);
});

check('結算用日圓時，台幣那筆照匯率換成日圓', () => {
  members = [A, B]; rate = 0.2;
  expenses = [{ amount: 1000, cur: 'TWD', paidBy: 'b' }];
  const r = computeSettlement('JPY');
  // NT$1,000 ＝ ¥5,000，Ray 要還一半
  assert.deepStrictEqual(roundTx(r.tx), [{ from: 'Ray', to: '小明', amount: 2500 }]);
});

check('不指定幣別時照舊用台幣算', () => {
  members = [A, B]; rate = 0.2;
  expenses = [{ amount: 1000, cur: 'JPY', paidBy: 'a' }];
  assert.deepStrictEqual(roundTx(computeSettlement().tx), [{ from: '小明', to: 'Ray', amount: 100 }]);
});

check('寫回資料：值是 undefined 的欄位被刪掉，其他欄位與沒提到的欄位都保留（Firebase 不收 undefined）', () => {
  const e = { id: 'x', amount: 100, paidBy: 'a', split: { mode: 'custom', own: { a: 50 } }, _seed: 'transport' };
  applyFields(e, { amount: 200, paidBy: undefined, split: undefined });
  assert.deepStrictEqual(e, { id: 'x', amount: 200, _seed: 'transport' });
  assert.ok(!('paidBy' in e) && !('split' in e));
});

console.log(`\n${passed} passed`);
