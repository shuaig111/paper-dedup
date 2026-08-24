/* 写作检查模块自测：node test-writing.js */
'use strict';
const Writing = require('./js/writing.js');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ FAIL: ' + msg); }
}

console.log('== 1. 口语化检测 ==');
const text1 = '本文对这个问题进行了分析，这种方法非常之好，而且可以越来越快地解决问题。';
const i1 = Writing.check(text1);
const colloquials = i1.filter(x => x.type === 'colloquial');
assert(colloquials.some(x => x.text === '非常之'), '检测到“非常之”');
assert(colloquials.some(x => x.text === '越来越'), '检测到“越来越”');
const redundants = i1.filter(x => x.type === 'redundant');
assert(redundants.some(x => x.text === '进行了分析'), '检测到“进行了分析”冗余结构');

console.log('== 2. 冗余结构 ==');
const i2 = Writing.check('本研究对数据进行加以处理，该方法能够被广泛应用。');
assert(i2.some(x => x.type === 'redundant' && /加以处理/.test(x.text)), '检测到“加以处理”');
assert(i2.some(x => x.type === 'redundant' && /能够被/.test(x.text)), '检测到“能够被”');

console.log('== 3. 超长句 ==');
const longSent = '本文针对当前网络入侵检测系统中存在的检测率低误报率高以及复杂网络环境下特征提取困难的问题提出了一种基于深度学习与注意力机制相结合的入侵检测方法该方法在公开数据集上取得了较好的效果。';
const i3 = Writing.check(longSent);
assert(i3.some(x => x.type === 'long'), '检测到超长句');
assert(i3.find(x => x.type === 'long').text.includes('全句'), '超长句提示含字数');

console.log('== 4. 正常文本无报错 ==');
const i4 = Writing.check('本文建立了基于熵权法的评价模型。实验结果表明，该方法具有良好的性能，可为决策提供依据。');
assert(i4.filter(x => x.type === 'colloquial' || x.type === 'redundant').length === 0, '规范文本无口语/冗余问题');

console.log('== 5. 统计与空输入 ==');
const sum = Writing.summarize(i1);
assert(sum.colloquial >= 2 && sum.redundant >= 1, '按类型统计正确');
assert(Writing.check('').length === 0, '空输入返回空');
assert(Writing.check('   ').length === 0, '空白输入返回空');

console.log('== 6. 位置信息 ==');
assert(i1[0].index >= 0, '问题带位置索引');

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
