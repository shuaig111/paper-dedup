/* ============================================================
 * PDF 读写：
 *  - parsePdf：用 pdf.js 抽取文本，尽力恢复段落结构
 *    （按 y 聚类成行 → 按行间距合并成段落，记录字号/加粗）
 *  - buildPdf：用 pdf-lib 生成 PDF（嵌入开源思源宋体，子集化）
 * 说明：PDF 是“打印格式”，复杂排版（多栏、公式对象、文本框）
 * 的文本抽取顺序可能失真，降重后按近似排版重新输出。
 * ============================================================ */
(function (global) {
  'use strict';

  /* fontkit：浏览器用全局变量（由 app.js 懒加载 fontkit.umd.min.js），
   * Node 测试环境用 require（与 pdfio.js 同目录下的 lib/） */
  let _fontkit = null;
  function getFontkit() {
    if (_fontkit) return _fontkit;
    if (global.fontkit) _fontkit = global.fontkit;
    else if (typeof require === 'function') {
      try { _fontkit = require('./lib/fontkit.umd.min.js'); } catch (e) { /* 忽略 */ }
    }
    return _fontkit;
  }

  /* ---------- 解析 ---------- */
  async function parsePdf(arrayBuffer, onProgress) {
    if (!global.pdfjsLib) throw new Error('pdf.js 未加载');
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const paragraphs = [];
    let bodySizeSum = 0, bodyCount = 0;
    const pageCount = pdf.numPages;

    for (let p = 1; p <= pageCount; p++) {
      if (onProgress) onProgress(p, pageCount);
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const items = tc.items.filter(it => it.str && it.str.trim());
      // 聚行：按 y 分组（PDF y 向上增长）
      const lines = [];
      for (const it of items) {
        const x = it.transform[4];
        const y = it.transform[5];
        const size = it.height || Math.abs(it.transform[0]) || 12;
        const bold = /bold|black|heavy|semibold|medium/i.test(it.fontName || '');
        let line = null;
        for (const l of lines) {
          if (Math.abs(l.y - y) <= 1.6) { line = l; break; }
        }
        if (!line) {
          line = { y: y, parts: [], size: size, bold: bold };
          lines.push(line);
        } else {
          if (size > line.size) line.size = size;
          if (bold) line.bold = true;
        }
        line.parts.push({ x: x, str: it.str });
      }
      lines.sort((a, b) => b.y - a.y);
      for (const l of lines) {
        l.parts.sort((a, b) => a.x - b.x);
        l.text = l.parts.map(q => q.str).join('').replace(/\s+/g, ' ').trim();
      }
      const nonEmpty = lines.filter(l => l.text);
      for (const l of nonEmpty) {
        bodySizeSum += l.size; bodyCount++;
      }
      paragraphs.push({ page: p, lines: nonEmpty });
    }

    // 计算正文平均字号
    const avgSize = bodyCount ? bodySizeSum / bodyCount : 12;

    // 行 → 段落
    const result = [];
    for (const pg of paragraphs) {
      const lines = pg.lines;
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const next = lines[i + 1];
        const gap = next ? (l.y - next.y) : 0;
        const isHeading = l.size > avgSize * 1.12 || (l.bold && l.size >= avgSize);
        const isLast = !next || gap > l.size * 1.7 || (!isHeading && next.size > avgSize * 1.12);
        const text = l.text;
        if (!text) continue;
        if (result.length && result[result.length - 1].heading === isHeading && !isHeading) {
          // 正文行与上一行是同一段（行间距小）
          const prev = result[result.length - 1];
          if (!prev.heading && prev.size !== undefined && Math.abs(prev.size - l.size) <= 2 && !isLast) {
            prev.text += text;
            prev.size = Math.max(prev.size, l.size);
            continue;
          }
        }
        result.push({ text: text, size: l.size, heading: isHeading });
      }
    }
    return { paragraphs: result, pageCount: pageCount, avgSize: avgSize };
  }

  /* ---------- 生成 ---------- */
  async function buildPdf(paragraphs, fontData) {
    if (!global.PDFLib) throw new Error('pdf-lib 未加载');
    const { PDFDocument, rgb } = PDFLib;
    const doc = await PDFDocument.create();
    const fk = getFontkit();
    if (fk) {
      try { doc.registerFontkit(fk); } catch (e) { /* 某些构建已内置 fontkit */ }
    }
    const font = await doc.embedFont(fontData, { subset: true });

    const PAGE_W = 595.28, PAGE_H = 841.89; // A4
    const MARGIN = 72; // 2.54cm
    const contentW = PAGE_W - MARGIN * 2;
    let page = doc.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;

    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    let baseSize = 12;
    for (const p of paragraphs) if (!p.heading) { baseSize = clamp(p.size || 12, 10.5, 12); break; }
    if (!baseSize) baseSize = 12;

    for (const para of paragraphs) {
      if (!para.text || !para.text.trim()) continue;
      const size = para.heading ? clamp((para.size || baseSize) + 1.5, 12, 18) : baseSize;
      const lineHeight = size * 1.7;
      const indent = para.heading ? 0 : size * 2;
      // 手动换行（中文按字折行）
      const words = wrapText(font, para.text.trim(), contentW - indent, size);
      if (y - lineHeight < MARGIN) {
        page = doc.addPage([PAGE_W, PAGE_H]);
        y = PAGE_H - MARGIN;
      }
      for (let w = 0; w < words.length; w++) {
        if (y - lineHeight < MARGIN) {
          page = doc.addPage([PAGE_W, PAGE_H]);
          y = PAGE_H - MARGIN;
        }
        const x = MARGIN + (w === 0 ? indent : 0);
        page.drawText(words[w], {
          x: x, y: y - lineHeight, size: size, font: font,
          color: para.heading ? rgb(0.10, 0.24, 0.55) : rgb(0.08, 0.08, 0.10),
        });
        y -= lineHeight;
      }
      y -= size * 0.6; // 段间距
    }
    return await doc.save();
  }

  function wrapText(font, text, maxWidth, size) {
    const lines = [];
    let cur = '';
    for (const ch of text) {
      if (ch === '\n') { lines.push(cur); cur = ''; continue; }
      const test = cur + ch;
      if (cur && font.widthOfTextAtSize(test, size) > maxWidth) {
        lines.push(cur);
        cur = ch;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }

  const api = { parsePdf: parsePdf, buildPdf: buildPdf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.PdfIO = api;
})(typeof window !== 'undefined' ? window : globalThis);
