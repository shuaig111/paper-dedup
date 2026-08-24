/* 文档功能自测：node test-doc.js
 * 覆盖：docx 解析/公式占位/样式保留回写/最小docx生成；PDF 生成与回读
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ZipIO = require('./js/zip.js');
const DocxIO = require('./js/docxio.js');
const engine = require('./js/engine.js');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ FAIL: ' + msg); }
}
const enc = s => new TextEncoder().encode(s);

(async () => {
  console.log('== 1. 构造测试 DOCX ==');
  const docXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">' +
    '<w:body>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>第一章 绪论</w:t></w:r></w:p>' +
    '<w:p><w:pPr><w:jc w:val="both"/><w:ind w:firstLine="480"/></w:pPr><w:r><w:t>近年来，随着信息技术的快速发展，网络安全问题日益突出，受到社会各界的广泛关注。</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:r><w:t>本文提出了一种基于深度学习的方法。</w:t></w:r></w:r></w:p>' +
    '<w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><m:oMath><m:r><m:t>x+y=1</m:t></m:r></m:oMath></w:r><w:r><w:t>公式如上所示，该模型具有较好的性能。</w:t></w:r></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格单元格中的文字</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
    '<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t>参考文献[1]表明，该方法误差为12.5%。</w:t></w:r></w:p>' +
    '<w:p><w:pPr/><w:r><w:t>空段落测试。</w:t></w:r></w:p>' +
    '<w:p><w:pPr/><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:docPr id="1"/></wp:inline></w:drawing></w:r><w:r><w:t>图片说明文字</w:t></w:r></w:p>' +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>' +
    '</w:body></w:document>';
  const entries0 = {
    '[Content_Types].xml': enc('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': enc('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/_rels/document.xml.rels': enc('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'),
    'word/document.xml': enc(docXml),
  };
  const testDocx = await ZipIO.writeZip(entries0);
  assert(testDocx.byteLength > 500, '测试 docx 生成 (' + testDocx.byteLength + ' B)');

  console.log('== 2. 解析 DOCX ==');
  const parsed = await DocxIO.parseDocx(testDocx);
  assert(parsed.paragraphs.length === 7, '段落数 = 7 (' + parsed.paragraphs.length + ')');
  assert(parsed.paragraphs[6].safe === false, '含图片段落标记为 unsafe');
  assert(parsed.paragraphs[6].raw.includes('w:drawing'), '含图片段落 raw 保留');
  const p0 = parsed.paragraphs[0];
  assert(p0.text === '第一章 绪论', '标题段落文本正确: ' + p0.text);
  const p1 = parsed.paragraphs[1];
  assert(p1.text.includes('近年来') && p1.text.includes('本文提出'), '正文段落含加粗部分文本');
  const p2 = parsed.paragraphs[2];
  assert(p2.formulas.length === 1, '公式被捕获 (' + p2.formulas.length + ')');
  assert(p2.formulas[0].includes('oMath') && p2.formulas[0].includes('x+y=1'), '公式原始 XML 保留');
  assert(p2.text.includes('\uE100') && p2.text.includes('公式如上所示'), '公式占位符 + 段落文本正确');
  assert(parsed.paragraphs[3].text === '表格单元格中的文字', '表格内段落可解析');
  assert(parsed.paragraphs[4].text.includes('12.5%'), '数字保留: ' + parsed.paragraphs[4].text);
  assert(parsed.paragraphs[5].text === '空段落测试。', '末段（含节属性）文本正确');

  console.log('== 3. 降重回写（格式保留） ==');
  const newTexts = parsed.paragraphs.map((p, i) => {
    if (!p.text || p.safe === false) return null;
    const r = engine.run(p.text, { mode: 'general', strength: 'strong', seed: 9 });
    return r.text;
  });
  const rebuilt = await DocxIO.rebuildDocx(parsed, newTexts);
  const blobArr = await rebuilt.arrayBuffer();
  const parsed2 = await DocxIO.parseDocx(blobArr);
  assert(parsed2.paragraphs.length === 7, '回写后段落数不变');
  assert(parsed2.paragraphs[6].raw.includes('w:drawing') && parsed2.paragraphs[6].text.includes('图片说明文字'), '含图片段落原样保留（图片未丢失）');
  assert(parsed2.paragraphs[0].text === newTexts[0], '标题文本已替换');
  assert(parsed2.paragraphs[0].raw.includes('w:pStyle w:val="Heading1"'), '标题样式保留');
  assert(parsed2.paragraphs[1].raw.includes('w:jc w:val="both"'), '对齐样式保留');
  assert(parsed2.paragraphs[1].raw.includes('w:firstLine="480"'), '首行缩进保留');
  assert(parsed2.paragraphs[2].formulas.length === 1 && parsed2.paragraphs[2].formulas[0].includes('x+y=1'), '公式回写保留');
  assert(parsed2.paragraphs[2].text.includes('公式如上所示'), '公式段文本正常');
  assert(parsed2.paragraphs[3].text === '表格单元格中的文字', '表格内容保留');
  assert(parsed2.paragraphs[5].raw.includes('w:sectPr') || parsed2.xml.includes('w:sectPr'), '节属性保留');
  const bodySect = /<w:sectPr>[\s\S]*?<\/w:sectPr>/.exec(parsed2.xml);
  assert(bodySect !== null, 'body 级节属性（页面设置）保留');
  assert(!/[^\u0002\u0003]\uE000|\uE001/.test(parsed2.paragraphs.map(p => p.text).join('')), '无占位符泄漏');
  console.log('  回写后标题: ' + parsed2.paragraphs[0].text);
  console.log('  回写后正文: ' + parsed2.paragraphs[1].text.slice(0, 60) + '…');

  console.log('== 4. 最小 DOCX 生成（txt→docx） ==');
  const minBlob = await DocxIO.buildMinimalDocx(['测试段落一。', '测试段落二。']);
  const minArr = await minBlob.arrayBuffer();
  const minParsed = await DocxIO.parseDocx(minArr);
  assert(minParsed.paragraphs.length === 2, '最小 docx 段落数 = 2');
  assert(minParsed.paragraphs[0].text === '测试段落一。', '最小 docx 文本正确');

  console.log('== 5. PDF 生成与回读 ==');
  const fontPath = path.join(__dirname, 'js', 'lib', 'LXGWWenKaiLite-Regular.ttf');
  if (!fs.existsSync(fontPath)) {
    console.log('  ! 字体文件缺失，跳过 PDF 测试');
  } else {
    global.PDFLib = require('./js/lib/pdf-lib.min.js');
    global.fontkit = require('./js/lib/fontkit.umd.min.js');
    const PdfIO = require('./js/pdfio.js');
    const fontBuf = fs.readFileSync(fontPath);
    const fontData = fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength);
    const paras = [
      { text: '第一章 绪论', size: 16, heading: true },
      { text: '近年来，随着信息技术的快速发展，网络安全问题日益突出，受到社会各界的广泛关注。本文提出了一种基于深度学习的方法。', size: 12, heading: false },
      { text: '实验结果表明，该方法在公开数据集上的检测准确率达到98.5%，明显优于传统的机器学习方法。', size: 12, heading: false },
    ];
    const pdfBytes = await PdfIO.buildPdf(paras, fontData);
    assert(pdfBytes.length > 5000, 'PDF 生成 (' + (pdfBytes.length / 1024).toFixed(0) + ' KB)');
    const PDFDocument = PDFLib.PDFDocument;
    const loaded = await PDFDocument.load(pdfBytes);
    assert(loaded.getPageCount() >= 1, 'PDF 页数 = ' + loaded.getPageCount());
    // 用 pdf.js 回读文本（统计警告数：子集化 CFF 字体会有渲染警告，TTF 应无警告）
    try {
      global.pdfjsLib = require('./js/lib/pdf.min.js');
      global.pdfjsLib.GlobalWorkerOptions.workerSrc = path.join(__dirname, 'js', 'lib', 'pdf.worker.min.js');
      const realWarn = console.warn;
      let warnings = 0;
      console.warn = (...a) => { warnings++; if (warnings < 3) realWarn('[pdf.js warn]', ...a); };
      const doc = await global.pdfjsLib.getDocument({ data: new Uint8Array(pdfBytes) }).promise;
      const page = await doc.getPage(1);
      const tc = await page.getTextContent();
      console.warn = realWarn;
      const text = tc.items.map(it => it.str).join('');
      assert(text.includes('第一章'), 'PDF 回读含标题');
      assert(text.includes('网络安全问题'), 'PDF 回读含正文');
      assert(text.includes('98.5%'), 'PDF 回读含数字');
      assert(warnings === 0, 'pdf.js 无字体渲染警告（' + warnings + ' 条）');
      console.log('  pdf.js 回读文本: ' + text.slice(0, 60) + '…');
    } catch (e) {
      console.log('  [信息] pdf.js 回读跳过: ' + e.message);
    }
  }

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常: ' + e.stack); process.exit(1); });
