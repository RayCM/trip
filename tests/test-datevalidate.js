const fs = require('fs');
const assert = require('assert');

const path = require('path');
const SRC = path.join(__dirname, '..', 'index.html');
const src = fs.readFileSync(SRC, 'utf8');

const m = src.match(/function isValidAnchorDate\(s\)\{[\s\S]*?\n\}/);
if (!m) {
  console.error('FAIL: 在 index.html 找不到 isValidAnchorDate()');
  process.exit(1);
}
eval(m[0]);

const accept = ['10/21', '1/1', '09/08', '12/31', '10／21', ' 10/21 '];
// 空字串一定要在擋下之列——清空第 1 天日期是最危險的輸入
// 02/30、04/31 是重點：月日各自落在範圍內，但該月沒有這天，Date 會靜默進位
const reject = ['', '2026-10-21', '2026/10/21', '10-21', '13/45', '0/5', '10/0', '10/32', '02/30', '04/31', 'abc'];

let passed = 0;
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; }
}

accept.forEach(s => check('應接受: ' + JSON.stringify(s), () => {
  assert.ok(isValidAnchorDate(s), '應接受但被擋下: ' + JSON.stringify(s));
}));
reject.forEach(s => check('應擋下: ' + JSON.stringify(s), () => {
  assert.ok(!isValidAnchorDate(s), '應擋下但被接受: ' + JSON.stringify(s));
}));

console.log(`\n✓ 接受 ${accept.length} 種合法格式，擋下 ${reject.length} 種不合法格式`);
console.log(`${passed}/${accept.length + reject.length} passed`);
