/* ============================================================
 * 文件识别与纯文本类格式解析：
 *  - detectType：按扩展名识别格式
 *  - parsePlainText：txt / md / html / rtf → 段落数组
 *  - parseDocViaServer：.doc 老格式 → 走本地服务（word-extractor）
 * ============================================================ */
(function (global) {
  'use strict';

  function extOf(name) {
    const m = /\.([^.]+)$/.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }

  function detectType(name) {
    const e = extOf(name);
    switch (e) {
      case 'docx': return 'docx';
      case 'doc': return 'doc';
      case 'pdf': return 'pdf';
      case 'txt': return 'txt';
      case 'md': case 'markdown': return 'md';
      case 'rtf': return 'rtf';
      case 'html': case 'htm': return 'html';
      default: return null;
    }
  }

  function toParagraphs(lines) {
    const out = [];
    let cur = '';
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      if (!line.trim()) {
        if (cur.trim()) { out.push(cur.trim()); cur = ''; }
      } else {
        cur = cur ? cur + ' ' + line : line;
      }
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  /* txt / md：空行分段 */
  function parsePlainText(text) {
    return toParagraphs(text.split(/\r?\n/));
  }

  /* html：按块级元素分段，去标签 */
  function parseHtml(text) {
    const div = global.document ? document.createElement('div') : null;
    let body;
    const m = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(text);
    const core = m ? m[1] : text;
    if (div) {
      div.innerHTML = core;
      const blocks = div.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,blockquote,tr');
      const out = [];
      if (blocks.length) {
        blocks.forEach(b => {
          const t = (b.textContent || '').replace(/\s+/g, ' ').trim();
          if (t) out.push(t);
        });
        return out;
      }
      const t = (div.textContent || '').replace(/\s+/g, ' ').trim();
      return t ? [t] : [];
    }
    // Node 环境简单剥离
    const stripped = core
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ').trim();
    return stripped ? [stripped] : [];
  }

  /* rtf：简化解析（\par 分段，\uN 编码，忽略控制字） */
  function parseRtf(text) {
    const out = [];
    let cur = '';
    let i = 0;
    const n = text.length;
    while (i < n) {
      const c = text[i];
      if (c === '\\') {
        if (text.startsWith('\\par', i) || text.startsWith('\\line', i)) {
          if (cur.trim()) { out.push(cur.trim()); cur = ''; }
          i += 4;
          if (text[i] === ' ') i++;
          continue;
        }
        if (text.startsWith('\\u', i)) {
          const m = /^\\u(-?\d+)/.exec(text.slice(i));
          if (m) {
            const code = parseInt(m[1], 10);
            if (code > 0) cur += String.fromCharCode(code);
            i += m[0].length;
            // 跳过回退字符（通常 \'3f 或 ?）
            if (text[i] === '\\') {
              const m2 = /^\\'[0-9a-fA-F]{2}/.exec(text.slice(i));
              if (m2) i += m2[0].length;
            } else if (text[i] === '?') i++;
            continue;
          }
        }
        // 其他控制字：跳过（含可选参数与空格）
        const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(text.slice(i));
        if (m) { i += m[0].length; continue; }
        const m2 = /^\\'[0-9a-fA-F]{2}/.exec(text.slice(i));
        if (m2) { i += m2[0].length; continue; }
        if (text[i + 1] === '\\' || text[i + 1] === '{' || text[i + 1] === '}') { i += 2; continue; }
        i++;
        continue;
      }
      if (c === '{' || c === '}') { i++; continue; }
      cur += c;
      i++;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  /* .doc：走本地服务（server.js /api/parse-doc，word-extractor） */
  async function parseDocViaServer(arrayBuffer, name) {
    if (global.location && global.location.protocol !== 'http:' && global.location.protocol !== 'https:') {
      throw new Error('老版 .doc 格式需要本地服务解析：请用 start.bat 启动后上传，或在 Word/WPS 中另存为 .docx 再上传');
    }
    const resp = await fetch('/api/parse-doc?name=' + encodeURIComponent(name), {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: arrayBuffer,
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || ('解析失败（HTTP ' + resp.status + '）'));
    }
    const data = await resp.json();
    return data.paragraphs && data.paragraphs.length ? data.paragraphs : (data.text ? [data.text] : []);
  }

  const api = {
    extOf: extOf, detectType: detectType,
    parsePlainText: parsePlainText, parseHtml: parseHtml, parseRtf: parseRtf,
    parseDocViaServer: parseDocViaServer,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.FileIO = api;
})(typeof window !== 'undefined' ? window : globalThis);
