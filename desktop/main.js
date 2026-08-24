/* 桌面端入口：内嵌启动本地服务 + Electron 窗口
 * 打包：npm run dist（产出单文件便携版 exe）
 */
'use strict';
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { startServer } = require(path.join(__dirname, 'server.js'));

app.setName('论文降重助手');
app.setAppUserModelId('com.paperdedup.app');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let win = null;
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      const { port } = await startServer({ port: 8642, lan: false, silent: true, noOpen: true });
      win = new BrowserWindow({
        width: 1280,
        height: 880,
        minWidth: 940,
        minHeight: 640,
        title: '论文降重助手',
        autoHideMenuBar: true,
        icon: path.join(__dirname, 'build', 'icon.png'),
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
      win.loadURL('http://127.0.0.1:' + port);
      // 知识库外链用系统浏览器打开
      win.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http')) shell.openExternal(url);
        return { action: 'deny' };
      });
      win.on('closed', () => { win = null; });
    } catch (e) {
      console.error('启动失败: ' + e.message);
      app.quit();
    }
  });

  app.on('window-all-closed', () => { app.quit(); });
}
