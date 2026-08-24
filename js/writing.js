/* ============================================================
 * 学术写作检查（写作辅助，非降重）
 * 检测：口语化表达、冗余结构、超长句、常见不规范表达，
 * 每条给出定位、原因与改写建议。
 * ============================================================ */
(function (global) {
  'use strict';

  /* 规则：{ re, reason, suggestion, type }
   * 每项返回 { text, index, reason, suggestion } */
  const RULES = [
    { type: 'colloquial', re: /非常之/g, reason: '口语化表达', suggestion: '改为“极其/十分”' },
    { type: 'colloquial', re: /特别特别|非常非常/g, reason: '重复强调，口语化', suggestion: '去掉重复，改为“非常/极为”' },
    { type: 'colloquial', re: /好多|挺多|挺大|蛮好|蛮大/g, reason: '口语化表达', suggestion: '改为“许多/较多/相当大”' },
    { type: 'colloquial', re: /很(大|好|快|多)的/g, reason: '“很+形容词”偏口语', suggestion: '改为“较大的/良好的/较快的/较多的”' },
    { type: 'colloquial', re: /越来越/g, reason: '口语化程度表达', suggestion: '改为“日益/逐渐/不断”' },
    { type: 'colloquial', re: /其实|真的|确实很/g, reason: '口语化语气词', suggestion: '学术写作中通常可直接删除或改“事实上/诚然”' },
    { type: 'colloquial', re: /有点|有点儿|稍微有点/g, reason: '口语化程度表达', suggestion: '改为“略有/稍显/一定程度地”' },
    { type: 'colloquial', re: /啥|咋|咋样|搞/g, reason: '口语词汇', suggestion: '使用规范书面语替代' },
    { type: 'colloquial', re: /等等等等/g, reason: '重复冗余', suggestion: '保留一个“等”即可' },
    { type: 'redundant', re: /进行(了|着)?(分析|研究|处理|计算|检测|测试|讨论|比较|优化|评估)/g, reason: '“进行+动词”冗余结构', suggestion: '直接使用动词，如“进行分析”→“分析”' },
    { type: 'redundant', re: /加以(分析|研究|处理|解决|说明|讨论|改进)/g, reason: '“加以+动词”冗余结构', suggestion: '直接使用动词，如“加以分析”→“分析”' },
    { type: 'redundant', re: /能够被/g, reason: '“能够被”冗余被动', suggestion: '改为“可以被/得以”或直接被动' },
    { type: 'redundant', re: /在…的过程中/g, reason: '套话冗余', suggestion: '多数情况可删除，直接叙述动作' },
    { type: 'redundant', re: /具有一定的(作用|意义|价值|影响)/g, reason: '“具有一定的”套话', suggestion: '改为“具有重要作用/意义”或具体化' },
    { type: 'long', re: null, reason: '超长句', suggestion: '建议拆分为 2~3 个短句（超过 80 字）' },
  ];

  /* 检查文本，返回问题列表 */
  function check(text) {
    const out = [];
    if (!text || !text.trim()) return out;
    for (const rule of RULES) {
      if (!rule.re) continue;
      const re = new RegExp(rule.re.source, 'g');
      let m;
      while ((m = re.exec(text)) !== null) {
        out.push({
          type: rule.type,
          text: m[0],
          index: m.index,
          reason: rule.reason,
          suggestion: rule.suggestion,
        });
      }
    }
    // 超长句检测
    const sents = String(text).split(/[。！？；]/);
    for (const s of sents) {
      const t = s.trim();
      if (t.length > 80) {
        out.push({
          type: 'long',
          text: t.slice(0, 60) + '…（全句 ' + t.length + ' 字）',
          index: -1,
          reason: '超长句',
          suggestion: '建议拆分为 2~3 个短句（超过 80 字）',
        });
      }
    }
    out.sort((a, b) => (a.index === -1 ? 1 : a.index) - (b.index === -1 ? 1 : b.index));
    return out;
  }

  /* 统计 */
  function summarize(issues) {
    const byType = {};
    for (const i of issues) byType[i.type] = (byType[i.type] || 0) + 1;
    return byType;
  }

  const api = { check: check, summarize: summarize, RULES: RULES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Writing = api;
})(typeof window !== 'undefined' ? window : globalThis);
