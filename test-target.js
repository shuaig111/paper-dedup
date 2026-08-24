/* 目标重复率达标迭代自测：node test-target.js */
'use strict';
const engine = require('./js/engine.js');
const checker = require('./js/checker.js');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ FAIL: ' + msg); }
}
const pct = v => (v * 100).toFixed(1) + '%';

const THESIS = '近年来，随着信息技术的快速发展，网络安全问题日益突出，受到社会各界的广泛关注。本文针对当前网络入侵检测系统中存在的检测率低、误报率高的问题，提出了一种基于深度学习的入侵检测方法。该方法首先利用卷积神经网络对网络流量数据进行特征提取，然后通过长短期记忆网络对时序特征进行建模，最后采用Softmax分类器实现攻击类型的识别。实验结果表明，该方法在公开数据集上的检测准确率达到98.5%，明显优于传统的机器学习方法，具有较好的实用价值。';

const MATH = '针对城市突发公共事件的应急物资调配问题，本文建立了以最小化总配送时间为目标的多目标优化模型。首先，通过灰色关联分析筛选出影响物资需求的关键因素，利用熵权法确定各因素权重；其次，在考虑道路通行能力与时间窗约束的条件下，采用遗传算法对模型进行求解；最后，通过灵敏度分析验证了模型的鲁棒性。仿真结果表明，所提方案较传统方案配送效率提升23.6%，可为应急管理部门提供决策支持。';

const TEMPLATED = '近年来，随着社会经济的快速发展，交通拥堵问题日益严重，受到社会各界的广泛关注。针对城市交通拥堵问题，本文建立了一个基于深度学习的交通流量预测模型，实验结果表明该方法具有较好的实用价值。随着信息技术的快速发展，为城市交通管理提供了有力支撑。综上所述，该方法具有广阔的应用前景。';

console.log('== 1. 目标 ≤25% 达标迭代（通用论文） ==');
const r1 = engine.runToTarget(THESIS, { mode: 'general', strength: 'standard', seed: 1 }, 25);
r1.rounds.forEach(x => console.log('  ' + x.level + ' → ' + pct(x.rate)));
assert(r1.reached, '达标（最终 ' + pct(r1.finalRate) + ' < 25%）');
assert(r1.finalRate < 0.25, '最终重复率 < 25%');

console.log('== 2. 目标 ≤25%（数学建模，含术语保护） ==');
const r2 = engine.runToTarget(MATH, { mode: 'math', strength: 'standard', seed: 2 }, 25);
r2.rounds.forEach(x => console.log('  ' + x.level + ' → ' + pct(x.rate)));
assert(r2.reached, '达标（最终 ' + pct(r2.finalRate) + '）');
assert(r2.result.text.includes('23.6%'), '数字 23.6% 保留');
assert(r2.result.text.includes('遗传算法') || r2.result.text.includes('灵敏度'), '数学术语保留');
assert(!/[\uE000\uE001\u0002\u0003]/.test(r2.result.text), '无占位符泄漏');

console.log('== 3. 套话模板改写（压重复率利器） ==');
const r3 = engine.runToTarget(TEMPLATED, { mode: 'general', strength: 'standard', seed: 3 }, 25);
r3.rounds.forEach(x => console.log('  ' + x.level + ' → ' + pct(x.rate)));
assert(r3.reached, '套话文本达标（' + pct(r3.finalRate) + '）');
const tmplCount = r3.result.changes.filter(c => c.type === 'template').length;
assert(tmplCount > 0, '模板替换生效 (' + tmplCount + ' 处)');
console.log('  改写: ' + r3.result.text.slice(0, 70) + '…');

console.log('== 4. 目标越低迭代越多 ==');
const r25 = engine.runToTarget(THESIS, { mode: 'general', strength: 'standard', seed: 5 }, 25);
const r10 = engine.runToTarget(THESIS, { mode: 'general', strength: 'standard', seed: 5 }, 10);
console.log('  目标25% → ' + r25.rounds.length + ' 轮（' + pct(r25.finalRate) + '），目标10% → ' + r10.rounds.length + ' 轮（' + pct(r10.finalRate) + '）');
assert(r10.rounds.length >= r25.rounds.length, '更低目标迭代轮数更多');
assert(r10.reached, '目标 10% 也可达（极强档）');

console.log('== 5. 极强档（ultra）直接压到 25% 以下 ==');
const ru = engine.run(THESIS, { mode: 'general', strength: 'ultra', seed: 7 });
const estU = checker.estimateSimilarity(THESIS, ru.text);
console.log('  ultra 估算重复率: ' + pct(estU.rate) + '，替换 ' + ru.changes.length + ' 处');
assert(estU.rate < 0.25, 'ultra 单轮 < 25%');
const rs = engine.run(THESIS, { mode: 'general', strength: 'strong', seed: 7 });
assert(ru.changes.length >= rs.changes.length, 'ultra 改写量 ≥ strong');

console.log('== 6. 长文（重复段落拼接）达标 ==');
let long = '';
for (let i = 0; i < 20; i++) long += THESIS + '\n';
const rl = engine.runToTarget(long, { mode: 'general', strength: 'standard', seed: 9 }, 25);
rl.rounds.forEach(x => console.log('  ' + x.level + ' → ' + pct(x.rate)));
assert(rl.reached, '长文达标（' + pct(rl.finalRate) + '）');

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
