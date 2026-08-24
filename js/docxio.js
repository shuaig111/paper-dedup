/* ============================================================
 * DOCX 读写：解析 word/document.xml 的段落与公式，
 * 降重后按“段落级回写”生成新 docx——保留标题样式、字体、
 * 页边距、图片、表格等原有格式（仅段落内联格式会被统一）。
 * 依赖 js/zip.js
 * ============================================================ */
(function (global) {
  'use strict';

  const ZipIO = (typeof global.ZipIO !== 'undefined') ? global.ZipIO : require('./zip.js');

  const FM_START = '\uE100'; // 公式占位符（私有区字符）
  const FM_END = '\uE101';

  /* ---------- XML 实体解码 ---------- */
  function decodeEntities(s) {
    return s
      .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#([0-9]+);/g, (m, d) => String.fromCodePoint(parseInt(d, 10)))
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#160;/g, ' ');
  }

  function escapeXml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ---------- XML 词法扫描 ----------
   * token: {type:'open'|'close'|'selfclose'|'text'|'comment'|'cdata'|'pi', name, start, end}
   */
  function tokenize(xml) {
    const toks = [];
    const n = xml.length;
    let i = 0;
    while (i < n) {
      const lt = xml.indexOf('<', i);
      if (lt < 0) {
        if (lt !== i) toks.push({ type: 'text', name: '', start: i, end: n });
        break;
      }
      if (lt > i) toks.push({ type: 'text', name: '', start: i, end: lt });
      if (xml.startsWith('<!--', lt)) {
        const e = xml.indexOf('-->', lt + 4);
        const end = e < 0 ? n : e + 3;
        toks.push({ type: 'comment', name: '', start: lt, end: end });
        i = end;
      } else if (xml.startsWith('<![CDATA[', lt)) {
        const e = xml.indexOf(']]>', lt + 9);
        const end = e < 0 ? n : e + 3;
        toks.push({ type: 'cdata', name: '', start: lt, end: end });
        i = end;
      } else if (xml.startsWith('<?', lt)) {
        const e = xml.indexOf('?>', lt + 2);
        const end = e < 0 ? n : e + 2;
        toks.push({ type: 'pi', name: '', start: lt, end: end });
        i = end;
      } else if (xml.startsWith('</', lt)) {
        const e = xml.indexOf('>', lt + 2);
        const end = e < 0 ? n : e + 1;
        toks.push({ type: 'close', name: xml.slice(lt + 2, end).trim().split(/[\s>]/)[0], start: lt, end: end });
        i = end;
      } else {
        // 开标签（可能自闭合）
        let e = lt + 1;
        let inQuote = null;
        for (; e < n; e++) {
          const c = xml[e];
          if (inQuote) { if (c === inQuote) inQuote = null; }
          else if (c === '"' || c === "'") inQuote = c;
          else if (c === '>') break;
        }
        if (e >= n) break;
        const raw = xml.slice(lt + 1, e);
        const selfClose = /\/\s*$/.test(raw);
        const name = raw.trim().split(/[\s/]/)[0];
        toks.push({ type: selfClose ? 'selfclose' : 'open', name: name, start: lt, end: e + 1 });
        i = e + 1;
      }
    }
    return toks;
  }

  /* ---------- 解析 document.xml → 段落列表 ----------
   * 同时记录“段落间隙”（body 级 sectPr、sectPr 前的空白等），
   * 回写时原样保留，避免丢失页面设置。 */
  function parseDocumentXml(xml) {
    const toks = tokenize(xml);
    const paragraphs = [];
    const segments = []; // [gap0, para0, gap1, para1, ..., gapN]
    let lastEnd = 0;
    let i = 0;
    while (i < toks.length) {
      const t = toks[i];
      if (t.type === 'open' && t.name === 'w:p') {
        // 找匹配的 </w:p>
        let depth = 1;
        let j = i + 1;
        while (j < toks.length && depth > 0) {
          const u = toks[j];
          if (u.type === 'open' && u.name === 'w:p') depth++;
          else if (u.type === 'close' && u.name === 'w:p') depth--;
          j++;
        }
        const endTok = toks[j - 1];
        segments.push(xml.slice(lastEnd, t.start));
        const raw = xml.slice(t.start, endTok.end);
        const info = extractParagraphInfo(toks, i, j, xml);
        segments.push(raw);
        paragraphs.push({ raw: raw, text: info.text, formulas: info.formulas, safe: info.safe });
        lastEnd = endTok.end;
        i = j;
      } else i++;
    }
    segments.push(xml.slice(lastEnd));
    return { paragraphs: paragraphs, segments: segments };
  }

  /* 从 token 区间提取段落文本（w:t 内容 + 公式占位）
   * safe=false：段落含文本框/图片/OLE 等对象，重建会丢失内容，调用方应跳过 */
  function extractParagraphInfo(toks, start, end, xml) {
    let text = '';
    const formulas = [];
    const stack = [];
    let safe = true;
    for (let i = start; i < end; i++) {
      const t = toks[i];
      if (t.type === 'open') {
        if (t.name === 'm:oMath' || t.name === 'm:oMathPara') {
          // 捕获公式原始 XML
          let depth = 1;
          let j = i + 1;
          while (j < end && depth > 0) {
            const u = toks[j];
            if (u.type === 'open' && (u.name === 'm:oMath' || u.name === 'm:oMathPara')) depth++;
            else if (u.type === 'close' && (u.name === 'm:oMath' || u.name === 'm:oMathPara')) depth--;
            j++;
          }
          const closeTok = toks[j - 1];
          formulas.push(xml.slice(t.start, closeTok.end));
          text += FM_START + (formulas.length - 1) + FM_END;
          i = j - 1;
          continue;
        }
        if (t.name === 'w:txbxContent' || t.name === 'w:drawing' || t.name === 'w:pict' ||
            t.name === 'w:object' || t.name === 'w:subDoc') {
          safe = false;
        }
        stack.push(t.name);
      } else if (t.type === 'close') {
        // 弹出到匹配的开标签
        for (let k = stack.length - 1; k >= 0; k--) {
          if (stack[k] === t.name) { stack.length = k; break; }
        }
      } else if (t.type === 'selfclose') {
        if (t.name === 'w:tab' || t.name === 'w:br') text += ' ';
      } else if (t.type === 'text') {
        if (stack.length && stack[stack.length - 1] === 'w:t') {
          text += decodeEntities(xml.slice(t.start, t.end));
        }
      }
    }
    return { text: text, formulas: formulas, safe: safe };
  }

  /* ---------- 重建段落（保留 pPr/sectPr，替换正文） ---------- */
  function rebuildParagraph(raw, newText, formulas) {
    const toks = tokenize(raw);
    let keep = '';
    // 提取 <w:pPr>...</w:pPr> 与 <w:sectPr>...</w:sectPr>
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.type === 'open' && (t.name === 'w:pPr' || t.name === 'w:sectPr')) {
        let depth = 1;
        let j = i + 1;
        while (j < toks.length && depth > 0) {
          const u = toks[j];
          if (u.type === 'open' && u.name === t.name) depth++;
          else if (u.type === 'close' && u.name === t.name) depth--;
          j++;
        }
        keep += raw.slice(t.start, toks[j - 1].end);
        i = j - 1;
      }
    }
    let body = escapeXml(newText);
    body = body.replace(new RegExp(FM_START + '(\\d+)' + FM_END, 'g'), (m, idx) => {
      return formulas[+idx] !== undefined ? formulas[+idx] : '';
    });
    return '<w:p>' + keep + '<w:r><w:t xml:space="preserve">' + body + '</w:t></w:r></w:p>';
  }

  /* ---------- 解析 docx ---------- */
  async function parseDocx(arrayBuffer) {
    const { entries } = await ZipIO.readZip(arrayBuffer);
    const docXmlEntry = entries['word/document.xml'];
    if (!docXmlEntry) throw new Error('不是有效的 DOCX 文件（缺少 word/document.xml）');
    const xml = new TextDecoder('utf-8').decode(docXmlEntry.data);
    const parsed = parseDocumentXml(xml);
    return { paragraphs: parsed.paragraphs, segments: parsed.segments, entries: entries, xml: xml };
  }

  /* ---------- 回写 docx（段落文本替换，保留段落间隙/节属性） ---------- */
  async function rebuildDocx(parsed, newTexts) {
    const paragraphs = parsed.paragraphs;
    const segments = parsed.segments || [];
    const out = [];
    if (segments.length) out.push(segments[0]);
    for (let i = 0; i < paragraphs.length; i++) {
      const p = paragraphs[i];
      const nt = newTexts[i];
      out.push(nt === null || nt === undefined ? p.raw : rebuildParagraph(p.raw, nt, p.formulas || []));
      const gapIdx = 2 + 2 * i;
      if (gapIdx < segments.length) out.push(segments[gapIdx]);
    }
    const newXml = out.join('');
    const entries = {};
    for (const k of Object.keys(parsed.entries)) {
      if (k === 'word/document.xml') {
        entries[k] = new TextEncoder().encode(newXml);
      } else {
        entries[k] = parsed.entries[k].data;
      }
    }
    const buffer = await ZipIO.writeZip(entries);
    return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  /* ---------- 从纯文本生成最小 docx（txt/md/doc 输入时输出用） ---------- */
  async function buildMinimalDocx(paragraphs) {
    const docXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body>' +
      paragraphs.map(p => {
        const t = escapeXml(p);
        return '<w:p><w:pPr><w:jc w:val="both"/><w:ind w:firstLineChars="200" w:firstLine="480"/></w:pPr>' +
          '<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体"/><w:sz w:val="24"/></w:rPr>' +
          '<w:t xml:space="preserve">' + t + '</w:t></w:r></w:p>';
      }).join('') +
      '</w:body></w:document>';

    const entries = {
      '[Content_Types].xml': textBytes('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '</Types>'),
      '_rels/.rels': textBytes('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>'),
      'word/_rels/document.xml.rels': textBytes('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>'),
      'word/styles.xml': textBytes('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>' +
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
        '</w:styles>'),
      'word/document.xml': textBytes(docXml),
    };
    const buffer = await ZipIO.writeZip(entries);
    return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  function textBytes(s) { return new TextEncoder().encode(s); }

  const api = { parseDocx: parseDocx, rebuildDocx: rebuildDocx, buildMinimalDocx: buildMinimalDocx, tokenize: tokenize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.DocxIO = api;
})(typeof window !== 'undefined' ? window : globalThis);
