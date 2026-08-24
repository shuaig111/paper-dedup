/* AI 省钱精修模块自测：node test-refine.js */
'use strict';
const dict = require('./js/dictionary.js');
const engine = require('./js/engine.js');
const checker = require('./js/checker.js');
const Refine = require('./js/refine.js');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ FAIL: ' + msg); }
}

const PARA = '近年来，随着信息技术的快速发展，网络安全问题日益突出，受到社会各界的广泛关注。本文针对当前网络入侵检测系统中存在的检测率低、误报率高的问题，提出了一种基于深度学习的入侵检测方法。实验结果表明，该方法在公开数据集上的检测准确率达到98.5%，明显优于传统的机器学习方法。';

console.log('== 1. 句子选择 ==');
const r = engine.run(PARA, { mode: 'general', strength: 'conservative', seed: 5 });
// 保守强度下仍有部分句子高度相似
const tasks = Refine.selectSentences(PARA, r.text, 0.55);
assert(Array.isArray(tasks), '返回数组');
if (tasks.length) {
  assert(tasks[0].sentence && tasks[0].sim >= 0.55, '句子与相似度正确 (' + tasks[0].sim.toFixed(2) + ')');
  assert(typeof tasks[0].orig === 'string' && tasks[0].orig.length > 0, '携带最相似原文句');
  console.log('  相似句: ' + tasks[0].sentence.slice(0, 40) + '…');
  console.log('  原文句: ' + tasks[0].orig.slice(0, 40) + '…');
} else {
  console.log('  [信息] 该种子下无 ≥55% 相似句（可接受）');
}
assert(Refine.selectSentences(PARA, PARA, 0.55).length >= 3, '原文 vs 自身能找出全部相似句');

console.log('== 2. 句子替换 ==');
const para2 = '第一句内容。第二句内容。第一句内容重复出现。';
const rep1 = Refine.replaceInParagraph(para2, '第二句内容。', '第二句已改写。');
assert(rep1.applied && rep1.text === '第一句内容。第二句已改写。第一句内容重复出现。', '替换首个出现处');
const rep2 = Refine.replaceInParagraph(para2, '不存在的句子', 'X');
assert(!rep2.applied && rep2.text === para2, '找不到时不修改');
const rep3 = Refine.replaceInParagraph(para2, '', 'X');
assert(!rep3.applied, '空句子不处理');

console.log('== 3. Prompt 与 token 估算 ==');
const p = Refine.buildPrompt('原文句', '待改写句', '数学建模论文');
assert(p.includes('原文句') && p.includes('待改写句') && p.includes('数学建模论文'), 'prompt 包含上下文');
assert(Refine.estimateTokens('你好世界1234') === 5, 'token 估算（4 汉字 + 4 字符/4 = 5）');
const sum = Refine.summarize([{ sentence: '句A', orig: '句B' }], '全文' + '字'.repeat(100));
assert(sum.taskTokens > 0 && sum.fullTokens > 0, '预算统计有效');
assert(sum.savedPct >= 0 && sum.savedPct <= 100, '节省比例在 0~100% (' + sum.savedPct + '%)');
console.log('  全文约 ' + sum.fullTokens + ' tokens，任务约 ' + sum.taskTokens + ' tokens，节省约 ' + sum.savedPct + '%');

console.log('== 4. 混合链路模拟（引擎 → 选句 → 替换） ==');
const refined = [r.text];
const fakeAI = t => t.sentence + '（AI改写）';
const tasks2 = Refine.selectSentences(PARA, refined[0], 0.5);
let appliedCount = 0;
for (const t of tasks2) {
  const rep = Refine.replaceInParagraph(refined[0], t.sentence, fakeAI(t));
  if (rep.applied) { refined[0] = rep.text; appliedCount++; }
}
const est = checker.estimateSimilarity(PARA, refined[0]);
console.log('  精修后估算重复率: ' + (est.rate * 100).toFixed(1) + '%（原 ' + (checker.estimateSimilarity(PARA, r.text).rate * 100).toFixed(1) + '%）');
assert(appliedCount === tasks2.length, '全部任务已应用 (' + appliedCount + ')');
assert(est.rate <= checker.estimateSimilarity(PARA, r.text).rate, '精修后重复率不升反降');

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
