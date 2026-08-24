/* ============================================================
 * 本地查重估算器（仅供参考，非官方检测）
 * 原理：字符二元组（bigram）Jaccard 相似度
 *   - 滑动窗口对比改写文与原文，估算“与原文的重复率”
 *   - 全文内部两两对比，查找自我重复段落
 * 注意：知网/万方/维普等系统使用各自的算法（如连续相似片段、
 * 语义相似度），本估算值仅供降重过程的自我检查。
 * ============================================================ */
(function (global) {
  'use strict';

  function clean(s) { return String(s).replace(/\s+/g, ''); }

  function bigrams(s) {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  }

  function jaccard(a, b) {
    if (a.size === 0 && b.size === 0) return 1;
    let inter = 0;
    for (const x of a) if (b.has(x)) inter++;
    const union = a.size + b.size - inter;
    return union === 0 ? 0 : inter / union;
  }

  function windows(s, size, step) {
    const out = [];
    for (let i = 0; i + size <= s.length; i += step) out.push(s.slice(i, i + size));
    const tail = s.length > size ? s.slice(s.length - size) : s;
    if (tail.length > 0 && out[out.length - 1] !== tail) out.push(tail);
    return out;
  }

  function sentences(s) {
    return (String(s).match(/[^。！？；\r\n]+[。！？；]?/g) || []).map(t => t.trim()).filter(t => t.length >= 8);
  }

  /* 改写文与原文的窗口级重复率估算 */
  function estimateSimilarity(orig, rew) {
    const o = clean(orig), r = clean(rew);
    if (!o || !r) return null;
    const oWin = windows(o, 20, 10).map(bigrams);
    const rWin = windows(r, 20, 10);
    if (!oWin.length || !rWin.length) return null;
    let dup = 0;
    const per = [];
    for (const rw of rWin) {
      const rb = bigrams(rw);
      let best = 0;
      for (const ob of oWin) {
        const v = jaccard(rb, ob);
        if (v > best) best = v;
        if (best >= 0.95) break;
      }
      if (best >= 0.8) dup++;
      per.push(best);
    }
    return {
      rate: dup / rWin.length,
      dupWindows: dup,
      totalWindows: rWin.length,
      per: per,
    };
  }

  /* 改写文每句 vs 原文每句 的相似度报告（大文档自动抽样原文句子）
   * 返回项：{ sim, text, orig } — orig 为该句最相似的原文句（用于 AI 精修） */
  function sentenceReport(orig, rew, thresh, opts) {
    thresh = thresh || 0.5;
    opts = opts || {};
    let oS = sentences(orig).map(s => ({ t: s, b: bigrams(s) }));
    // 超大文档：抽样，控制对比量
    const MAX_ORIG = opts.maxOrig || 1500;
    if (oS.length > MAX_ORIG) {
      const step = Math.ceil(oS.length / MAX_ORIG);
      oS = oS.filter((_, i) => i % step === 0);
    }
    const rS = sentences(rew);
    const out = [];
    for (const s of rS) {
      const sb = bigrams(s);
      let best = 0, bestOrig = '';
      for (const o of oS) {
        const v = jaccard(sb, o.b);
        if (v > best) { best = v; bestOrig = o.t; }
        if (best >= 0.98) break;
      }
      if (best >= thresh) out.push({ sim: best, text: s, orig: bestOrig });
    }
    out.sort((a, b) => b.sim - a.sim);
    return out;
  }

  /* 全文内部重复段落自查（两两句子对比；超大文档只查邻近窗口） */
  function selfDuplicates(text) {
    const sents = sentences(text);
    const out = [];
    const n = sents.length;
    const WINDOW = n > 1500 ? 400 : n; // 大文档只与后续 400 句对比（覆盖常见复制粘贴场景）
    for (let i = 0; i < n; i++) {
      const bi = bigrams(sents[i]);
      const lim = Math.min(n, i + 1 + WINDOW);
      for (let j = i + 1; j < lim; j++) {
        const v = jaccard(bi, bigrams(sents[j]));
        if (v >= 0.85) {
          out.push({ sim: v, a: sents[i], b: sents[j] });
        }
      }
    }
    out.sort((x, y) => y.sim - x.sim);
    return out.slice(0, 30);
  }

  const api = {
    estimateSimilarity: estimateSimilarity,
    sentenceReport: sentenceReport,
    selfDuplicates: selfDuplicates,
    bigrams: bigrams,
    jaccard: jaccard,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.RepCheck = api;
})(typeof window !== 'undefined' ? window : globalThis);
