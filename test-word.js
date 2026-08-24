/* 真实 Word 文档端到端测试：
 * 读取 .tmp/wordtest.docx → 段落级降重 → 回写 → 保存 .tmp/wordtest-out.docx
 * （由 PowerShell 调 Word COM 生成输入、验证输出）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const DocxIO = require('./js/docxio.js');
const engine = require('./js/engine.js');

(async () => {
  const inPath = path.join(__dirname, '.tmp', 'wordtest.docx');
  const outPath = path.join(__dirname, '.tmp', 'wordtest-out.docx');
  const buf = fs.readFileSync(inPath);
  const parsed = await DocxIO.parseDocx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  console.log('原文档段落数: ' + parsed.paragraphs.length);
  const newTexts = parsed.paragraphs.map(p => {
    if (!p.text || !p.text.trim()) return null;
    const r = engine.run(p.text, { mode: 'general', strength: 'standard', seed: 3 });
    return r.text;
  });
  const blob = await DocxIO.rebuildDocx(parsed, newTexts);
  const out = Buffer.from(await blob.arrayBuffer());
  fs.writeFileSync(outPath, out);
  console.log('已回写: ' + outPath + ' (' + (out.length / 1024).toFixed(1) + ' KB)');
  console.log('段落文本（前3段）:');
  newTexts.slice(0, 3).forEach((t, i) => console.log('  [' + i + '] ' + String(t || '').slice(0, 50)));
})().catch(e => { console.error('FAIL: ' + e.stack); process.exit(1); });
