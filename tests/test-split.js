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
eval(extract('memberRefCount'));
eval(extract('dropSplitFields'));
eval(extract('sortExpenses'));
eval(extract('excludeNewMember'));

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

const C = { id: 'c', name: '阿華' };

check('這筆沒勾 Deny：各自金額模式下全部算付錢的人', () => {
  const e = { amount: 2000, split: { mode: 'custom', out: ['b'] } };
  assert.deepStrictEqual(expenseShares(e, [A, B]), { a: 2000, b: 0 });
});

check('各自金額＋有人沒勾：剩下的只平分給有勾的人', () => {
  const e = { amount: 3000, split: { mode: 'custom', own: { a: 1000 }, out: ['c'] } };
  assert.deepStrictEqual(expenseShares(e, [A, B, C]), { a: 2000, b: 1000, c: 0 });
});

check('平分模式也能取消勾選某人', () => {
  const e = { amount: 3000, split: { mode: 'equal', out: ['c'] } };
  assert.deepStrictEqual(expenseShares(e, [A, B, C]), { a: 1500, b: 1500, c: 0 });
});

check('沒勾的人就算格子裡有數字也不算', () => {
  const e = { amount: 2000, split: { mode: 'custom', own: { b: 500 }, out: ['b'] } };
  assert.deepStrictEqual(expenseShares(e, [A, B]), { a: 2000, b: 0 });
});

check('所有人都沒勾時回傳 null', () => {
  const e = { amount: 2000, split: { mode: 'custom', out: ['a', 'b'] } };
  assert.strictEqual(expenseShares(e, [A, B]), null);
});

check('結算：10/30 兩人各自金額、10/31 只有 Ray，小明只還 10/30 自己那份', () => {
  members = [A, B]; rate = 0.2;
  expenses = [
    { amount: 939, cur: 'JPY', paidBy: 'a', split: { mode: 'custom', own: { a: 400, b: 539 } } },
    { amount: 2000, cur: 'JPY', paidBy: 'a', split: { mode: 'custom', out: ['b'] } },
  ];
  assert.deepStrictEqual(roundTx(computeSettlement('JPY').tx), [{ from: '小明', to: 'Ray', amount: 539 }]);
});

check('表單：取消勾選的人記在 out，他的格子不收', () => {
  assert.deepStrictEqual(
    splitFromInputs(2000, 'custom', { a: '', b: '500' }, ['b']),
    { split: { mode: 'custom', out: ['b'] } });
});

check('表單：平分模式有人沒勾時也要存分法', () => {
  assert.deepStrictEqual(splitFromInputs(3000, 'equal', {}, ['c']), { split: { mode: 'equal', out: ['c'] } });
});

check('表單：全部都沒勾時回報 none', () => {
  assert.deepStrictEqual(splitFromInputs(3000, 'custom', { a: '', b: '' }, ['a', 'b']), { error: 'none' });
});

check('成員出現在幾筆紀錄（付錢的、各自金額、沒勾）', () => {
  expenses = [
    { amount: 1, paidBy: 'b' },
    { amount: 1, paidBy: 'a', split: { mode: 'custom', own: { b: 1 } } },
    { amount: 1, paidBy: 'a', split: { mode: 'custom', out: ['b'] } },
    { amount: 1, paidBy: 'a' },
  ];
  assert.strictEqual(memberRefCount('b'), 3);
  assert.strictEqual(memberRefCount('c'), 0);
});

check('成員不到 2 人時存檔不動原本的誰付的與分帳', () => {
  const e = { id: 'x', amount: 939, paidBy: 'a', split: { mode: 'custom', own: { a: 400, b: 539 } } };
  applyFields(e, dropSplitFields({ amount: 939, note: '晚餐', paidBy: undefined, split: undefined }, 1));
  assert.deepStrictEqual(e.split, { mode: 'custom', own: { a: 400, b: 539 } });
  assert.strictEqual(e.paidBy, 'a');
  assert.strictEqual(e.note, '晚餐');
});

check('成員 2 人以上時照表單內容存（可以清掉分帳）', () => {
  const e = { id: 'x', amount: 939, paidBy: 'a', split: { mode: 'custom', own: { a: 400 } } };
  applyFields(e, dropSplitFields({ amount: 939, paidBy: 'a', split: undefined }, 2));
  assert.ok(!('split' in e));
});

check('清單排序：日期新到舊，同一天後輸入的排在上面', () => {
  const list = [
    { id: '1794817093510359', date: '2026-11-16', note: '10/31午餐' },
    { id: '1794810000000123', date: '2026-11-03', note: '10/30晚餐' },
    { id: '17948171000004', date: '2026-11-16', note: '11/01晚餐' },
  ];
  assert.deepStrictEqual(sortExpenses(list).map(e => e.note), ['11/01晚餐', '10/31午餐', '10/30晚餐']);
});

check('清單排序：交通預估（seed- 開頭）排在同一天手動記的後面，彼此照編號', () => {
  const list = [
    { id: 'seed-1', date: '2026-10-21', note: 'b' },
    { id: '1794817093510359', date: '2026-10-21', note: '手動' },
    { id: 'seed-0', date: '2026-10-21', note: 'a' },
  ];
  assert.deepStrictEqual(sortExpenses(list).map(e => e.note), ['手動', 'a', 'b']);
});

check('清單排序：不改動原本的陣列', () => {
  const list = [{ id: '1', date: '2026-01-01' }, { id: '2', date: '2026-01-02' }];
  sortExpenses(list);
  assert.deepStrictEqual(list.map(e => e.id), ['1', '2']);
});

check('中途加入：之前的紀錄都把新成員排除（平分的補上分法、已排除的不重複）', () => {
  const list = [
    { id: '1', amount: 1000 },
    { id: '2', amount: 939, split: { mode: 'custom', own: { a: 400, b: 539 } } },
    { id: '3', amount: 2000, split: { mode: 'custom', out: ['b'] } },
    { id: '4', amount: 500, split: { mode: 'equal', out: ['c'] } },
  ];
  excludeNewMember(list, 'c', 2);
  assert.deepStrictEqual(list.map(e => e.split), [
    { mode: 'equal', out: ['c'] },
    { mode: 'custom', own: { a: 400, b: 539 }, out: ['c'] },
    { mode: 'custom', out: ['b', 'c'] },
    { mode: 'equal', out: ['c'] },
  ]);
});

check('中途加入：結算時新成員不分攤加入前的花費', () => {
  members = [A, B]; rate = 0.2;
  expenses = [{ id: '1', amount: 3000, cur: 'JPY', paidBy: 'a' }];
  excludeNewMember(expenses, 'c', members.length);
  members = [A, B, C];
  const r = computeSettlement('JPY');
  assert.strictEqual(Math.round(r.net.find(x => x.id === 'c').share), 0);
  assert.deepStrictEqual(roundTx(r.tx), [{ from: '小明', to: 'Ray', amount: 1500 }]);
});

check('原本成員不到 2 人時（還不能分帳）加人，不動舊紀錄', () => {
  const list = [{ id: '1', amount: 1000 }];
  excludeNewMember(list, 'b', 1);
  assert.ok(!('split' in list[0]));
});

console.log(`\n${passed} passed`);
