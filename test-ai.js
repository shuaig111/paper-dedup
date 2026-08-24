/* AI 多服务商模块自测：node test-ai.js */
'use strict';
const AI = require('./js/ai.js');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ FAIL: ' + msg); }
}

console.log('== 1. 服务商定义 ==');
assert(AI.PROVIDERS.length === 5, '5 个服务商 (' + AI.PROVIDERS.map(p => p.id).join(',') + ')');
assert(AI.getProvider('openai').type === 'openai', 'OpenAI 类型正确');
assert(AI.getProvider('anthropic').type === 'anthropic', 'Claude 类型正确');
assert(AI.getProvider('gemini').type === 'gemini', 'Gemini 类型正确');
assert(AI.getProvider('nope').id === 'deepseek', '未知服务商回退 DeepSeek');

console.log('== 2. 请求体组装 ==');
const o = AI.buildOpenAIPayload('gpt-4o-mini', 'SYS', 'USR', 4096);
assert(o.model === 'gpt-4o-mini' && o.messages.length === 2 && o.messages[0].role === 'system' && o.messages[1].content === 'USR', 'OpenAI 兼容请求体正确');
const a = AI.buildAnthropicPayload('claude-sonnet-4-20250514', 'SYS', 'USR', 4096);
assert(a.system === 'SYS' && a.messages[0].content === 'USR' && a.max_tokens === 4096, 'Claude 请求体正确');
const g = AI.buildGeminiPayload('gemini-2.5-flash', 'SYS', 'USR', 4096);
assert(g.contents[0].parts[0].text === 'USR' && g.systemInstruction.parts[0].text === 'SYS' && g.generationConfig.maxOutputTokens === 4096, 'Gemini 请求体正确');

console.log('== 3. 响应解析 ==');
assert(AI.parseResponse('openai', { choices: [{ message: { content: '你好' } }] }) === '你好', 'OpenAI 响应解析');
assert(AI.parseResponse('anthropic', { content: [{ type: 'text', text: '克劳德' }] }) === '克劳德', 'Claude 响应解析');
assert(AI.parseResponse('gemini', { candidates: [{ content: { parts: [{ text: '杰米' }] } }] }) === '杰米', 'Gemini 响应解析');
try { AI.parseResponse('openai', { error: { message: 'boom' } }); assert(false, '应抛错'); } catch (e) { assert(/boom/.test(e.message), '空响应抛出带错误信息的异常'); }

console.log('== 4. 错误消息映射 ==');
assert(AI.errMsg({ status: 401 }) === 'API Key 无效或没有权限（HTTP 401），请检查 Key 是否正确', '401 映射');
assert(AI.errMsg({ status: 429 }) === '请求过于频繁或额度用尽（HTTP 429），请稍后再试或检查账户余额', '429 映射');
assert(AI.errMsg({ name: 'TypeError' }).includes('网络连接失败'), '网络错误映射');
assert(AI.errMsg({ status: 400, detail: 'bad request' }).includes('bad request'), '400 携带详情');

console.log('== 5. 缺 Key / 缺模型校验 ==');
(async () => {
  let r1;
  try { await AI.call({ provider: 'openai', model: 'gpt-4o-mini', key: '', system: 's', user: 'u', viaServer: false }); r1 = 'no-throw'; }
  catch (e) { r1 = e.message; }
  assert(/API Key/.test(r1), '缺 Key 报错: ' + r1);
  let r2;
  try { await AI.call({ provider: 'custom', model: '', key: 'x', system: 's', user: 'u', viaServer: false }); r2 = 'no-throw'; }
  catch (e) { r2 = e.message; }
  assert(/模型/.test(r2), '缺模型报错: ' + r2);
  let r3;
  try { await AI.call({ provider: 'custom', model: 'm', key: 'x', baseUrl: '', system: 's', user: 'u', viaServer: false }); r3 = 'no-throw'; }
  catch (e) { r3 = e.message; }
  assert(/Base URL/.test(r3), '自定义缺 Base URL 报错: ' + r3);

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
