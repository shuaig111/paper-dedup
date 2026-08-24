/* ============================================================
 * 极简 ZIP 读写（零依赖，基于浏览器原生 DecompressionStream/
 * CompressionStream 与手写 CRC32；Node 18+ 同样可用）
 * 用于 .docx 的解析与回写。
 * 注意：读/写均为异步。
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---------- CRC32 ---------- */
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

  const enc = new TextEncoder();
  const dec = new TextDecoder('utf-8');

  function u16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); return b; }
  function u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; }

  /* ---------- 解压（deflate-raw） ---------- */
  async function inflateRaw(data) {
    if (!data.length) return new Uint8Array(0);
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([data]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  async function deflateRaw(data) {
    if (!data.length) return new Uint8Array(0);
    const cs = new CompressionStream('deflate-raw');
    const stream = new Blob([data]).stream().pipeThrough(cs);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  /* ---------- 读取 ZIP ---------- */
  async function readZip(arrayBuffer) {
    const buf = new Uint8Array(arrayBuffer);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    // 定位 EOCD（从尾部向前找签名 0x06054b50）
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 ZIP/DOCX 文件（未找到目录）');
    const cdCount = view.getUint16(eocd + 10, true);
    const cdSize = view.getUint32(eocd + 12, true);
    const cdOffset = view.getUint32(eocd + 16, true);

    const entries = {};
    let p = cdOffset;
    for (let k = 0; k < cdCount; k++) {
      if (view.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP 中央目录损坏');
      const method = view.getUint16(p + 10, true);
      const compSize = view.getUint32(p + 20, true);
      const uncompSize = view.getUint32(p + 24, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      const flags = view.getUint16(p + 8, true);
      const localOffset = view.getUint32(p + 42, true);
      const nameBytes = buf.slice(p + 46, p + 46 + nameLen);
      const name = flags & 0x800 ? dec.decode(nameBytes) : dec.decode(nameBytes);
      // 本地文件头
      const lho = localOffset;
      const lNameLen = view.getUint16(lho + 26, true);
      const lExtraLen = view.getUint16(lho + 28, true);
      const dataStart = lho + 30 + lNameLen + lExtraLen;
      const comp = buf.slice(dataStart, dataStart + compSize);
      let raw;
      if (method === 0) raw = comp;
      else if (method === 8) raw = await inflateRaw(comp);
      else throw new Error('不支持的压缩方式: ' + method + '（' + name + '）');
      entries[name] = { data: raw, method: 8 };
      p += 46 + nameLen + extraLen + commentLen;
    }
    return { entries: entries, readFile: async (n) => entries[n] ? entries[n].data : null };
  }

  /* ---------- 写入 ZIP ---------- */
  async function writeZip(entriesObj) {
    const names = Object.keys(entriesObj);
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const dosTime = 0x0000;
    const dosDate = ((2024 - 1980) << 9) | (1 << 5) | 1;

    for (const name of names) {
      const data = entriesObj[name] instanceof Uint8Array ? entriesObj[name] : new Uint8Array(entriesObj[name]);
      const comp = await deflateRaw(data);
      const crc = crc32(data);
      const nameBytes = enc.encode(name);
      const crcU32 = u32(crc), csU32 = u32(comp.length), usU32 = u32(data.length);
      const nameLenU16 = u16(nameBytes.length);

      const local = new Uint8Array(30 + nameBytes.length + comp.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true); // UTF-8 文件名
      lv.setUint16(8, 8, true);      // deflate
      lv.setUint16(10, dosTime, true);
      lv.setUint16(12, dosDate, true);
      local.set(crcU32, 14);
      local.set(csU32, 18);
      local.set(usU32, 22);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);
      local.set(comp, 30 + nameBytes.length);
      localParts.push(local);

      const cen = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(cen.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 8, true);
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cen.set(crcU32, 16);
      cen.set(csU32, 20);
      cen.set(usU32, 24);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, offset, true);
      cen.set(nameBytes, 46);
      centralParts.push(cen);
      offset += local.length;
    }

    const cdSize = centralParts.reduce((s, p) => s + p.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, names.length, true);
    ev.setUint16(10, names.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);

    const total = new Uint8Array(offset + cdSize + 22);
    let pos = 0;
    for (const p of localParts) { total.set(p, pos); pos += p.length; }
    for (const p of centralParts) { total.set(p, pos); pos += p.length; }
    total.set(eocd, pos);
    return total.buffer;
  }

  const api = { readZip: readZip, writeZip: writeZip, crc32: crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.ZipIO = api;
})(typeof window !== 'undefined' ? window : globalThis);
