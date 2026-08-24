/* 生成应用图标 build/icon.png（512x512，纯 Node 实现，无第三方依赖）
 * 设计：蓝色渐变背景 + 白色文档页 + 文字行，寓意“论文写作工具”
 * 用法：node gen-icon.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const S = 512;

/* ---------- PNG 编码 ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8bit RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: None
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- 绘制 ---------- */
const px = Buffer.alloc(S * S * 4);

function setPx(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
}

function lerp(a, b, t) { return a + (b - a) * t; }

function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.max(x0 + r, Math.min(x1 - r, x));
  const cy = Math.max(y0 + r, Math.min(y1 - r, y));
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    // 背景渐变 #1E3A8A -> #2563EB -> 右下更亮
    const t = (x + y) / (2 * S);
    const r = Math.round(lerp(0x1E, 0x38, t));
    const g = Math.round(lerp(0x3A, 0x8A, t));
    const b = Math.round(lerp(0x8A, 0xE8, t * 0.6 + 0.2));
    setPx(x, y, r, g, b, 255);
  }
}

const R = 56;
// 白色文档页 (112,104)-(400,416)
for (let y = 104; y <= 416; y++) {
  for (let x = 112; x <= 400; x++) {
    if (inRoundedRect(x, y, 112, 104, 400, 416, R)) setPx(x, y, 255, 255, 255, 255);
  }
}
// 页眉蓝色条（顶部圆角与页面一致）
for (let y = 104; y <= 168; y++) {
  for (let x = 112; x <= 400; x++) {
    if (inRoundedRect(x, y, 112, 104, 400, 416, R)) setPx(x, y, 37, 99, 235, 255);
  }
}
// 文字行（灰色横条，模拟正文）
const lines = [
  [128, 368, 204], [128, 340, 256], [128, 300, 256], [128, 260, 296], [128, 220, 296],
];
for (const [x0, y0, x1] of lines) {
  for (let y = y0; y < y0 + 14; y++) {
    for (let x = x0; x <= x1; x++) setPx(x, y, 148, 163, 184, 255);
  }
}
// 页眉上的白色标题条（模拟“论文降重助手”）
for (let y = 122; y < 122 + 12; y++) {
  for (let x = 140; x <= 372; x += 2) setPx(x, y, 219, 234, 254, 255);
}
// 右下角“对勾”点缀：简单三角形
for (let y = 336; y < 384; y++) {
  for (let x = 304; x < 384; x++) {
    const dx = x - 304, dy = y - 336;
    if (dx >= dy * 0.9 && dx <= 80 - dy * 0.9 && dx >= 34) setPx(x, y, 22, 163, 74, 255);
  }
}

const outDir = path.join(__dirname, 'build');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'icon.png');
fs.writeFileSync(out, encodePNG(S, S, px));
console.log('图标已生成: ' + out);
