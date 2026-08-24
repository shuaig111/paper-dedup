/* ============================================================
 * AI 省钱精修（混合降重）核心逻辑
 * 思路：离线规则引擎全量处理（免费）→ 找出仍与原文高度相似的
 * 句子 → 只把这些句子交给 AI 精修 → 替换回正文。
 * 效果不降、费用大降：AI 调用量通常只有全文的 10~30%。
 * 依赖 js/checker.js（RepCheck）
 * ============================================================ */
(function (global) {
  'use strict';

  const RepCheck = (typeof global.RepCheck !== 'undefined') ? global.RepCheck : require('./checker.js');

  /* 选择需要精修的句子：改写文 vs 原文，相似度 ≥ thresh
   * 返回 [{ sim, sentence, orig }] 按相似度降序，上限 maxTasks */
  function selectSentences(orig, rewritten, thresh, maxTasks) {
    thresh = thresh || 0.55;
    const reps = RepCheck.sentenceReport(orig, rewritten, thresh);
    const out = reps.map(r => ({ sim: r.sim, sentence: r.text, orig: r.orig || '' }));
    if (maxTasks && out.length > maxTasks) out.length = maxTasks;
    return out;
  }

  /* 在段落文本中替换句子（替换首个出现；sentence 为空/未找到则不动） */
  function replaceInParagraph(para, sentence, replacement) {
    if (!sentence || !replacement) return { text: para, applied: false };
    const idx = para.indexOf(sentence);
    if (idx === -1) return { text: para, applied: false };
    return {
      text: para.slice(0, idx) + replacement + para.slice(idx + sentence.length),
      applied: true,
    };
  }

  /* 精修任务 prompt */
  function buildPrompt(original, candidate, modeDesc) {
    return '论文类型：' + modeDesc + '。\n下面这个句子与原文高度相似，请改写以显著降低相似度。要求：1) 保持原意、数据、公式与专有名词完全不变；2) 使用同义词替换、语序调整、句式重组等手法；3) 只输出改写后的句子本身，不要任何解释或引号。\n原文：' + original + '\n待改写：' + candidate;
  }

  /* 粗估 token 数（中文 1 字 ≈ 1 token，其余按 4 字符 ≈ 1 token） */
  function estimateTokens(text) {
    const s = String(text);
    const cjk = (s.match(/[\u4e00-\u9fa5]/g) || []).length;
    const other = s.replace(/[\u4e00-\u9fa5\s]/g, '').length;
    return Math.round(cjk + other / 4);
  }

  /* 统计精修预算 */
  function summarize(tasks, fullText) {
    const taskChars = tasks.reduce((s, t) => s + t.sentence.length + t.orig.length, 0);
    const fullTokens = estimateTokens(fullText);
    const taskTokens = Math.round(tasks.reduce((s, t) => s + estimateTokens(t.sentence) + estimateTokens(t.orig), 0));
    const saved = fullTokens > 0 ? Math.round((1 - taskTokens / fullTokens) * 100) : 0;
    return { taskChars: taskChars, taskTokens: taskTokens, fullTokens: fullTokens, savedPct: saved };
  }

  const api = {
    selectSentences: selectSentences,
    replaceInParagraph: replaceInParagraph,
    buildPrompt: buildPrompt,
    estimateTokens: estimateTokens,
    summarize: summarize,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Refine = api;
})(typeof window !== 'undefined' ? window : globalThis);
