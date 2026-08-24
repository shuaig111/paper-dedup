# 桌面端（Electron）构建说明

## 使用打包好的成品
`dist/论文降重助手-便携版-1.0.0.exe` —— 单文件便携版：
- 双击即用，**无需安装**、无需 Node/Python
- 首次启动稍慢（自解压运行），之后正常
- 内嵌本地服务：AI 改写（DeepSeek）、局域网功能均可用
- 可拷贝到 U 盘/发给同学直接运行（仅支持 Windows 10/11 x64）

## 重新构建
```bash
cd desktop
npm install          # 安装 electron + electron-builder（国内已配置镜像加速）
npm run dist         # 产物输出到 desktop/dist/
```

## 常见问题
- **杀毒软件误报**：便携版 exe 是自解压程序，个别杀软会误报。这是 Electron 便携版的通病，可添加信任；或改用网页版（`start.bat`）。
- **端口冲突**：应用内嵌服务默认 8642 端口，被占用时自动顺延。
- **想改图标**：修改 `gen-icon.js` 后执行 `node gen-icon.js`。
- **想改功能/词典**：修改 `../js/` 下的文件后重新 `npm run dist`（`copy-web.js` 会自动同步）。
