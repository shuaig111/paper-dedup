/* ============================================================
 * 本地静态服务器 + DeepSeek API 代理（零依赖，Node.js 18+）
 * 用途：
 *   1) 以 http 方式打开本软件（AI 模式需要 http 环境）
 *   2) 代理 /api/chat → https://api.deepseek.com/chat/completions
 *      避免浏览器跨域限制（API Key 只发往 DeepSeek 官方）
 * 启动：
 *   node server.js         仅本机访问（http://127.0.0.1:8642）
 *   node server.js --lan   局域网访问（自动打印局域网网址）
 *   也可被其他程序 require：startServer(opts) 返回 Promise<port>
 * ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

const PORT = process.env.PORT ? Number(process.env.PORT) : 8642;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function safeJoin(base, rel) {
  const p = path.normalize(path.join(base, rel));
  if (p !== base && !p.startsWith(base + path.sep)) return null;
  return p;
}

function serveStatic(req, res, urlPath, root) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const file = safeJoin(root, rel);
  if (!file) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 Not Found'); return; }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

/* 通用 OpenAI 兼容代理：POST /api/chat
 * body: { key, baseUrl, payload } → baseUrl/chat/completions */
function proxyOpenAI(req, res) {
  let body = '';
  req.on('data', c => { body += c; if (body.length > 2 * 1024 * 1024) req.destroy(); });
  req.on('end', async () => {
    let data;
    try { data = JSON.parse(body || '{}'); } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: 'bad json' })); return; }
    const key = data.key || '';
    const baseUrl = String(data.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
    const payload = data.payload || {};
    if (!key) { res.writeHead(400); res.end(JSON.stringify({ error: 'missing api key' })); return; }
    try {
      const upstream = await fetch(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify(payload),
      });
      const text = await upstream.text();
      res.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(text);
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'proxy failed: ' + e.message }));
    }
  });
}

/* Anthropic 代理：POST /api/chat-anthropic
 * body: { key, payload } → https://api.anthropic.com/v1/messages */
function proxyAnthropic(req, res) {
  let body = '';
  req.on('data', c => { body += c; if (body.length > 2 * 1024 * 1024) req.destroy(); });
  req.on('end', async () => {
    let data;
    try { data = JSON.parse(body || '{}'); } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: 'bad json' })); return; }
    const key = data.key || '';
    const payload = data.payload || {};
    if (!key) { res.writeHead(400); res.end(JSON.stringify({ error: 'missing api key' })); return; }
    try {
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
      });
      const text = await upstream.text();
      res.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(text);
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'proxy failed: ' + e.message }));
    }
  });
}

/* Gemini 代理：POST /api/chat-gemini
 * body: { key, model, payload } → .../models/{model}:generateContent?key=KEY */
function proxyGemini(req, res) {
  let body = '';
  req.on('data', c => { body += c; if (body.length > 2 * 1024 * 1024) req.destroy(); });
  req.on('end', async () => {
    let data;
    try { data = JSON.parse(body || '{}'); } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: 'bad json' })); return; }
    const key = data.key || '';
    const model = data.model || '';
    const payload = data.payload || {};
    if (!key) { res.writeHead(400); res.end(JSON.stringify({ error: 'missing api key' })); return; }
    if (!model) { res.writeHead(400); res.end(JSON.stringify({ error: 'missing model' })); return; }
    try {
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
        encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key);
      const upstream = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await upstream.text();
      res.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(text);
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'proxy failed: ' + e.message }));
    }
  });
}

function parseDocRoute(req, res) {
  let body = [];
  req.on('data', c => { body.push(c); if (body.length > 100 * 1024 * 1024) req.destroy(); });
  req.on('end', async () => {
    try {
      const WordExtractor = require('word-extractor');
      const extractor = new WordExtractor();
      const doc = await extractor.extract(Buffer.concat(body));
      let paragraphs;
      if (doc.getParagraphs) {
        paragraphs = doc.getParagraphs().map(p => (typeof p === 'string' ? p : String(p)).trim()).filter(t => t);
      } else {
        // 新版 API：getBody() 直接返回字符串
        paragraphs = String(doc.getBody() || '').split(/\r?\n+/).map(t => t.trim()).filter(Boolean);
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ text: paragraphs.join('\n'), paragraphs: paragraphs }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'DOC 解析失败：' + e.message + '（也可在 Word/WPS 中另存为 .docx 后上传）' }));
    }
  });
}

function createServer(root) {
  return http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.startsWith('/api/chat')) {
      if (req.url.startsWith('/api/chat-anthropic')) { proxyAnthropic(req, res); return; }
      if (req.url.startsWith('/api/chat-gemini')) { proxyGemini(req, res); return; }
      proxyOpenAI(req, res); return;
    }
    if (req.method === 'POST' && req.url.startsWith('/api/parse-doc')) { parseDocRoute(req, res); return; }
    if (req.method === 'GET' || req.method === 'HEAD') { serveStatic(req, res, req.url, root); return; }
    res.writeHead(405); res.end('Method Not Allowed');
  });
}

function lanAddresses() {
  const list = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const it of ifs[name] || []) {
      if (it.family === 'IPv4' && !it.internal) list.push(it.address);
    }
  }
  return list;
}

function resolveRoot(root) {
  if (fs.existsSync(path.join(root, 'index.html'))) return root;
  if (fs.existsSync(path.join(root, 'web', 'index.html'))) return path.join(root, 'web');
  return root;
}

/**
 * 启动服务器。opts: { port, lan, silent, root, noOpen }
 * 端口被占用时自动顺延；返回实际端口。
 */
function startServer(opts) {
  opts = opts || {};
  const basePort = opts.port || PORT;
  const root = resolveRoot(opts.root || ROOT);
  const lan = !!opts.lan;
  const silent = !!opts.silent;
  const host = lan ? '0.0.0.0' : '127.0.0.1';
  const server = createServer(root);

  return new Promise((resolve, reject) => {
    function tryListen(port, attempts) {
      server.once('error', err => {
        if (err.code === 'EADDRINUSE' && attempts > 0) {
          tryListen(port + 1, attempts - 1);
        } else {
          reject(err);
        }
      });
      server.listen(port, host, () => {
        const actualPort = server.address().port;
        if (!silent) {
          console.log('论文降重助手已启动: http://127.0.0.1:' + actualPort);
          if (lan) {
            for (const ip of lanAddresses()) {
              console.log('  局域网访问: http://' + ip + ':' + actualPort);
            }
          }
          console.log('（按 Ctrl+C 停止）');
          if (process.platform === 'win32' && !opts.noOpen) {
            exec('start "" "http://127.0.0.1:' + actualPort + '"', { windowsHide: true }, () => {});
          } else if (process.platform === 'darwin' && !opts.noOpen) {
            exec('open "http://127.0.0.1:' + actualPort + '"', { windowsHide: true }, () => {});
          }
        }
        resolve({ port: actualPort, server: server });
      });
    }
    tryListen(basePort, 20);
  });
}

/* 独立运行时：解析 --lan */
if (require.main === module) {
  const lan = process.argv.includes('--lan');
  startServer({ port: PORT, lan: lan }).catch(err => {
    console.error('启动失败: ' + err.message);
    process.exit(1);
  });
} else {
  module.exports = { startServer: startServer, createServer: createServer, lanAddresses: lanAddresses };
}
