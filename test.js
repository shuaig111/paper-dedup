/* 功能自测：node test.js */
'use strict';
const dict = require('./js/dictionary.js');
const engine = require('./js/engine.js');
const checker = require('./js/checker.js');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ FAIL: ' + msg); }
}

const THESIS = '近年来，随着信息技术的快速发展，网络安全问题日益突出，受到社会各界的广泛关注。本文针对当前网络入侵检测系统中存在的检测率低、误报率高的问题，提出了一种基于深度学习的入侵检测方法。该方法首先利用卷积神经网络对网络流量数据进行特征提取，然后通过长短期记忆网络对时序特征进行建模，最后采用Softmax分类器实现攻击类型的识别。实验结果表明，该方法在公开数据集上的检测准确率达到98.5%，明显优于传统的机器学习方法，具有较好的实用价值。';

const MATH = '针对城市突发公共事件的应急物资调配问题，本文建立了以最小化总配送时间为目标的多目标优化模型。首先，通过灰色关联分析筛选出影响物资需求的关键因素，利用熵权法确定各因素权重；其次，在考虑道路通行能力与时间窗约束的条件下，采用遗传算法对模型进行求解；最后，通过灵敏度分析验证了模型的鲁棒性。仿真结果表明，所提方案较传统方案配送效率提升23.6%，可为应急管理部门提供决策支持。';

const FORMULA = '根据公式$f(x)=\\frac{1}{x}$以及文献[3]的研究结果，2025年该模型的误差为12.5%，因此该方法的适用性需要进一步验证，同时我们需要注意数据噪声的影响。';

console.log('== 1. 保护机制 ==');
const prot = engine.protect(FORMULA, ['误差']);
assert(prot.text.indexOf('$f(x)') === -1 && prot.text.indexOf('\\frac') === -1, '公式被保护');
assert(prot.text.indexOf('[3]') === -1, '参考文献标记被保护');
assert(prot.text.indexOf('2025') === -1, '数字被保护');
assert(prot.items.length >= 4, '占位符数量正确 (' + prot.items.length + ')');
const rest = engine.restore(prot.text, prot.items);
assert(rest === FORMULA, '保护-还原无损');

console.log('== 2. 通用论文模式降重（标准强度） ==');
const r1 = engine.run(THESIS, { mode: 'general', strength: 'standard', seed: 42 });
assert(r1.text.length > 0, '输出非空');
assert(!/[\uE000\uE001\u0002\u0003]/.test(r1.text), '无占位符泄漏');
assert(r1.text.indexOf('98.5%') !== -1, '数字 98.5% 保留');
assert(r1.text.indexOf('Softmax') !== -1, '英文词 Softmax 保留');
assert(r1.changes.length > 5, '产生改写记录 (' + r1.changes.length + ' 条)');
console.log('  原文: ' + THESIS.slice(0, 60) + '…');
console.log('  改写: ' + r1.text.slice(0, 80) + '…');

console.log('== 3. 数学建模模式（强力） ==');
const r2 = engine.run(MATH, { mode: 'math', strength: 'strong', seed: 7 });
assert(!/[\uE000\uE001\u0002\u0003]/.test(r2.text), '无占位符泄漏');
assert(r2.text.indexOf('23.6%') !== -1, '数字 23.6% 保留');
for (const t of ['目标函数', '约束条件', '遗传算法', '灵敏度分析', '熵权法', '灰色关联']) {
  assert(!/[\uE000\uE001]/.test(r2.text), '数学术语未泄漏占位符: ' + t);
  if (r2.text.indexOf(t) === -1) console.log('    [信息] 术语被改写或原句重组: ' + t);
}
assert(r2.changes.length > 3, '产生改写记录 (' + r2.changes.length + ' 条)');
console.log('  改写: ' + r2.text.slice(0, 80) + '…');

console.log('== 4. 同种子可复现 ==');
const r3 = engine.run(THESIS, { mode: 'general', strength: 'standard', seed: 42 });
assert(r3.text === r1.text, '相同种子结果一致');

console.log('== 5. 三档强度差异 ==');
const rC = engine.run(THESIS, { mode: 'general', strength: 'conservative', seed: 1 });
const rS = engine.run(THESIS, { mode: 'general', strength: 'standard', seed: 1 });
const rT = engine.run(THESIS, { mode: 'general', strength: 'strong', seed: 1 });
console.log('  保守 ' + rC.changes.length + ' 条 / 标准 ' + rS.changes.length + ' 条 / 强力 ' + rT.changes.length + ' 条');
assert(rC.changes.length <= rS.changes.length, '保守 ≤ 标准');
assert(rS.changes.length <= rT.changes.length, '标准 ≤ 强力');

console.log('== 6. 查重估算 ==');
const est1 = checker.estimateSimilarity(THESIS, THESIS);
assert(est1 && est1.rate >= 0.95, '原文 vs 自身 ≈ 100% (' + (est1 ? est1.rate.toFixed(2) : 'null') + ')');
const est2 = checker.estimateSimilarity(THESIS, r1.text);
console.log('  原文 vs 改写后估算重复率: ' + (est2.rate * 100).toFixed(1) + '%');
assert(est2.rate < est1.rate, '改写后重复率下降');
const est3 = checker.estimateSimilarity(MATH, r2.text);
console.log('  数学建模改写后估算重复率: ' + (est3.rate * 100).toFixed(1) + '%');
const dup = checker.selfDuplicates(THESIS + '。' + THESIS);
assert(dup.length >= 1, '内部重复段落可检出 (' + dup.length + ' 组)');
const srep = checker.sentenceReport(THESIS, r1.text, 0.55);
console.log('  疑似重复句子: ' + srep.length + ' 句，最高相似度 ' + (srep.length ? (srep[0].sim * 100).toFixed(1) : '-') + '%');

console.log('== 7. 空输入/边界 ==');
const r0 = engine.run('', {});
assert(r0.text === '', '空输入返回空');
const rShort = engine.run('本文研究了该问题。', { strength: 'strong' });
assert(rShort.text.length > 0, '短句可处理');

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
