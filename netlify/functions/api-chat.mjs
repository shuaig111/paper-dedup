/* Netlify 云函数：多服务商 AI 代理（DeepSeek / OpenAI / Claude / Gemini / 自定义兼容端点）
 * 前端按服务商调用：
 *   POST /.netlify/functions/api-chat      body: {kind:'openai', key, baseUrl, payload}
 *   POST /.netlify/functions/api-chat      body: {kind:'anthropic', key, payload}
 *   POST /.netlify/functions/api-chat      body: {kind:'gemini', key, model, payload}
 * API Key 由前端随请求发送，仅转发给对应 AI 官方接口
 */
export default async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method Not Allowed' }, 405);
  }

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return json({ error: 'bad json' }, 400);
  }

  const key = body.key || '';
  if (!key) return json({ error: 'missing api key' }, 400);

  const kind = body.kind || 'openai';
  try {
    if (kind === 'anthropic') {
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(body.payload || {}),
      });
      return relay(upstream);
    }
    if (kind === 'gemini') {
      if (!body.model) return json({ error: 'missing model' }, 400);
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
        encodeURIComponent(body.model) + ':generateContent?key=' + encodeURIComponent(key);
      const upstream = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body.payload || {}),
      });
      return relay(upstream);
    }
    // openai 兼容
    const baseUrl = String(body.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
    const upstream = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify(body.payload || {}),
    });
    return relay(upstream);
  } catch (e) {
    return json({ error: 'proxy failed: ' + e.message }, 502);
  }
};

async function relay(upstream) {
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: { 'Content-Type': 'application/json' },
  });
}
