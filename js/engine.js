/* ============================================================
 * 降重引擎：公式/术语保护 + 同义词替换 + 关联词句式变换
 *           + 主语变体 + 长句拆分 + 适度扩写
 * 依赖 js/dictionary.js（浏览器全局变量）或 CommonJS 导出。
 * ============================================================ */
(function (global) {
  'use strict';

  const MARK_START = '\uE000'; // 保护占位符（私有区字符，正常文本不会出现）
  const MARK_END = '\uE001';
  const WRAP_A = '\u0002'; // 改写标记（用于高亮显示）
  const WRAP_B = '\u0003';

  // 字典解析：浏览器中顶层 const 跨脚本可见；Node 中通过 require 获取
  const D = (typeof SYNONYM_DICT !== 'undefined')
    ? { SYNONYM_DICT, MATH_SYNONYMS, GENERAL_TERMS, MATH_TERMS, CONJ_PAIRS, SUBJECT_VARIANTS, EXPAND_PATTERNS, SPLIT_CONJUNCTIONS, TEMPLATE_PATTERNS, TEMPLATE_REGEX }
    : require('./dictionary.js');

  // 查重器（用于 runToTarget 达标迭代；可选依赖）
  const RepCheck = (typeof global.RepCheck !== 'undefined')
    ? global.RepCheck
    : (() => { try { return require('./checker.js'); } catch (e) { return null; } })();

  function escapeReg(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /* ---------- 可复现随机数（mulberry32） ---------- */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- 保护：把公式/编号/术语/数字/英文替换为占位符 ---------- */
  function protect(text, terms) {
    const items = [];
    const parts = [];
    if (terms && terms.length) {
      const sorted = terms.slice().sort((a, b) => b.length - a.length);
      parts.push(sorted.map(escapeReg).join('|'));
    }
    parts.push('\\$\\$[\\s\\S]+?\\$\\$|\\$[^$\\n]+?\\$|\\\\\\[[\\s\\S]+?\\\\\\]'); // 公式
    parts.push('\\[[\\d,\\-\\s]+\\]|（[\\d,\\-\\s]+）|\\([\\d,\\-\\s]+\\)'); // 引用/编号
    parts.push('(?:表|图|公式)\\s*[0-9一二三四五六七八九十]+(?:\\([0-9]+\\))?'); // 图表公式编号
    parts.push('[A-Za-z][A-Za-z0-9._\\-]{1,}'); // 英文词/缩写
    parts.push('[0-9]+(?:\\.[0-9]+)?%?(?:℃|°|元|万元|亿元|万|亿|km|cm|mm|kg|g|t|吨|人|次|年|月|日|小时|分钟|秒|个|种|项|倍|dB|Hz|kWh|度|平方米|平方公里|m|s|h|d)?'); // 数字+单位
    const re = new RegExp(parts.join('|'), 'g');
    text = text.replace(re, function (m) {
      items.push(m);
      return MARK_START + (items.length - 1) + MARK_END;
    });
    return { text: text, items: items };
  }

  function restore(text, items) {
    return text.replace(new RegExp(MARK_START + '(\\d+)' + MARK_END, 'g'), function (_, i) {
      return items[+i] !== undefined ? items[+i] : '';
    });
  }

  /* ---------- 分句（保留句末标点） ---------- */
  function splitSentences(text) {
    return text.match(/[^。！？；\r\n]+[。！？；]?/g) || [];
  }

  /* ---------- 同义词替换（一次扫描，随机选取） ---------- */
  function applyDictReplace(s, dict, ratio, rng, changes, type) {
    const keys = Object.keys(dict).sort((a, b) => b.length - a.length);
    const re = new RegExp(keys.map(escapeReg).join('|'), 'g');
    return s.replace(re, function (m) {
      if (rng() >= ratio) return m;
      const alts = dict[m];
      if (!alts || !alts.length) return m;
      const alt = alts[Math.floor(rng() * alts.length)];
      if (!alt || alt === m) return m;
      changes.push({ from: m, to: alt, type: type });
      return WRAP_A + alt + WRAP_B;
    });
  }

  /* ---------- 长句拆分：在“因此/从而/然而…”处断句 ---------- */
  const SPLIT_REPL = { '因此': '由此', '所以': '由此', '从而': '进而', '然而': '不过', '但是': '然而', '此外': '另外', '同时': '与此同时', '并且': '而且', '进而': '继而', '因而': '由此' };

  function splitLongSentence(s, rng, changes) {
    if (!s.includes('，')) return [s];
    const clauses = s.split('，');
    if (clauses.length < 4) return [s];
    for (let i = 1; i < clauses.length; i++) {
      const c = clauses[i];
      const conj = D.SPLIT_CONJUNCTIONS.find(k => c.indexOf(k) === 0);
      if (!conj) continue;
      if (rng() < 0.35) continue; // 部分句子保留原样，避免全文句式单一
      const left = clauses.slice(0, i).join('，');
      let right = clauses.slice(i).join('，');
      const repl = SPLIT_REPL[conj] || conj;
      right = right.replace(conj, repl);
      if (repl !== conj) changes.push({ from: conj, to: repl, type: 'split' });
      changes.push({ from: '长句', to: '拆分为两句', type: 'split' });
      return [left, right];
    }
    return [s];
  }

  /* ---------- 扩写 ---------- */
  function applyExpand(s, rng, changes) {
    for (const [from, to] of D.EXPAND_PATTERNS) {
      if (s.includes(from) && rng() < 0.55) {
        s = s.split(from).join(WRAP_A + to + WRAP_B);
        changes.push({ from: from, to: to, type: 'expand' });
      }
    }
    return s;
  }

  /* ---------- 论文套话模板替换（高频雷同句式专项改写） ---------- */
  function applyTemplates(s, rng, changes) {
    // 固定短语表
    const keys = Object.keys(D.TEMPLATE_PATTERNS).sort((a, b) => b.length - a.length);
    for (const key of keys) {
      if (!s.includes(key)) continue;
      if (rng() < 0.85) {
        const alts = D.TEMPLATE_PATTERNS[key];
        const alt = alts[Math.floor(rng() * alts.length)];
        if (alt && alt !== key) {
          s = s.split(key).join(WRAP_A + alt + WRAP_B);
          changes.push({ from: key, to: alt, type: 'template' });
        }
      }
    }
    // 正则模板表（跳过已包裹的片段，避免跨段污染）
    for (const [re, variants] of D.TEMPLATE_REGEX) {
      s = s.replace(re, (m) => {
        if (m.indexOf(WRAP_A) !== -1 || m.indexOf(WRAP_B) !== -1) return m;
        if (rng() >= 0.85) return m;
        const variant = variants[Math.floor(rng() * variants.length)];
        const alt = m.replace(re, variant);
        if (alt && alt !== m) {
          changes.push({ from: m.slice(0, 40), to: alt.slice(0, 40), type: 'template' });
          return WRAP_A + alt + WRAP_B;
        }
        return m;
      });
    }
    return s;
  }

  /* ---------- 主入口 ---------- */
  function run(text, opts) {
    opts = opts || {};
    const mode = opts.mode || 'general';
    const strength = opts.strength || 'standard';
    const useSynonym = opts.useSynonym !== undefined ? opts.useSynonym : true;
    const useConj = opts.useConj !== undefined ? opts.useConj : true;
    const useSplit = opts.useSplit !== undefined ? opts.useSplit : true;
    const useExpand = opts.useExpand !== undefined ? opts.useExpand : false;
    // 套话模板：strong / ultra 档默认启用（极强档强制启用）
    const useTemplate = opts.useTemplate !== undefined ? opts.useTemplate : (strength === 'strong' || strength === 'ultra');
    const ratios = { conservative: 0.4, standard: 0.6, strong: 0.82, ultra: 0.92 };
    const ratio = ratios[strength] || 0.6;
    const seed = opts.seed !== undefined && opts.seed !== null && opts.seed !== ''
      ? (Number(opts.seed) >>> 0) || 1
      : (Date.now() >>> 0);
    const rng = mulberry32(seed);
    const changes = [];

    if (!text || !text.trim()) {
      return { text: '', marked: '', changes: [], stats: { origChars: 0, newChars: 0, sentences: 0, changeCount: 0, seed: seed } };
    }

    // 合并词典与术语（支持界面自定义保护词）
    const dict = Object.assign({}, D.SYNONYM_DICT);
    const terms = D.GENERAL_TERMS.slice();
    if (opts.customTerms && opts.customTerms.length) {
      for (const t of opts.customTerms) {
        const tt = String(t).trim();
        if (tt && terms.indexOf(tt) === -1) terms.push(tt);
      }
    }
    if (mode === 'math') {
      Object.assign(dict, D.MATH_SYNONYMS);
      terms.push.apply(terms, D.MATH_TERMS);
    }

    // 1) 保护
    const prot = protect(text, terms);
    let body = prot.text;

    // 2) 分句处理
    const sentences = splitSentences(body);
    const outParts = [];
    for (const sent of sentences) {
      const m = sent.match(/[。！？；]+$/);
      const punct = m ? m[0] : '';
      let core = punct ? sent.slice(0, -punct.length) : sent;

      let pieces = [core];
      if (useSplit) pieces = splitLongSentence(pieces[0], rng, changes);

      const processed = [];
      for (let p of pieces) {
        if (useTemplate) p = applyTemplates(p, rng, changes);
        if (useSynonym) p = applyDictReplace(p, dict, ratio, rng, changes, 'synonym');
        if (useConj) p = applyDictReplace(p, D.CONJ_PAIRS, 0.8, rng, changes, 'conjunction');
        if (useConj) p = applyDictReplace(p, D.SUBJECT_VARIANTS, 0.7, rng, changes, 'subject');
        if (useExpand) p = applyExpand(p, rng, changes);
        processed.push(p);
      }
      if (processed.length === 1) {
        outParts.push(processed[0] + punct);
      } else {
        outParts.push(processed[0] + punct, processed[1] + '。');
      }
    }

    const markedBody = outParts.join('');
    const marked = restore(markedBody, prot.items);
    const plain = marked.replace(/\u0002|\u0003/g, '');
    const origChars = text.replace(/\s+/g, '').length;
    const newChars = plain.replace(/\s+/g, '').length;
    const sentenceCount = splitSentences(plain).length;

    return {
      text: plain,
      marked: marked,
      changes: changes,
      stats: { origChars: origChars, newChars: newChars, sentences: sentenceCount, changeCount: changes.length, seed: seed },
    };
  }

  /* ---------- 目标重复率达标迭代 ----------
   * 从指定档位起逐级加强（standard → strong → ultra），每轮估算
   * 改写文与原文的重复率，直到 < targetRate（百分数）或打满最强档。
   * 返回 { result, rounds, reached, finalRate }
   */
  function runToTarget(text, opts, targetRate) {
    opts = opts || {};
    const levels = ['conservative', 'standard', 'strong', 'ultra'];
    const startIdx = Math.max(levels.indexOf(opts.strength || 'standard'), 0);
    const rounds = [];
    let result = null;
    for (let i = startIdx; i < levels.length; i++) {
      const level = levels[i];
      const r = run(text, Object.assign({}, opts, {
        strength: level,
        useTemplate: true, // 达标迭代强制启用套话模板
      }));
      result = r;
      let rate = 1;
      if (RepCheck) {
        const est = RepCheck.estimateSimilarity(text, r.text);
        if (est) rate = est.rate;
      }
      rounds.push({ level: level, rate: rate });
      if (rate * 100 < targetRate) break;
    }
    const finalRate = rounds.length ? rounds[rounds.length - 1].rate : 1;
    return { result: result, rounds: rounds, reached: finalRate * 100 < targetRate, finalRate: finalRate };
  }

  const api = { run: run, runToTarget: runToTarget, protect: protect, restore: restore, splitSentences: splitSentences, mulberry32: mulberry32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.DedupEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
