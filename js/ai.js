/* ============================================================
 * 多服务商 AI 接入统一封装
 * 支持：
 *   deepseek   — DeepSeek 官方
 *   openai     — OpenAI GPT
 *   anthropic  — Anthropic Claude
 *   gemini     — Google Gemini（支持浏览器直连）
 *   custom     — 任意 OpenAI 兼容端点（Kimi/智谱/通义/OpenRouter/硅基流动…）
 * 调用路径：http 模式走本地服务代理（/api/chat*），file:// 模式直连
 * ============================================================ */
(function (global) {
  'use strict';

  const PROVIDERS = [
    {
      id: 'deepseek',
      name: 'DeepSeek（深度求索）',
      type: 'openai',
      apiBase: 'https://api.deepseek.com',
      models: ['deepseek-chat', 'deepseek-reasoner'],
      keyHint: '在 platform.deepseek.com 申请',
      defaultModel: 'deepseek-chat',
    },
    {
      id: 'openai',
      name: 'OpenAI（GPT）',
      type: 'openai',
      apiBase: 'https://api.openai.com/v1',
      models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'o3-mini', 'gpt-3.5-turbo'],
      keyHint: '在 platform.openai.com 申请',
      defaultModel: 'gpt-4o-mini',
    },
    {
      id: 'anthropic',
      name: 'Anthropic（Claude）',
      type: 'anthropic',
      apiBase: 'https://api.anthropic.com',
      models: ['claude-3-5-haiku-20241022', 'claude-sonnet-4-20250514', 'claude-3-7-sonnet-20250219', 'claude-opus-4-20250514'],
      keyHint: '在 console.anthropic.com 申请',
      defaultModel: 'claude-3-5-haiku-20241022',
    },
    {
      id: 'gemini',
      name: 'Google（Gemini）',
      type: 'gemini',
      apiBase: 'https://generativelanguage.googleapis.com',
      models: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.5-pro', 'gemini-1.5-pro'],
      keyHint: '在 aistudio.google.com 申请（支持浏览器直连）',
      defaultModel: 'gemini-2.5-flash',
    },
    {
      id: 'custom',
      name: '自定义（OpenAI 兼容）',
      type: 'openai',
      apiBase: '',
      models: ['自定义模型名'],
      keyHint: 'Kimi/智谱/通义/OpenRouter/硅基流动等任意 OpenAI 兼容服务',
      defaultModel: '',
      editable: true,
    },
  ];

  function getProvider(id) {
    return PROVIDERS.find(p => p.id === id) || PROVIDERS[0];
  }

  /* 模型价格分档（帮助省钱：默认推荐经济型） */
  const PRICE_TAGS = {
    'deepseek-chat': 'cheap',
    'deepseek-reasoner': 'mid',
    'gpt-4o-mini': 'cheap', 'gpt-3.5-turbo': 'cheap',
    'gpt-4o': 'mid', 'gpt-4.1': 'mid', 'gpt-4.1-mini': 'mid', 'o3-mini': 'mid',
    'claude-3-5-haiku-20241022': 'cheap',
    'claude-sonnet-4-20250514': 'mid', 'claude-3-7-sonnet-20250219': 'mid',
    'claude-opus-4-20250514': 'high',
    'gemini-2.5-flash': 'cheap', 'gemini-2.0-flash': 'cheap', 'gemini-1.5-flash': 'cheap',
    'gemini-2.5-pro': 'mid', 'gemini-1.5-pro': 'mid',
  };
  const PRICE_LABEL = {
    cheap: '🟢 经济',
    mid: '🟡 标准',
    high: '🔴 高配',
    unknown: '❔ 未知',
  };
  function priceOf(model) {
    return PRICE_TAGS[model] || 'unknown';
  }
  function priceLabel(model) {
    return PRICE_LABEL[priceOf(model)];
  }

  const STORE = {
    getKey(p) { try { return localStorage.getItem('dsh_pp_ai_key_' + p) || ''; } catch (e) { return ''; } },
    setKey(p, v) { try { localStorage.setItem('dsh_pp_ai_key_' + p, v); } catch (e) { /* ignore */ } },
    getModel(p) { try { return localStorage.getItem('dsh_pp_ai_model_' + p) || ''; } catch (e) { return ''; } },
    setModel(p, v) { try { localStorage.setItem('dsh_pp_ai_model_' + p, v); } catch (e) { /* ignore */ } },
    getBase(p) { try { return localStorage.getItem('dsh_pp_ai_base_' + p) || ''; } catch (e) { return ''; } },
    setBase(p, v) { try { localStorage.setItem('dsh_pp_ai_base_' + p, v); } catch (e) { /* ignore */ } },
  };

  function errMsg(e) {
    const status = e && e.status;
    if (status === 401 || status === 403) return 'API Key 无效或没有权限（HTTP ' + status + '），请检查 Key 是否正确';
    if (status === 429) return '请求过于频繁或额度用尽（HTTP 429），请稍后再试或检查账户余额';
    if (status === 404) return '模型名称不存在（HTTP 404），请检查模型选择是否正确';
    if (status === 402) return '账户余额不足（HTTP 402）';
    if (status === 400) return '请求被拒绝（HTTP 400）：' + (e.detail || '参数有误');
    if (e && e.type === 'cors') return '浏览器跨域限制：请用 start.bat 启动本地服务后再调用该服务商';
    if (e && (e.name === 'TypeError' || /fetch|network|Failed to fetch/i.test(e.message || ''))) {
      return '网络连接失败（服务商接口不可达或跨域限制），请检查网络，或使用 start.bat 本地服务模式';
    }
    return e && e.message ? e.message : String(e);
  }

  /* ---------- 组装各家的请求体（纯函数，便于测试） ---------- */
  function buildOpenAIPayload(model, system, user, maxTokens) {
    return {
      model: model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.9,
      max_tokens: maxTokens,
      stream: false,
    };
  }

  function buildAnthropicPayload(model, system, user, maxTokens) {
    return {
      model: model,
      system: system,
      messages: [{ role: 'user', content: user }],
      max_tokens: maxTokens,
    };
  }

  function buildGeminiPayload(model, system, user, maxTokens) {
    return {
      contents: [{ role: 'user', parts: [{ text: user }] }],
      systemInstruction: { parts: [{ text: system }] },
      generationConfig: { temperature: 0.9, maxOutputTokens: maxTokens },
    };
  }

  /* ---------- 解析各家响应 ---------- */
  function parseResponse(provider, data) {
    const p = getProvider(provider);
    if (p.type === 'anthropic') {
      if (data && data.content && data.content.length) {
        return data.content.map(c => c.text || '').join('');
      }
      throw new Error('Claude 返回内容为空' + (data && data.error ? '：' + data.error.message : ''));
    }
    if (p.type === 'gemini') {
      if (data && data.candidates && data.candidates.length && data.candidates[0].content) {
        return data.candidates[0].content.parts.map(x => x.text || '').join('');
      }
      throw new Error('Gemini 返回内容为空' + (data && data.error ? '：' + data.error.message : ''));
    }
    // openai 兼容
    if (data && data.choices && data.choices[0] && data.choices[0].message) {
      return data.choices[0].message.content || '';
    }
    throw new Error('返回内容为空' + (data && data.error && data.error.message ? '：' + data.error.message : ''));
  }

  /* ---------- 主调用入口 ---------- */
  async function call(opts) {
    const provider = getProvider(opts.provider);
    const model = (opts.model || provider.defaultModel || '').trim();
    const key = (opts.key || '').trim();
    if (!model) throw new Error('请选择或填写模型名称');
    if (!key) throw new Error('请填写 ' + provider.name + ' 的 API Key（' + provider.keyHint + '）');
    const system = opts.system;
    const user = opts.user;
    const maxTokens = opts.maxTokens || 4096;
    const viaServer = opts.viaServer;

    if (provider.type === 'anthropic') {
      const payload = buildAnthropicPayload(model, system, user, maxTokens);
      if (viaServer) {
        return await proxy('/api/chat-anthropic', { kind: 'anthropic', key: key, payload: payload }, provider);
      }
      return await directAnthropic(payload, key);
    }
    if (provider.type === 'gemini') {
      const payload = buildGeminiPayload(model, system, user, maxTokens);
      if (viaServer) {
        return await proxy('/api/chat-gemini', { kind: 'gemini', key: key, payload: payload, model: model }, provider);
      }
      return await directGemini(payload, model, key);
    }
    // openai 兼容（deepseek / openai / custom）
    const baseUrl = (opts.baseUrl || provider.apiBase || '').replace(/\/+$/, '');
    if (!baseUrl) throw new Error('请填写 API 接口地址（Base URL）');
    const payload = buildOpenAIPayload(model, system, user, maxTokens);
    if (viaServer) {
      return await proxy('/api/chat', { kind: 'openai', key: key, baseUrl: baseUrl, payload: payload }, provider);
    }
    return await directOpenAI(payload, baseUrl, key);
  }

  async function proxy(path, body, provider) {
    const resp = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      let detail = '';
      try { const j = await resp.json(); detail = (j.error && j.error.message) || j.error || ''; } catch (e) { /* ignore */ }
      const err = new Error('HTTP ' + resp.status);
      err.status = resp.status;
      err.detail = detail;
      throw err;
    }
    const data = await resp.json();
    return parseResponse(provider.id, data);
  }

  async function directOpenAI(payload, baseUrl, key) {
    const resp = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      let detail = '';
      try { const j = await resp.json(); detail = (j.error && j.error.message) || j.error || ''; } catch (e) { /* ignore */ }
      const err = new Error('HTTP ' + resp.status);
      err.status = resp.status;
      err.detail = detail;
      throw err;
    }
    const data = await resp.json();
    return parseResponse('openai', data);
  }

  async function directAnthropic(payload, key) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      let detail = '';
      try { const j = await resp.json(); detail = (j.error && j.error.message) || j.error || ''; } catch (e) { /* ignore */ }
      const err = new Error('HTTP ' + resp.status);
      err.status = resp.status;
      err.detail = detail;
      throw err;
    }
    const data = await resp.json();
    return parseResponse('anthropic', data);
  }

  async function directGemini(payload, model, key) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key);
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      let detail = '';
      try { const j = await resp.json(); detail = (j.error && j.error.message) || j.error || ''; } catch (e) { /* ignore */ }
      const err = new Error('HTTP ' + resp.status);
      err.status = resp.status;
      err.detail = detail;
      throw err;
    }
    const data = await resp.json();
    return parseResponse('gemini', data);
  }

  const api = {
    PROVIDERS: PROVIDERS,
    getProvider: getProvider,
    call: call,
    errMsg: errMsg,
    STORE: STORE,
    priceOf: priceOf,
    priceLabel: priceLabel,
    buildOpenAIPayload: buildOpenAIPayload,
    buildAnthropicPayload: buildAnthropicPayload,
    buildGeminiPayload: buildGeminiPayload,
    parseResponse: parseResponse,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.AI = api;
})(typeof window !== 'undefined' ? window : globalThis);
