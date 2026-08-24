/* 打包前把 Web 资源复制进 desktop/web（electron-builder 只打包 app 目录内文件） */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dest = path.join(__dirname, 'web');

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
for (const item of ['index.html', 'css', 'js', 'README.md']) {
  fs.cpSync(path.join(root, item), path.join(dest, item), { recursive: true });
}
// 桌面端自带的 server.js（dev 与打包后都从本目录加载）
fs.copyFileSync(path.join(root, 'server.js'), path.join(__dirname, 'server.js'));
console.log('Web 资源与 server.js 已复制到 desktop/');
