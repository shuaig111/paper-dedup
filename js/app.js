/* ============================================================
 * 应用逻辑：降重工作台 / 整篇论文上传（docx/pdf/doc/txt/md/rtf/html）
 * / 段落级降重 / 原格式导出 / 本地查重 / AI 改写 / 知识库
 * ============================================================ */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  const SAMPLES = {
    general: '近年来，随着信息技术的快速发展，网络安全问题日益突出，受到社会各界的广泛关注。本文针对当前网络入侵检测系统中存在的检测率低、误报率高的问题，提出了一种基于深度学习的入侵检测方法。该方法首先利用卷积神经网络对网络流量数据进行特征提取，然后通过长短期记忆网络对时序特征进行建模，最后采用Softmax分类器实现攻击类型的识别。实验结果表明，该方法在公开数据集上的检测准确率达到98.5%，明显优于传统的机器学习方法，具有较好的实用价值。',
    math: '针对城市突发公共事件的应急物资调配问题，本文建立了以最小化总配送时间为目标的多目标优化模型。首先，通过灰色关联分析筛选出影响物资需求的关键因素，利用熵权法确定各因素权重；其次，在考虑道路通行能力与时间窗约束的条件下，采用遗传算法对模型进行求解；最后，通过灵敏度分析验证了模型的鲁棒性。仿真结果表明，所提方案较传统方案配送效率提升23.6%，可为应急管理部门提供决策支持。',
  };

  let lastResult = null;   // 最近一次降重结果
  let highlightOn = false;
  let docSession = null;   // { format, name, paragraphs, parsed?, newTexts[], build(paragraphs)->Blob }
  let fontData = null;     // PDF 输出用中文字体缓存

  /* ---------------- 工具 ---------------- */
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function countCJK(s) { return (s.match(/[\u4e00-\u9fa5]/g) || []).length; }
  function statLine(s) {
    const cjk = countCJK(s);
    const sents = DedupEngine.splitSentences(s).length;
    return cjk + ' 汉字 · ' + s.length + ' 字符 · ' + sents + ' 句';
  }
  function download(name, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }
  function baseName(name) {
    return String(name).replace(/\.[^.]+$/, '');
  }
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector('script[data-src="' + src + '"]')) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.dataset.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('加载失败: ' + src));
      document.head.appendChild(s);
    });
  }
  async function ensurePdfjs() {
    if (!window.pdfjsLib) {
      await loadScript('js/lib/pdf.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/lib/pdf.worker.min.js';
    }
    return window.pdfjsLib;
  }
  async function ensurePdfLib() {
    if (!window.PDFLib) {
      await loadScript('js/lib/pdf-lib.min.js');
      if (!window.fontkit) await loadScript('js/lib/fontkit.umd.min.js');
    }
    return window.PDFLib;
  }
  async function getFont() {
    if (fontData) return fontData;
    const resp = await fetch('js/lib/NotoSerifSC-Regular.otf');
    if (!resp.ok) throw new Error('字体加载失败（HTTP ' + resp.status + '）');
    fontData = await resp.arrayBuffer();
    return fontData;
  }

  /* ---------------- Tab 切换 ---------------- */
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $('tab-' + btn.dataset.tab).classList.add('active');
    });
  });

  /* ---------------- 强度 → 策略默认值 ---------------- */
  const STRENGTH_DEFAULTS = {
    conservative: { synonym: true, conjunction: false, split: false, expand: false },
    standard: { synonym: true, conjunction: true, split: true, expand: false },
    strong: { synonym: true, conjunction: true, split: true, expand: true },
    ultra: { synonym: true, conjunction: true, split: true, expand: true },
  };
  $('opt-strength').addEventListener('change', e => {
    const d = STRENGTH_DEFAULTS[e.target.value] || STRENGTH_DEFAULTS.standard;
    $('opt-synonym').checked = d.synonym;
    $('opt-conjunction').checked = d.conjunction;
    $('opt-split').checked = d.split;
    $('opt-expand').checked = d.expand;
  });

  /* ---------------- 统计字数 + 草稿自动保存 ---------------- */
  let draftTimer = null;
  function saveDraft() {
    try { localStorage.setItem('dsh_pp_draft', $('input-text').value); } catch (e) { /* ignore */ }
  }
  $('input-text').addEventListener('input', () => {
    $('input-stat').textContent = statLine($('input-text').value);
    if (docSession) {
      // 用户手动修改了文档文本：原格式导出失效，退回纯文本模式
      clearDocSession();
      $('doc-hint').textContent = '⚠ 已手动编辑，原格式保留已关闭；如需格式导出请重新上传';
      $('doc-hint').style.color = '#b45309';
    }
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 400);
  });

  /* ---------------- 文档会话 ---------------- */
  function clearDocSession() {
    docSession = null;
    $('doc-badge').classList.add('hidden');
    $('doc-badge').innerHTML = '';
    $('btn-download').classList.add('hidden');
    $('out-format').textContent = '';
    delete $('out-format').dataset.fmtName;
  }

  function setDocSession(session) {
    docSession = session;
    const fmtName = { docx: 'Word(docx)', pdf: 'PDF', doc: 'Word(doc)', txt: 'TXT', md: 'Markdown', rtf: 'RTF', html: 'HTML' }[session.format] || session.format;
    $('out-format').dataset.fmtName = fmtName;
    $('out-format').textContent = '输出格式：' + fmtName;
    $('doc-badge').innerHTML = '<span class="fmt">' + esc(fmtName) + '</span>已载入：<b>' + esc(session.name) + '</b> · ' +
      session.paragraphs.length + ' 段 · ' + countCJK(session.paragraphs.map(p => p.text).join('')) + ' 字' +
      '<span class="x" title="移除文档">✕</span>';
    $('doc-badge').classList.remove('hidden');
    $('doc-badge').querySelector('.x').addEventListener('click', () => { clearDocSession(); });
    $('doc-hint').textContent = '整篇论文模式：逐段降重，下载保留原格式';
    $('doc-hint').style.color = '';
    $('input-text').value = session.paragraphs.map(p => p.text).join('\n\n');
    $('input-stat').textContent = statLine($('input-text').value);
    $('btn-download').classList.remove('hidden');
  }

  /* ---------------- 文件上传 ---------------- */
  $('btn-upload').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (f) loadFile(f);
    e.target.value = '';
  });

  const dropBox = $('input-text').parentElement;
  let dragDepth = 0;
  ['dragenter', 'dragover'].forEach(ev => dropBox.addEventListener(ev, e => {
    e.preventDefault();
    dragDepth++;
    $('drop-hint').classList.remove('hidden');
    dropBox.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach(ev => dropBox.addEventListener(ev, e => {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) {
      $('drop-hint').classList.add('hidden');
      dropBox.classList.remove('dragover');
    }
  }));
  dropBox.addEventListener('drop', e => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });

  async function loadFile(file) {
    const fmt = FileIO.detectType(file.name);
    if (!fmt) {
      alert('暂不支持该文件格式（' + file.name + '）。\n支持：docx / doc / pdf / txt / md / rtf / html');
      return;
    }
    try {
      const ab = await file.arrayBuffer();
      let session = null;
      if (fmt === 'docx') {
        const parsed = await DocxIO.parseDocx(ab);
        session = {
          format: 'docx', name: file.name,
          paragraphs: parsed.paragraphs.map(p => ({ text: p.text, safe: p.safe !== false })),
          parsed: parsed,
          build: async (newTexts) => DocxIO.rebuildDocx(parsed, newTexts),
        };
      } else if (fmt === 'pdf') {
        await ensurePdfjs();
        const res = await PdfIO.parsePdf(ab, (p, n) => {
          $('doc-hint').textContent = 'PDF 解析中：第 ' + p + ' / ' + n + ' 页…';
        });
        session = {
          format: 'pdf', name: file.name,
          paragraphs: res.paragraphs.map(q => ({ text: q.text, size: q.size, heading: q.heading })),
          meta: res,
          build: async (newTexts) => {
            await ensurePdfLib();
            const font = await getFont();
            const paras = newTexts.map((t, i) => ({
              text: t, size: res.paragraphs[i].size, heading: res.paragraphs[i].heading,
            }));
            const bytes = await PdfIO.buildPdf(paras, font);
            return new Blob([bytes], { type: 'application/pdf' });
          },
        };
      } else if (fmt === 'txt' || fmt === 'md') {
        const text = new TextDecoder('utf-8').decode(ab);
        const paras = FileIO.parsePlainText(text);
        session = {
          format: fmt, name: file.name,
          paragraphs: paras.map(t => ({ text: t })),
          build: async (newTexts) => new Blob([newTexts.join('\n\n')], { type: 'text/plain;charset=utf-8' }),
        };
      } else if (fmt === 'rtf') {
        const text = new TextDecoder('utf-8').decode(ab);
        const paras = FileIO.parseRtf(text);
        session = {
          format: 'rtf', name: file.name,
          paragraphs: paras.map(t => ({ text: t })),
          build: async (newTexts) => new Blob([buildRtf(newTexts)], { type: 'application/rtf' }),
        };
      } else if (fmt === 'html') {
        const text = new TextDecoder('utf-8').decode(ab);
        const paras = FileIO.parseHtml(text);
        session = {
          format: 'html', name: file.name,
          paragraphs: paras.map(t => ({ text: t })),
          build: async (newTexts) => new Blob([buildHtml(newTexts)], { type: 'text/html;charset=utf-8' }),
        };
      } else if (fmt === 'doc') {
        const paras = await FileIO.parseDocViaServer(ab, file.name);
        session = {
          format: 'doc', name: file.name,
          paragraphs: paras.map(t => ({ text: t })),
          build: async (newTexts) => DocxIO.buildMinimalDocx(newTexts),
        };
      }
      if (!session) return;
      setDocSession(session);
      $('doc-hint').textContent = fmt === 'doc' ? '老版 .doc 无法回写，导出将生成 .docx（Word/WPS 可打开）' : '整篇论文模式：逐段降重，下载保留原格式';
    } catch (e) {
      console.error(e);
      alert('文件解析失败：' + e.message);
    }
  }

  function buildRtf(paragraphs) {
    let body = '{\\rtf1\\ansi\\ansicpg936\\deff0{\\fonttbl{\\f0\\fnil\\fcharset134 宋体;}}\\f0\\fs24\n';
    for (const p of paragraphs) {
      let line = '';
      for (const ch of p) {
        const c = ch.codePointAt(0);
        if (c < 128) {
          line += (ch === '\\' || ch === '{' || ch === '}') ? '\\' + ch : ch;
        } else if (c <= 0x7FFF) {
          line += '\\u' + c + '?';
        } else {
          line += '\\u' + (c - 0x10000) + '?';
        }
      }
      body += line + '\\par\n';
    }
    return body + '}';
  }

  function buildHtml(paragraphs) {
    return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>降重结果</title></head><body>' +
      paragraphs.map(p => '<p>' + esc(p) + '</p>').join('\n') +
      '</body></html>';
  }

  /* ---------------- 示例 / 清空 ---------------- */
  $('btn-sample').addEventListener('click', () => {
    clearDocSession();
    const mode = $('opt-mode').value;
    $('input-text').value = SAMPLES[mode] || SAMPLES.general;
    $('input-stat').textContent = statLine($('input-text').value);
  });
  $('btn-clear').addEventListener('click', () => {
    clearDocSession();
    $('input-text').value = ''; $('output-text').value = '';
    $('input-stat').textContent = '0 汉字 · 0 字符 · 0 句';
    $('output-stat').textContent = '0 汉字 · 0 字符 · 0 句';
    $('doc-hint').textContent = '';
    try { localStorage.removeItem('dsh_pp_draft'); } catch (e) { /* ignore */ }
    lastResult = null;
    $('dedup-summary').textContent = '';
    $('diff-body').innerHTML = '';
    $('diff-empty').style.display = '';
    $('check-report').innerHTML = '<p class="empty-hint">点击“本地查重估算”生成报告。</p>';
    resetStats();
  });

  function resetStats() {
    $('st-orig-words').textContent = '-';
    $('st-new-words').textContent = '-';
    $('st-changes').textContent = '-';
    $('st-est-after').textContent = '-';
    $('st-self-dup').textContent = '-';
  }

  /* ---------------- 降重参数 ---------------- */
  function customTermsList() {
    return $('custom-terms').value.split(/\r?\n/).map(t => t.trim()).filter(Boolean);
  }
  function currentOpts() {
    return {
      mode: $('opt-mode').value,
      strength: $('opt-strength').value,
      useSynonym: $('opt-synonym').checked,
      useConj: $('opt-conjunction').checked,
      useSplit: $('opt-split').checked,
      useExpand: $('opt-expand').checked,
      seed: $('opt-seed').value,
      customTerms: customTermsList(),
    };
  }

  /* ---------------- 降重主流程 ---------------- */
  $('btn-dedup').addEventListener('click', async () => {
    const input = $('input-text').value;
    if (!input.trim()) { alert('请先输入文本或上传论文。'); return; }
    if (docSession) {
      await runDocDedup();
    } else {
      runTextDedup(input);
    }
  });

  function targetEnabled() {
    return $('opt-target-enable').checked;
  }
  function targetValue() {
    const v = parseInt($('opt-target').value, 10);
    return isNaN(v) ? 25 : Math.max(5, Math.min(60, v));
  }
  const LEVEL_NAMES = { conservative: '保守', standard: '标准', strong: '强力', ultra: '极强' };

  function runTextDedup(input) {
    if (targetEnabled()) { runTextIterate(input); return; }
    const result = DedupEngine.run(input, currentOpts());
    finishTextDedup(result, null);
  }

  /* 文本模式：目标重复率达标迭代 */
  async function runTextIterate(input) {
    const target = targetValue();
    const wrap = $('progress-wrap'), fill = $('progress-fill'), ptext = $('progress-text');
    wrap.classList.remove('hidden');
    const tt = DedupEngine.runToTarget(input, currentOpts(), target);
    const rounds = tt.rounds.map(r => LEVEL_NAMES[r.level] + ' ' + pct(r.rate)).join(' → ');
    fill.style.width = '100%';
    ptext.textContent = '达标迭代完成（' + rounds + '）';
    await new Promise(r => setTimeout(r, 30));
    finishTextDedup(tt.result, {
      target: target, rounds: tt.rounds, reached: tt.reached, finalRate: tt.finalRate, via: 'text',
    });
    wrap.classList.add('hidden');
  }

  function finishTextDedup(result, targetInfo) {
    lastResult = result;
    highlightOn = false;
    $('output-text').value = result.text;
    $('output-stat').textContent = statLine(result.text);
    $('st-orig-words').textContent = result.stats.origChars;
    $('st-new-words').textContent = result.stats.newChars;
    $('st-changes').textContent = result.stats.changeCount;
    if (targetInfo) {
      const rounds = targetInfo.rounds.map(r => LEVEL_NAMES[r.level] + ' ' + pct(r.rate)).join(' → ');
      const est = RepCheck.estimateSimilarity($('input-text').value, result.text);
      const finalPct = est ? pct(est.rate) : pct(targetInfo.finalRate);
      $('dedup-summary').textContent = targetInfo.reached
        ? '🎯 达标：目标 ≤' + targetInfo.target + '%，迭代 ' + targetInfo.rounds.length + ' 轮（' + rounds + '），最终估算重复率 ' + finalPct
        : '⚠ 已用最强档（极强），估算重复率 ' + finalPct + ' 仍高于目标 ' + targetInfo.target + '%。可尝试：勾选更多策略、开启“AI 精修”处理顽固片段';
    } else {
      $('dedup-summary').textContent = '随机种子 ' + result.stats.seed + '（相同输入+相同种子可复现同一结果）';
    }
    renderDiff(result.changes);
    runCheck(false);
  }

  async function runDocDedup() {
    const session = docSession;
    const paras = session.paragraphs;
    const opts = currentOpts();
    const target = targetEnabled() ? targetValue() : null;
    const levels = ['conservative', 'standard', 'strong', 'ultra'];
    const startIdx = Math.max(levels.indexOf(opts.strength), 0);
    const wrap = $('progress-wrap'), fill = $('progress-fill'), ptext = $('progress-text');
    wrap.classList.remove('hidden');

    const rounds = [];
    let final = null;

    for (let round = startIdx; round < levels.length; round++) {
      const level = levels[round];
      const newTextsR = new Array(paras.length).fill(null);
      const resultsR = new Array(paras.length).fill(null);
      const allChanges = [];
      let changeCount = 0;
      for (let i = 0; i < paras.length; i++) {
        const text = (paras[i].text || '').trim();
        if (!text || paras[i].safe === false) continue;
        const r = DedupEngine.run(text, Object.assign({}, opts, { strength: level, useTemplate: true }));
        resultsR[i] = r;
        if (r.text && r.text !== text) {
          newTextsR[i] = r.text;
          changeCount += r.changes.length;
          if (allChanges.length < 400) allChanges.push.apply(allChanges, r.changes.slice(0, 400 - allChanges.length));
        }
        if (i % 20 === 0) {
          fill.style.width = Math.round((i / paras.length) * 100) + '%';
          ptext.textContent = (target ? '第 ' + (round - startIdx + 1) + ' 轮（' + LEVEL_NAMES[level] + '）' : '') + '正在降重第 ' + (i + 1) + ' / ' + paras.length + ' 段…';
          await new Promise(r2 => setTimeout(r2, 0));
        }
      }
      const origJoined = paras.map(p => p.text).join('\n\n');
      const joined = newTextsR.map((t, i) => t !== null ? t : (paras[i].text || '')).join('\n\n');
      const est = RepCheck.estimateSimilarity(origJoined, joined);
      const rate = est ? est.rate : 1;
      rounds.push({ level: level, rate: rate });
      final = { level: level, rate: rate, newTexts: newTextsR, results: resultsR, allChanges: allChanges, changeCount: changeCount, joined: joined, origJoined: origJoined };
      if (!target || rate * 100 < target) break;
    }

    fill.style.width = '100%';
    ptext.textContent = '完成，正在汇总…';
    await new Promise(r2 => setTimeout(r2, 30));

    // 汇总输出
    const markedParts = paras.map((p, i) => {
      if (final.results[i]) return final.results[i].marked;
      return p.text || '';
    });
    const plain = final.joined;
    const newChars = plain.replace(/\s+/g, '').length;
    const origChars = final.origJoined.replace(/\s+/g, '').length;

    session.newTexts = final.newTexts;
    lastResult = {
      text: plain,
      marked: markedParts.join('\n\n'),
      changes: final.allChanges,
      stats: { origChars: origChars, newChars: newChars, sentences: DedupEngine.splitSentences(plain).length, changeCount: final.changeCount, seed: '-', docMode: true },
    };
    highlightOn = false;
    $('output-text').value = plain;
    $('output-stat').textContent = statLine(plain);
    $('st-orig-words').textContent = origChars;
    $('st-new-words').textContent = newChars;
    $('st-changes').textContent = final.changeCount;
    if (target) {
      const roundsStr = rounds.map(r => LEVEL_NAMES[r.level] + ' ' + pct(r.rate)).join(' → ');
      const reached = final.rate * 100 < target;
      $('dedup-summary').textContent = reached
        ? '🎯 达标：目标 ≤' + target + '%，迭代 ' + rounds.length + ' 轮（' + roundsStr + '），最终估算重复率 ' + pct(final.rate) + '。点击“下载结果（原格式）”导出为 ' + $('out-format').dataset.fmtName + ' 文件'
        : '⚠ 已用最强档（极强），估算重复率 ' + pct(final.rate) + ' 仍高于目标 ' + target + '%。可开启“AI 精修”处理顽固片段后下载';
    } else {
      $('dedup-summary').textContent = '整篇论文降重完成：共处理 ' + paras.length + ' 段（' + LEVEL_NAMES[final.level] + '档）。点击“下载结果（原格式）”导出为 ' + $('out-format').dataset.fmtName + ' 文件';
    }
    renderDiff(final.allChanges);
    runCheck(false);
    wrap.classList.add('hidden');
  }

  /* ---------------- 下载（原格式） ---------------- */
  $('btn-download').addEventListener('click', async () => {
    const session = docSession;
    if (!session) return;
    const btn = $('btn-download');
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = '正在生成…';
    try {
      const newTexts = (session.newTexts || session.paragraphs.map(() => null))
        .map((t, i) => t !== null ? t : (session.paragraphs[i].text || ''));
      const blob = await session.build(newTexts);
      const extMap = { docx: 'docx', pdf: 'pdf', doc: 'docx', txt: 'txt', md: 'md', rtf: 'rtf', html: 'html' };
      const ext = extMap[session.format] || 'txt';
      const isDoc = session.format === 'doc';
      download(baseName(session.name) + '-降重后.' + ext, blob, 'application/octet-stream');
      btn.textContent = old + '（已生成' + (isDoc ? ' .docx' : ' .' + ext) + '）';
    } catch (e) {
      console.error(e);
      alert('导出失败：' + e.message + '\n（PDF 导出需要以 start.bat 本地服务方式运行）');
    } finally {
      btn.disabled = false;
      setTimeout(() => { btn.textContent = old; }, 2500);
    }
  });

  /* ---------------- 改写明细 ---------------- */
  function renderDiff(changes) {
    const body = $('diff-body');
    body.innerHTML = '';
    $('diff-empty').style.display = changes.length ? 'none' : '';
    const TYPE_NAMES = { synonym: '同义词', conjunction: '关联词', subject: '主语变体', split: '句式', expand: '扩写' };
    changes.slice(0, 300).forEach((c, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td>' + (i + 1) + '</td>' +
        '<td class="from">' + esc(c.from) + '</td>' +
        '<td class="to">' + esc(c.to) + '</td>' +
        '<td><span class="type-tag">' + (TYPE_NAMES[c.type] || c.type) + '</span></td>';
      body.appendChild(tr);
    });
    if (changes.length > 300) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="4" style="color:#94a3b8">…仅显示前 300 条，共 ' + changes.length + ' 条</td>';
      body.appendChild(tr);
    }
  }

  /* ---------------- 高亮改写处 ---------------- */
  $('btn-highlight').addEventListener('click', () => {
    if (!lastResult) { alert('请先点击“开始降重”。'); return; }
    if (!lastResult.marked) { alert('当前结果没有改写标记（AI 改写/手动内容不支持高亮）。'); return; }
    highlightOn = !highlightOn;
    if (highlightOn) {
      const marked = lastResult.marked;
      const div = document.createElement('div');
      div.innerHTML = esc(marked).replace(/\u0002/g, '<mark class="rewrite">').replace(/\u0003/g, '</mark>');
      $('output-text').value = div.textContent;
      $('btn-highlight').style.borderColor = '#f59e0b';
      $('btn-highlight').style.color = '#b45309';
    } else {
      $('output-text').value = lastResult.text;
      $('btn-highlight').style.borderColor = '';
      $('btn-highlight').style.color = '';
    }
  });

  /* ---------------- 复制 / 导出 ---------------- */
  $('btn-copy').addEventListener('click', async () => {
    const v = $('output-text').value;
    if (!v) { alert('没有可复制的内容。'); return; }
    try {
      await navigator.clipboard.writeText(v);
      alert('已复制到剪贴板。');
    } catch (e) {
      $('output-text').select();
      document.execCommand('copy');
      alert('已复制（兼容模式）。');
    }
  });

  $('btn-export-doc').addEventListener('click', async () => {
    const v = $('output-text').value;
    if (!v) { alert('没有可导出的内容。'); return; }
    const paras = v.split(/\r?\n+/).map(t => t.trim()).filter(Boolean);
    const blob = await DocxIO.buildMinimalDocx(paras);
    download('论文降重结果.docx', blob, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });

  $('btn-export-txt').addEventListener('click', () => {
    const v = $('output-text').value;
    if (!v) { alert('没有可导出的内容。'); return; }
    download('论文降重结果.txt', v, 'text/plain;charset=utf-8');
  });

  /* ---------------- 本地查重估算 ---------------- */
  $('btn-check').addEventListener('click', () => runCheck(true));

  function pctClass(v) { return v >= 0.5 ? 'pct-high' : v >= 0.3 ? 'pct-mid' : 'pct-low'; }
  function pct(v) { return (v * 100).toFixed(1) + '%'; }

  function runCheck(manual) {
    const orig = $('input-text').value;
    const rew = $('output-text').value;
    const report = $('check-report');
    if (!orig.trim()) { report.innerHTML = '<p class="empty-hint">原文为空，无法估算。</p>'; return; }
    if (!rew.trim()) { report.innerHTML = '<p class="empty-hint">请先点击“开始降重”生成结果，再进行估算。</p>'; return; }

    const est = RepCheck.estimateSimilarity(orig, rew);
    const selfOrig = RepCheck.selfDuplicates(orig);
    const selfRew = RepCheck.selfDuplicates(rew);
    const sentRep = RepCheck.sentenceReport(orig, rew, 0.55);

    $('st-est-after').textContent = est ? pct(est.rate) : '-';
    $('st-self-dup').textContent = selfRew.length;

    let html = '';
    if (est) {
      html += '<div class="check-item"><span class="label">改写文与原文相似度估算（字符 n-gram 窗口重叠）：</span> ' +
        '<span class="pct ' + pctClass(est.rate) + '">' + pct(est.rate) + '</span>' +
        ' <span class="snippet">（' + est.dupWindows + '/' + est.totalWindows + ' 个窗口与原文高度相似）</span></div>';
    }
    html += '<div class="check-item"><span class="label">疑似与原文高度相似的句子（相似度 ≥ 55%，按相似度降序）：</span></div>';
    if (sentRep.length === 0) {
      html += '<div class="check-item"><span class="snippet">未发现。改写较充分。👍</span></div>';
    } else {
      sentRep.slice(0, 10).forEach(r => {
        html += '<div class="check-item susp"><span class="pct ' + pctClass(r.sim) + '">' + pct(r.sim) + '</span> ' + esc(r.text) + '</div>';
      });
    }
    html += '<div class="check-item"><span class="label">原文内部重复段落自查（复制粘贴检测）：</span> ' +
      '<b>' + selfOrig.length + '</b> 组相似句对' +
      (selfOrig.length ? '<div class="snippet">' + selfOrig.slice(0, 5).map(d => esc(d.a.slice(0, 60)) + '… ≈ ' + esc(d.b.slice(0, 60)) + '…').join('<br>') + '</div>' : '') + '</div>';
    html += '<div class="check-item"><span class="label">改写文内部重复段落自查：</span> <b>' + selfRew.length + '</b> 组相似句对</div>';
    html += '<div class="check-item"><span class="snippet">⚠ 说明：本估算基于字符二元组重叠率，与知网/万方/维普等系统的算法不同，结果仅供降重过程自查，不能作为学校检测的替代。</span></div>';
    if (manual) html = '<div class="check-item" style="border-left:4px solid #2563eb"><b>本地查重估算报告</b>（' + new Date().toLocaleString() + '）</div>' + html;
    report.innerHTML = html;
  }

  /* ---------------- AI 改写模式（多服务商） ---------------- */
  const CUSTOM_MODEL_OPTION = '__custom__';
  let aiProviderId = '';

  function aiCurrentProvider() {
    return AI.getProvider($('ai-provider').value);
  }

  function aiFillProviderSelect() {
    const sel = $('ai-provider');
    sel.innerHTML = '';
    AI.PROVIDERS.forEach(p => {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name;
      sel.appendChild(o);
    });
    sel.value = localStorage.getItem('dsh_pp_ai_provider') || 'deepseek';
  }

  function aiFillModelSelect() {
    const provider = aiCurrentProvider();
    const sel = $('ai-model');
    sel.innerHTML = '';
    provider.models.forEach(m => {
      const o = document.createElement('option');
      o.value = m;
      o.textContent = m + '  ' + AI.priceLabel(m);
      sel.appendChild(o);
    });
    const custom = document.createElement('option');
    custom.value = CUSTOM_MODEL_OPTION;
    custom.textContent = '自定义模型…';
    sel.appendChild(custom);
    const saved = AI.STORE.getModel(provider.id);
    if (saved && provider.models.includes(saved)) {
      sel.value = saved;
    } else if (saved) {
      sel.value = CUSTOM_MODEL_OPTION;
      $('ai-model-custom').value = saved;
    } else {
      sel.value = provider.defaultModel || provider.models[0];
    }
    aiSyncCustomInput();
  }

  function aiSyncCustomInput() {
    const provider = aiCurrentProvider();
    const isCustomModel = $('ai-model').value === CUSTOM_MODEL_OPTION;
    $('ai-model-custom').classList.toggle('hidden', !isCustomModel);
    $('ai-base-wrap').classList.toggle('hidden', provider.id !== 'custom');
    $('ai-key-label').firstChild.textContent = provider.name + ' API Key：';
    $('ai-key').placeholder = provider.id === 'custom' ? '填写该服务的 API Key' : ('sk-...（' + provider.keyHint + '）');
    $('ai-base').value = AI.STORE.getBase(provider.id) || 'https://api.deepseek.com';
    $('ai-key').value = AI.STORE.getKey(provider.id);
  }

  function aiPersist() {
    const provider = aiCurrentProvider();
    localStorage.setItem('dsh_pp_ai_provider', provider.id);
    const model = $('ai-model').value === CUSTOM_MODEL_OPTION ? $('ai-model-custom').value.trim() : $('ai-model').value;
    if (model) AI.STORE.setModel(provider.id, model);
    AI.STORE.setKey(provider.id, $('ai-key').value.trim());
    if (provider.id === 'custom') AI.STORE.setBase(provider.id, $('ai-base').value.trim());
  }

  $('btn-ai-toggle').addEventListener('click', () => {
    $('ai-panel').classList.toggle('hidden');
    aiFillModelSelect();
  });
  $('ai-provider').addEventListener('change', () => { aiPersist(); aiFillModelSelect(); });
  $('ai-model').addEventListener('change', () => { aiPersist(); aiSyncCustomInput(); });
  $('ai-model-custom').addEventListener('input', aiPersist);
  $('ai-key').addEventListener('input', aiPersist);
  $('ai-base').addEventListener('input', aiPersist);
  aiFillProviderSelect();
  aiFillModelSelect();

  $('btn-ai-run').addEventListener('click', async () => {
    const input = $('input-text').value;
    if (!input.trim()) { alert('请先输入文本。'); return; }
    const provider = aiCurrentProvider();
    aiPersist();
    const model = $('ai-model').value === CUSTOM_MODEL_OPTION ? $('ai-model-custom').value.trim() : $('ai-model').value;
    const key = $('ai-key').value.trim();
    const baseUrl = provider.id === 'custom' ? $('ai-base').value.trim() : undefined;

    const btn = $('btn-ai-run');
    const status = $('ai-status');
    btn.disabled = true;
    status.textContent = provider.name + '（' + model + '）改写中，请稍候…';
    status.style.color = '#b45309';

    const mode = $('opt-mode').value;
    const modeDesc = mode === 'math' ? '数学建模论文' : '通用学术论文';
    const system = '你是一位资深的学术论文写作与降重专家。你的任务是对用户给出的论文段落进行学术化改写（降重），要求：1) 保持原意、数据、公式、专有名词、参考文献标记完全不变；2) 使用同义词替换、句式重组、长句拆分等学术改写手法；3) 语言流畅、符合中文学术写作规范；4) 只输出改写后的正文，不要任何解释或前缀。';
    const user = '论文类型：' + modeDesc + '。\n请对以下段落进行降重改写：\n' + input;

    try {
      const viaServer = location.protocol === 'http:' || location.protocol === 'https:';
      const content = await AI.call({
        provider: provider.id,
        model: model,
        key: key,
        baseUrl: baseUrl,
        system: system,
        user: user,
        viaServer: viaServer,
      });
      if (!content.trim()) throw new Error('AI 返回内容为空');
      $('output-text').value = content.trim();
      $('output-stat').textContent = statLine(content.trim());
      lastResult = {
        text: content.trim(), marked: '', changes: [{ from: '原文（AI 模式）', to: 'AI 改写全文（' + provider.name + ' / ' + model + '）', type: 'AI' }],
        stats: { origChars: input.replace(/\s+/g, '').length, newChars: content.trim().replace(/\s+/g, '').length, sentences: DedupEngine.splitSentences(content).length, changeCount: 1, seed: '-' },
      };
      $('st-orig-words').textContent = lastResult.stats.origChars;
      $('st-new-words').textContent = lastResult.stats.newChars;
      $('st-changes').textContent = 1;
      $('dedup-summary').textContent = 'AI 改写完成（' + provider.name + ' / ' + model + '）。请务必人工逐句核对语义与数据！';
      renderDiff(lastResult.changes);
      runCheck(false);
      status.textContent = '✓ ' + provider.name + ' 改写完成';
      status.style.color = '#16a34a';
    } catch (e) {
      console.error(e);
      status.textContent = '✗ 失败：' + AI.errMsg(e);
      status.style.color = '#dc2626';
    } finally {
      btn.disabled = false;
    }
  });

  /* ---------------- AI 省钱精修（混合降重） ----------------
   * 离线引擎全量处理（免费）→ 只把仍与原文相似的句子交给 AI */
  $('btn-ai-refine').addEventListener('click', async () => {
    const input = $('input-text').value;
    if (!input.trim()) { alert('请先输入文本或上传论文。'); return; }
    const provider = aiCurrentProvider();
    aiPersist();
    const model = $('ai-model').value === CUSTOM_MODEL_OPTION ? $('ai-model-custom').value.trim() : $('ai-model').value;
    const key = $('ai-key').value.trim();
    const baseUrl = provider.id === 'custom' ? $('ai-base').value.trim() : undefined;
    if (!key) { alert('AI 精修需要 API Key：请展开 AI 设置，选择服务商并填写 ' + provider.name + ' 的 Key。'); return; }
    const viaServer = location.protocol === 'http:' || location.protocol === 'https:';

    const btn = $('btn-ai-refine');
    const status = $('ai-status');
    const wrap = $('progress-wrap'), fill = $('progress-fill'), ptext = $('progress-text');
    btn.disabled = true;
    status.textContent = '';
    wrap.classList.remove('hidden');

    const opts = currentOpts();
    const modeDesc = $('opt-mode').value === 'math' ? '数学建模论文' : '通用学术论文';
    const thresh = parseFloat($('ai-refine-thresh').value);

    try {
      // 1) 段落化（文档模式用原段落，纯文本按空行分段）
      let paras;
      if (docSession) paras = docSession.paragraphs.map(p => p.text);
      else paras = input.split(/\r?\n\s*\r?\n/).map(t => t.trim()).filter(Boolean);
      if (!paras.length) paras = [input.trim()];

      // 2) 离线引擎全量处理（免费）
      fill.style.width = '12%';
      ptext.textContent = '第 1 步/3：离线引擎全量降重（免费）…';
      await new Promise(r => setTimeout(r, 30));
      const results = paras.map(t => (t && t.trim()) ? DedupEngine.run(t, opts) : null);
      const newParas = paras.map((t, i) => (results[i] && results[i].text) ? results[i].text : t);

      // 3) 本地估算筛选仍相似的句子
      fill.style.width = '38%';
      ptext.textContent = '第 2 步/3：本地估算筛选需 AI 精修的句子…';
      await new Promise(r => setTimeout(r, 30));
      const tasks = [];
      for (let i = 0; i < paras.length; i++) {
        if (!results[i] || results[i].text === paras[i]) continue;
        const reps = RepCheck.sentenceReport(paras[i], results[i].text, thresh);
        reps.forEach(r => tasks.push({ paraIdx: i, sentence: r.text, orig: r.orig || '' }));
      }
      const budget = Refine.summarize(tasks, input);
      if (!tasks.length) {
        // 离线引擎已足够，无需花一分钱
        finishRefine(newParas, paras, results, 0, 0, budget, null);
        status.textContent = '✓ 离线引擎已足够，本次 0 元（无需调用 AI）';
        status.style.color = '#16a34a';
        wrap.classList.add('hidden');
        btn.disabled = false;
        return;
      }

      // 4) AI 精修（并发 2，避免限流）
      const refined = newParas.slice();
      let failed = 0;
      const system = '你是学术论文改写专家。严格遵守用户指令，只输出改写后的句子本身。';
      for (let i = 0; i < tasks.length; i += 2) {
        const batch = tasks.slice(i, i + 2);
        fill.style.width = (40 + Math.round((i / tasks.length) * 55)) + '%';
        ptext.textContent = '第 3 步/3：AI 精修中（' + Math.min(i + batch.length, tasks.length) + '/' + tasks.length + ' 句）…';
        await new Promise(r => setTimeout(r, 0));
        await Promise.all(batch.map(async t => {
          try {
            const content = await AI.call({
              provider: provider.id, model: model, key: key, baseUrl: baseUrl,
              system: system,
              user: Refine.buildPrompt(t.orig || t.sentence, t.sentence, modeDesc),
              viaServer: viaServer,
              maxTokens: 512,
            });
            const rep = Refine.replaceInParagraph(refined[t.paraIdx], t.sentence, content.trim());
            if (rep.applied) refined[t.paraIdx] = rep.text; else failed++;
          } catch (e) {
            failed++;
            console.error('精修失败:', e);
          }
        }));
      }
      fill.style.width = '100%';
      ptext.textContent = '完成，正在汇总…';
      await new Promise(r => setTimeout(r, 30));
      finishRefine(refined, paras, results, tasks.length, failed, budget, provider.name + ' / ' + model);
      status.textContent = '✓ AI 精修完成';
      status.style.color = '#16a34a';
    } catch (e) {
      console.error(e);
      status.textContent = '✗ 失败：' + AI.errMsg(e);
      status.style.color = '#dc2626';
    } finally {
      wrap.classList.add('hidden');
      btn.disabled = false;
    }
  });

  /* 精修完成后统一输出 */
  function finishRefine(refinedParas, origParas, results, taskCount, failed, budget, aiLabel) {
    const plain = refinedParas.join('\n\n');
    const origChars = origParas.join('').replace(/\s+/g, '').length;
    const newChars = plain.replace(/\s+/g, '').length;
    const changeCount = results.reduce((s, r) => s + (r ? r.changes.length : 0), 0) + (taskCount - failed);
    const pct = budget.fullTokens > 0 ? Math.round((budget.taskTokens / budget.fullTokens) * 100) : 0;

    lastResult = {
      text: plain, marked: '',
      changes: [{ from: '省钱精修', to: '离线引擎全文 + AI 精修 ' + (taskCount - failed) + ' 句', type: 'AI' }],
      stats: { origChars: origChars, newChars: newChars, sentences: DedupEngine.splitSentences(plain).length, changeCount: changeCount, seed: '-', docMode: !!docSession },
    };
    highlightOn = false;
    $('output-text').value = plain;
    $('output-stat').textContent = statLine(plain);
    $('st-orig-words').textContent = origChars;
    $('st-new-words').textContent = newChars;
    $('st-changes').textContent = changeCount;
    let msg;
    if (taskCount === 0) {
      msg = '离线引擎已处理全部 ' + origParas.length + ' 段，未发现需 AI 精修的句子 —— 本次费用 0 元';
    } else {
      msg = '省钱精修完成（' + aiLabel + '）：离线引擎处理 ' + origParas.length + ' 段（免费）→ AI 仅精修 ' + (taskCount - failed) + '/' + taskCount + ' 句，约 ' + budget.taskTokens + ' tokens（占全文约 ' + pct + '%），比全量 AI 改写节省约 ' + budget.savedPct + '% 费用';
      if (failed) msg += '；' + failed + ' 句精修失败已保留原句';
    }
    $('dedup-summary').textContent = msg;
    renderDiff(lastResult.changes);
    runCheck(false);
    if (docSession) {
      docSession.newTexts = refinedParas.map((t, i) => (t === origParas[i] ? null : t));
    }
  }

  /* ---------------- 高级工具：逐句对照 / 写作检查 / 朗读 / 报告 ---------------- */
  $('btn-compare').addEventListener('click', () => {
    const orig = $('input-text').value;
    const rew = $('output-text').value;
    if (!orig.trim() || !rew.trim()) { alert('请先输入原文并点击“开始降重”。'); return; }
    const os = DedupEngine.splitSentences(orig);
    const rs = DedupEngine.splitSentences(rew);
    const n = Math.max(os.length, rs.length);
    let html = '<div class="compare-wrap"><table class="compare-table"><thead><tr><th>#</th><th>原文</th><th>改写后</th><th>状态</th></tr></thead><tbody>';
    for (let i = 0; i < n; i++) {
      const a = os[i] || '', b = rs[i] || '';
      const same = a === b;
      html += '<tr><td>' + (i + 1) + '</td>' +
        '<td class="' + (same ? 'same' : 'diff') + '">' + esc(a) + '</td>' +
        '<td class="' + (same ? 'same' : 'diff') + '">' + esc(b) + '</td>' +
        '<td>' + (same ? '·' : '✎') + '</td></tr>';
    }
    html += '</tbody></table></div><p class="empty-hint">原文 ' + os.length + ' 句 → 改写 ' + rs.length + ' 句。✎ 表示该行有改动。</p>';
    $('adv-output').innerHTML = html;
  });

  $('btn-writing').addEventListener('click', () => {
    const text = $('input-text').value;
    if (!text.trim()) { alert('请先输入文本。'); return; }
    const issues = Writing.check(text);
    const by = Writing.summarize(issues);
    const names = { colloquial: '口语化', redundant: '冗余结构', long: '超长句' };
    const summary = Object.keys(by).map(k => names[k] + ' ' + by[k]).join('，');
    let html = '<p class="empty-hint">共发现 <b>' + issues.length + '</b> 处问题' + (summary ? '（' + summary + '）' : '') + '</p>';
    if (!issues.length) html += '<p class="empty-hint">未发现问题，写作规范 👍</p>';
    issues.slice(0, 60).forEach(it => {
      html += '<div class="issue-item"><span class="issue-text">' + esc(it.text) + '</span>' +
        '<div class="issue-meta">' + it.reason + (it.index >= 0 ? ' · 位于第 ' + (it.index + 1) + ' 字符' : '') + '</div>' +
        '<div class="issue-fix">建议：' + esc(it.suggestion) + '</div></div>';
    });
    $('adv-output').innerHTML = html;
  });

  let ttsOn = false;
  $('btn-tts').addEventListener('click', () => {
    const text = $('output-text').value || $('input-text').value;
    if (!text.trim()) { alert('没有可朗读的内容。'); return; }
    if (!('speechSynthesis' in window)) { alert('当前浏览器不支持朗读（建议使用 Chrome/Edge）。'); return; }
    if (ttsOn) { speechSynthesis.cancel(); ttsOn = false; $('btn-tts').textContent = '🔊 朗读结果'; return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = 1;
    u.onend = () => { ttsOn = false; $('btn-tts').textContent = '🔊 朗读结果'; };
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    ttsOn = true;
    $('btn-tts').textContent = '⏹ 停止朗读';
  });

  $('btn-report').addEventListener('click', () => {
    const orig = $('input-text').value;
    const rew = $('output-text').value;
    if (!orig.trim()) { alert('请先输入原文。'); return; }
    const now = new Date().toLocaleString('zh-CN');
    const est = RepCheck.estimateSimilarity(orig, rew);
    const sentRep = rew.trim() ? RepCheck.sentenceReport(orig, rew, 0.55) : [];
    const selfDup = RepCheck.selfDuplicates(orig);
    const issues = Writing.check(orig);
    const changes = (lastResult && lastResult.changes) || [];
    const origChars = orig.replace(/\s+/g, '').length;
    const newChars = rew.replace(/\s+/g, '').length;

    let html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>论文查重报告</title>' +
      '<style>body{font-family:"Microsoft YaHei",sans-serif;margin:32px;color:#1e293b;line-height:1.7}' +
      'h1{color:#1e3a8a;border-bottom:3px solid #2563eb;padding-bottom:10px}' +
      'h2{color:#1d4ed8;margin-top:26px;font-size:18px}' +
      'table{border-collapse:collapse;width:100%;font-size:13.5px;margin:8px 0}' +
      'th,td{border:1px solid #cbd5e1;padding:7px 10px;text-align:left}' +
      'th{background:#eff6ff;color:#1d4ed8}' +
      '.stat{display:inline-block;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 18px;margin:6px 10px 0 0}' +
      '.stat b{font-size:20px;color:#1d4ed8;display:block}' +
      '.warn{background:#fffbeb;border:1px solid #f59e0b;border-radius:8px;padding:10px 14px;font-size:13px;color:#78350f;margin-top:20px}' +
      '.issue{background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:8px 12px;margin:6px 0;font-size:13px}</style></head><body>' +
      '<h1>论文降重自查报告</h1>' +
      '<p>生成时间：' + now + '　·　原文 ' + origChars + ' 字 → 改写后 ' + newChars + ' 字　·　改写/变换 ' + changes.length + ' 处</p>' +
      '<div class="stat"><b>' + (est ? (est.rate * 100).toFixed(1) + '%' : '-') + '</b>改写文与原文估算重复率</div>' +
      '<div class="stat"><b>' + sentRep.length + '</b>疑似高度相似句子（≥55%）</div>' +
      '<div class="stat"><b>' + selfDup.length + '</b>原文内部重复句对</div>' +
      '<div class="stat"><b>' + issues.length + '</b>写作规范问题</div>' +
      '<h2>一、疑似与原文高度相似的句子</h2>' +
      (sentRep.length ? '<table><tr><th>相似度</th><th>句子</th></tr>' + sentRep.slice(0, 20).map(r =>
        '<tr><td>' + (r.sim * 100).toFixed(0) + '%</td><td>' + esc(r.text) + '</td></tr>').join('') + '</table>'
        : '<p>未发现。</p>') +
      '<h2>二、改写明细（前 100 条）</h2>' +
      (changes.length ? '<table><tr><th>#</th><th>原文片段</th><th>改写后</th><th>策略</th></tr>' +
        changes.slice(0, 100).map((c, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(c.from) + '</td><td>' + esc(c.to) + '</td><td>' + esc(c.type) + '</td></tr>').join('') + '</table>'
        : '<p>无。</p>') +
      '<h2>三、写作规范检查</h2>' +
      (issues.length ? issues.slice(0, 30).map(it =>
        '<div class="issue"><b>' + esc(it.text) + '</b> — ' + it.reason + '。建议：' + esc(it.suggestion) + '</div>').join('')
        : '<p>未发现问题。</p>') +
      '<div class="warn">⚠ 本报告基于本地字符 n-gram 估算，与知网/万方/维普等官方检测系统算法不同，仅供降重过程自我检查，不能作为学校检测的替代。请遵守学校学术规范（教育部令第40号）。</div>' +
      '</body></html>';
    download('论文查重报告.html', html, 'text/html;charset=utf-8');
  });

  /* ---------------- 自定义保护词持久化 ---------------- */
  $('custom-terms').addEventListener('input', () => {
    try { localStorage.setItem('dsh_pp_custom_terms', $('custom-terms').value); } catch (e) { /* ignore */ }
  });

  /* ---------------- 快捷键 ---------------- */
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); $('btn-dedup').click(); }
    else if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) { e.preventDefault(); $('btn-copy').click(); }
    else if (e.ctrlKey && e.shiftKey && (e.key === 'E' || e.key === 'e')) { e.preventDefault(); $('btn-export-doc').click(); }
  });

  /* ---------------- 在线工具：翻译 / 回译 / 检索 / 诊断 ---------------- */
  function selectedFromInput() {
    const ta = $('input-text');
    const s = ta.selectionStart, e = ta.selectionEnd;
    if (s !== e) return ta.value.slice(s, e).trim();
    return '';
  }

  $('ot-import').addEventListener('click', () => {
    const sel = selectedFromInput() || $('input-text').value;
    if (sel) $('ot-input').value = sel.slice(0, 2000);
  });
  $('ot-btn').addEventListener('click', async () => {
    const text = $('ot-input').value;
    if (!text.trim()) { alert('请输入要翻译的文本。'); return; }
    const dir = $('ot-dir').value;
    const btn = $('ot-btn'), status = $('ot-status');
    btn.disabled = true;
    status.textContent = '翻译中（分块并发处理）…';
    status.style.color = '#b45309';
    try {
      const [from, to] = dir === 'zh-en' ? ['zh-CN', 'en-GB'] : ['en-GB', 'zh-CN'];
      const out = await Online.translate(text, from, to, (d, n) => {
        status.textContent = '翻译中：' + d + '/' + n + ' 块…';
      });
      $('ot-output').value = out;
      status.textContent = '✓ 翻译完成（' + Online.chunkText(text).length + ' 块）';
      status.style.color = '#16a34a';
    } catch (e) {
      console.error(e);
      status.textContent = '✗ 失败：' + (e.status === 429 || e.status === 403 ? '免费额度用尽或请求过频（' + e.status + '），请稍后再试' : e.message);
      status.style.color = '#dc2626';
    } finally {
      btn.disabled = false;
    }
  });
  $('ot-copy').addEventListener('click', async () => {
    const v = $('ot-output').value;
    if (!v) { alert('没有可复制的内容。'); return; }
    try { await navigator.clipboard.writeText(v); alert('已复制。'); }
    catch (e) { $('ot-output').select(); document.execCommand('copy'); alert('已复制（兼容模式）。'); }
  });

  $('bt-import').addEventListener('click', () => {
    const sel = selectedFromInput() || $('input-text').value;
    if (sel) $('bt-input').value = sel.slice(0, 3000);
  });
  $('bt-run').addEventListener('click', async () => {
    const text = $('bt-input').value;
    if (!text.trim()) { alert('请输入要回译的文本。'); return; }
    const btn = $('bt-run'), status = $('bt-status');
    const wrap = $('bt-progress-wrap'), fill = $('bt-progress-fill'), ptext = $('bt-progress-text');
    btn.disabled = true;
    status.textContent = '';
    wrap.classList.remove('hidden');
    try {
      const out = await Online.backTranslate(text, (d, n, phase) => {
        fill.style.width = Math.round((d / n) * 100) + '%';
        ptext.textContent = phase + '…';
      });
      $('bt-output').value = out;
      status.textContent = '✓ 回译完成';
      status.style.color = '#16a34a';
    } catch (e) {
      console.error(e);
      status.textContent = '✗ 失败：' + (e.status === 429 || e.status === 403 ? '免费额度用尽或请求过频（' + e.status + '），请稍后再试' : e.message);
      status.style.color = '#dc2626';
    } finally {
      btn.disabled = false;
      wrap.classList.add('hidden');
    }
  });
  $('bt-fill').addEventListener('click', () => {
    const v = $('bt-output').value;
    if (!v) { alert('没有可填入的内容。'); return; }
    $('output-text').value = v;
    $('output-stat').textContent = statLine(v);
    lastResult = {
      text: v, marked: '', changes: [{ from: '原文', to: '回译降重结果（中→英→中）', type: 'AI' }],
      stats: { origChars: $('input-text').value.replace(/\s+/g, '').length, newChars: v.replace(/\s+/g, '').length, sentences: DedupEngine.splitSentences(v).length, changeCount: 1, seed: '-' },
    };
    $('st-orig-words').textContent = lastResult.stats.origChars;
    $('st-new-words').textContent = lastResult.stats.newChars;
    $('st-changes').textContent = 1;
    $('dedup-summary').textContent = '回译降重完成（在线免费）。回译结果可能生硬，建议人工润色后再用';
    renderDiff(lastResult.changes);
    runCheck(false);
  });
  $('bt-copy').addEventListener('click', async () => {
    const v = $('bt-output').value;
    if (!v) { alert('没有可复制的内容。'); return; }
    try { await navigator.clipboard.writeText(v); alert('已复制。'); }
    catch (e) { $('bt-output').select(); document.execCommand('copy'); alert('已复制（兼容模式）。'); }
  });

  $('ot-kw-sel').addEventListener('click', () => {
    const sel = selectedFromInput();
    if (sel) {
      $('ot-kw').value = sel.replace(/[。，、；：？！\s]+/g, ' ').slice(0, 80);
      alert('已取用选中文本作为关键词。');
    } else {
      alert('请先在原文框中用鼠标选中一段文字，再点击此按钮。');
    }
  });
  document.querySelectorAll('[data-search]').forEach(btn => {
    btn.addEventListener('click', () => {
      const kw = $('ot-kw').value.trim();
      if (!kw) { alert('请先输入检索关键词。'); return; }
      const idx = { cnki: 0, wanfang: 1, cqvip: 2, baidu: 3 }[btn.dataset.search];
      const pick = Online.searchUrls(kw)[idx] || Online.searchUrls(kw)[0];
      window.open(pick.url, '_blank', 'noopener');
    });
  });

  $('ot-diag').addEventListener('click', async () => {
    const out = $('ot-diag-out');
    out.innerHTML = '<p class="empty-hint">正在检测，每个目标最多 5 秒…</p>';
    const results = await Online.diagnose((name, ok) => {
      out.innerHTML += '<div class="diag-item"><span class="dot ' + (ok ? 'ok' : 'bad') + '"></span><span>' + (ok ? '可达' : '不可达') + '</span><span class="diag-name">' + esc(name) + '</span></div>';
    });
    const okCount = results.filter(r => r.ok).length;
    out.innerHTML += '<p class="empty-hint">检测完成：' + okCount + '/' + results.length + ' 个服务可达' +
      (okCount === results.length ? '，网络状况良好 👍' : '，不可达的服务请检查网络/防火墙') + '</p>';
  });

  /* ---------------- 知识库渲染 ---------------- */
  (function renderKnowledge() {
    const root = $('knowledge-root');
    const warn = document.createElement('div');
    warn.className = 'warn-banner';
    warn.innerHTML = 'ℹ ' + KNOWLEDGE.disclaimer;
    root.appendChild(warn);

    KNOWLEDGE.categories.forEach(cat => {
      const sec = document.createElement('div');
      sec.className = 'kb-cat';
      const h = document.createElement('h3');
      h.textContent = cat.title;
      sec.appendChild(h);
      if (cat.desc) {
        const d = document.createElement('p');
        d.style.cssText = 'font-size:13px;color:#64748b;margin:4px 0 8px;';
        d.textContent = cat.desc;
        sec.appendChild(d);
      }
      const grid = document.createElement('div');
      grid.className = 'kb-cards';
      cat.entries.forEach(en => {
        const card = document.createElement('div');
        card.className = 'kb-card';
        card.innerHTML = '<h4>' + esc(en.name) + (en.tag ? '<span class="kb-tag ' + (en.tag === '官方' ? 'official' : 'ref') + '">' + esc(en.tag) + '</span>' : '') + '</h4>' +
          '<a class="kb-url" href="' + esc(en.url) + '" target="_blank" rel="noopener">' + esc(en.url) + '</a>' +
          '<div class="kb-desc">' + esc(en.desc) + '</div>' +
          '<div class="kb-src">来源：' + esc(en.src) + '</div>';
        grid.appendChild(card);
      });
      sec.appendChild(grid);
      root.appendChild(sec);
    });

    KNOWLEDGE.guides.forEach(g => {
      const block = document.createElement('div');
      block.className = 'guide-block';
      block.innerHTML = '<h3>' + esc(g.title) + '</h3><ul>' + g.items.map(i => '<li>' + esc(i) + '</li>').join('') + '</ul>';
      root.appendChild(block);
    });
  })();

  /* ---------------- 初始化：恢复草稿与自定义保护词 ---------------- */
  (function restoreState() {
    try {
      const terms = localStorage.getItem('dsh_pp_custom_terms');
      if (terms) $('custom-terms').value = terms;
    } catch (e) { /* ignore */ }
    try {
      const draft = localStorage.getItem('dsh_pp_draft');
      if (draft) {
        $('input-text').value = draft;
        $('input-stat').textContent = statLine(draft);
        $('doc-hint').textContent = '已恢复上次未完成的草稿（自动保存）';
        return;
      }
    } catch (e) { /* ignore */ }
    $('btn-sample').click();
  })();
})();
