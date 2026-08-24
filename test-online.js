/* 在线工具模块自测：node test-online.js（含真实免费 API 调用） */
'use strict';
const Online = require('./js/online.js');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ FAIL: ' + msg); }
}

console.log('== 1. 分块 ==');
const chunks = Online.chunkText('第一句。第二句。第三句！\n第四句；第五句。', 10);
assert(chunks.length >= 3, '按句界分块 (' + chunks.length + ' 块)');
const big = '句。'.repeat(300);
const bc = Online.chunkText(big, 380);
assert(bc.length > 1, '长文本自动分块 (' + bc.length + ' 块)');
assert(bc.every(c => c.length <= 380), '每块 ≤ 380 字符');

console.log('== 2. 检索 URL 构造 ==');
const urls = Online.searchUrls('网络安全');
assert(urls.length === 4, '4 个平台');
assert(urls[0].url.includes('kns.cnki.net') && decodeURIComponent(urls[0].url).includes('网络安全'), '知网 URL 正确');
assert(urls[1].url.includes('wanfangdata'), '万方 URL 正确');
assert(urls[2].url.includes('cqvip'), '维普 URL 正确');
assert(urls[3].url.includes('xueshu.baidu.com'), '百度学术 URL 正确');

console.log('== 3. 真实翻译（MyMemory 免费 API） ==');
(async () => {
  try {
    const zh = await Online.translate('你好世界，这是一个测试。', 'zh-CN', 'en-GB');
    console.log('  中→英: ' + zh);
    assert(zh.trim().length > 0, '中译英有结果');
    const en = await Online.translate('Hello world, this is a test.', 'en-GB', 'zh-CN');
    console.log('  英→中: ' + en);
    assert(en.trim().length > 0, '英译中有结果');
  } catch (e) {
    console.log('  [信息] 真实翻译调用失败（网络受限？）: ' + e.message);
  }

  console.log('== 4. 回译降重（真实链路） ==');
  try {
    const back = await Online.backTranslate('本文提出了一种基于深度学习的方法，实验结果表明该方法具有较好的性能。');
    console.log('  回译结果: ' + back);
    assert(back.trim().length > 0, '回译有结果');
    const diff = back !== '本文提出了一种基于深度学习的方法，实验结果表明该方法具有较好的性能。';
    console.log('  回译与原文不同: ' + diff);
    assert(diff, '回译改变措辞（降重效果）');
  } catch (e) {
    console.log('  [信息] 回译调用失败（网络受限？）: ' + e.message);
  }

  console.log('== 5. 诊断目标清单 ==');
  assert(Online.DIAG_TARGETS.length >= 6, '诊断目标 ≥ 6 个');
  assert(Online.DIAG_TARGETS.some(t => t.name.includes('DeepSeek')), '含 DeepSeek');

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
