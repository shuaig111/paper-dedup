/* ============================================================
 * 在线工具模块（免费 API，无需 Key）：
 *   - translate：中↔英翻译（MyMemory 免费 API，支持 CORS）
 *   - backTranslate：回译降重（中→英→中，经典降重手法）
 *   - searchUrls：在线学术检索跳转（知网/万方/维普/百度学术）
 *   - diagnose：网络连通性诊断（no-cors + 超时）
 * 注意：MyMemory 匿名额度约每日 5000 字符，长文请分段使用。
 * ============================================================ */
(function (global) {
  'use strict';

  const MYMEMORY = 'https://api.mymemory.translated.net/get';

  /* ---------- 分块（按句界，单块 ≤ maxChars） ---------- */
  function chunkText(text, maxChars) {
    maxChars = maxChars || 380;
    const out = [];
    const sents = String(text).split(/(?<=[。！？；.!?;\n])/);
    let cur = '';
    for (const s of sents) {
      if (!s) continue;
      if ((cur + s).length > maxChars && cur) {
        out.push(cur);
        cur = s;
      } else {
        cur += s;
      }
    }
    if (cur.trim()) out.push(cur);
    return out.map(c => c.trim()).filter(Boolean);
  }

  /* ---------- 单块翻译 ---------- */
  async function translateChunk(text, from, to) {
    const url = MYMEMORY + '?q=' + encodeURIComponent(text) + '&langpair=' + encodeURIComponent(from + '|' + to);
    const resp = await fetch(url, { method: 'GET' });
    if (!resp.ok) {
      const err = new Error('翻译服务返回 ' + resp.status);
      err.status = resp.status;
      throw err;
    }
    const data = await resp.json();
    if (data.responseStatus !== 200) {
      const err = new Error(data.responseDetails || ('翻译失败（' + data.responseStatus + '）'));
      err.status = data.responseStatus;
      throw err;
    }
    const t = data.responseData && data.responseData.translatedText;
    return t && t.trim() ? t.trim() : text;
  }

  /* ---------- 全文翻译（分块 + 并发 3） ---------- */
  async function translate(text, from, to, onProgress) {
    const chunks = chunkText(text);
    if (!chunks.length) return '';
    const results = new Array(chunks.length);
    let done = 0;
    async function worker(i) {
      results[i] = await translateChunk(chunks[i], from, to);
      done++;
      if (onProgress) onProgress(done, chunks.length);
    }
    let idx = 0;
    async function pump() {
      while (idx < chunks.length) {
        const i = idx++;
        await worker(i);
      }
    }
    await Promise.all([pump(), pump(), pump()]);
    return results.join('');
  }

  /* ---------- 回译降重：中 → 英 → 中 ---------- */
  async function backTranslate(text, onProgress) {
    const zh = await translate(text, 'zh-CN', 'en-GB', p => onProgress && onProgress(p, 2, '中→英'));
    const back = await translate(zh, 'en-GB', 'zh-CN', p => onProgress && onProgress(p, 2, '英→中'));
    return back;
  }

  /* ---------- 学术检索 URL ---------- */
  function searchUrls(keyword) {
    const kw = encodeURIComponent(keyword.trim());
    return [
      { name: '知网 CNKI', url: 'https://kns.cnki.net/kns8s/defaultresult/index?kw=' + kw },
      { name: '万方数据', url: 'https://s.wanfangdata.com.cn/paper?q=' + kw },
      { name: '维普', url: 'https://qikan.cqvip.com/Qikan/Search/Index?key=' + kw },
      { name: '百度学术', url: 'https://xueshu.baidu.com/s?wd=' + kw },
    ];
  }

  /* ---------- 网络连通性诊断（no-cors 探测 + 5s 超时） ---------- */
  const DIAG_TARGETS = [
    { name: 'DeepSeek API', url: 'https://api.deepseek.com' },
    { name: 'OpenAI API', url: 'https://api.openai.com' },
    { name: 'Anthropic API', url: 'https://api.anthropic.com' },
    { name: 'Gemini API', url: 'https://generativelanguage.googleapis.com' },
    { name: '翻译服务（MyMemory）', url: 'https://api.mymemory.translated.net' },
    { name: '中国知网', url: 'https://www.cnki.net' },
    { name: '万方数据', url: 'https://www.wanfangdata.com.cn' },
    { name: '百度', url: 'https://www.baidu.com' },
  ];

  async function diagnose(onItem) {
    const out = [];
    for (const t of DIAG_TARGETS) {
      const st = await probe(t.url);
      out.push({ name: t.name, ok: st });
      if (onItem) onItem(t.name, st);
    }
    return out;
  }

  function probe(url) {
    return new Promise(resolve => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => { ctrl.abort(); resolve(false); }, 5000);
      fetch(url, { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal })
        .then(() => { clearTimeout(timer); resolve(true); })
        .catch(() => { clearTimeout(timer); resolve(false); });
    });
  }

  const api = {
    translate: translate,
    translateChunk: translateChunk,
    backTranslate: backTranslate,
    chunkText: chunkText,
    searchUrls: searchUrls,
    diagnose: diagnose,
    DIAG_TARGETS: DIAG_TARGETS,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Online = api;
})(typeof window !== 'undefined' ? window : globalThis);
