# 论文降重助手 · Paper Paraphrase Studio

本地离线运行的论文降重（学术改写）工具，支持**毕业论文（毕设）、数学建模论文、通用学术文本**三类写作场景，内置**权威学术资源知识库**。

> **🌐 在线体验（公网部署）**：https://iridescent-lokum-372719.netlify.app/ —— 无需安装，浏览器打开即用，所有人可访问。
>
> **🖥️ 桌面端**：`desktop/` 目录含 Electron 打包工程（`cd desktop && npm install && npm run dist` 产出单文件便携版 exe）。
>
> **📜 开源许可**：MIT License · 作者：shuaig111

> ⚠ 合规声明：本软件仅用于正当的写作辅助（学习学术改写、规范引用、组织自己的语言）。请遵守所在学校学术规范与《高等学校预防与处理学术不端行为办法》（教育部令第40号）。本地查重估算 ≠ 知网/万方/维普官方检测结果，仅供参考。

## 功能一览

| 功能 | 说明 |
| --- | --- |
| 整篇论文处理 | 上传 **docx / pdf / doc / txt / md / rtf / html**，整篇逐段降重，**按原格式导出**（docx→docx、pdf→pdf…）；Word 的标题样式、页边距、图片、表格、公式全部保留 |
| 智能降重 | 同义词替换（内置 300+ 组学术同义词）＋ 关联词/句式变换 ＋ 主语变体 ＋ 长句拆分 ＋ 适度扩写 |
| 内容保护 | 数学公式（`$...$`、`\[...\]`、Word 公式对象）、参考文献标记 `[1]`、图表编号、英文缩写、数字单位、数学建模术语自动保护，不被误改 |
| 双模式 | 通用论文模式 / 数学建模模式（建模术语保护表与专用同义词自动启用） |
| 三档强度 | 保守（仅同义词）/ 标准（同义词+句式）/ 强力（+长句拆分+套话改写）/ **极强（冲刺低重复率）** |
| 🎯 自动达标 | 设定目标重复率（默认 ≤25%），自动逐级加强迭代（标准→强力→极强），每轮估算直到达标；套话模板库（“针对XX问题”“建立了XX模型”等高频雷同句式）专项改写 |
| 大文档性能 | 10 万字级论文流畅处理（带进度条），查重估算自动抽样防卡顿 |
| 本地查重估算 | 字符 n-gram 相似度估算：改写文 vs 原文重复率、疑似重复句子、全文内部自我重复段落自查 |
| 改写明细 | 逐条列出"原文片段 → 改写后"及所用策略，可一键高亮正文中的改写处 |
| AI 改写（可选） | **多服务商**：DeepSeek / OpenAI GPT / Anthropic Claude / Google Gemini / 自定义 OpenAI 兼容端点（Kimi、智谱、通义、OpenRouter、硅基流动…）。Key 按服务商分别保存在本机浏览器；本地服务内置代理，无跨域问题 |
| 💰 省钱精修 | **混合降重**：先由免费离线引擎全量处理 → 本地估算只挑出仍与原文高度相似的句子交给 AI（通常仅全文 10~30%）→ 费用节省 70~90%，效果不降。模型列表标注价格档位（🟢经济/🟡标准/🔴高配），默认经济型 |
| 导出 | 上传文档按原格式下载；手动内容可复制 / 导出 Word（.doc）/ TXT |
| 知识库 | 已核实的官方查重系统、数学建模竞赛官网、学术规范政策、文献平台链接 + 查重原理/改写八法/引用规范指南 |
| 🛠 高级工具 | 草稿自动保存（防丢失）· 自定义保护词表（界面添加专有名词）· 逐句对照视图 · 查重报告导出（HTML）· 学术写作检查（口语化/冗余结构/超长句检测）· 朗读检查（TTS）· 真 .docx 导出 · 快捷键（Ctrl+Enter 降重等） |
| 🌐 在线工具 | 在线翻译（中↔英，免费 API 无需 Key）· 回译降重（中→英→中）· 在线学术检索（知网/万方/维普/百度学术一键跳转）· 网络诊断（AI 服务连通性检测） |

## 运行方式

### 桌面端（推荐日常使用）
双击 `desktop\dist\论文降重助手-便携版-1.0.0.exe` —— 单文件便携版，无需安装、无需 Node/Python，打开即用（内置本地服务，AI 改写模式直接可用）。
重新打包方法见 `desktop/README.md`。

### 网址版
- **局域网版**：双击 `start-lan.bat`，同一 WiFi 下手机/平板/其他电脑访问 `http://本机IP:8642`（IP 会自动打印）。
- **公网版**：把整个 `paper-dedup` 文件夹拖进 https://app.netlify.com/drop 即可得到 https 网址（AI 改写也能用）。详见 `部署说明.md`。

### 本机运行（三选一）

**方式一：双击 `start.bat`**
自动检测 Node.js / Python 并启动本地服务，自动打开浏览器访问 `http://127.0.0.1:8642`。

**方式二：直接双击 `index.html`**
无需任何环境，离线功能（降重、查重估算、知识库）全部可用；仅 AI 改写模式需要本地服务。

**方式三：手动启动**
```bash
node server.js         # 仅本机
node server.js --lan   # 局域网
python server.py       # Python 备选
```

## 项目结构

```
paper-dedup/
├── index.html            # 主页面
├── css/style.css         # 样式
├── js/
│   ├── dictionary.js     # 同义词词典 + 术语保护表（可自行扩充）
│   ├── engine.js         # 降重引擎（保护/替换/句式/拆分/扩写）
│   ├── checker.js        # 本地查重估算器（n-gram 相似度）
│   ├── knowledge.js      # 知识库数据（权威资源链接）
│   └── app.js            # 界面交互 + AI 改写 + 导出
├── server.js             # Node 本地服务 + DeepSeek 代理 + .doc 解析（支持 --lan）
├── server.py             # Python 备选服务（零第三方依赖，支持 --lan）
├── js/
│   ├── lib/              # 本地化解析库：pdf.js / pdf-lib / fontkit / 中文字体
│   ├── zip.js            # 极简 ZIP 读写（docx 容器，零依赖）
│   ├── docxio.js         # DOCX 解析与格式保留回写（公式/样式/图片保护）
│   ├── pdfio.js          # PDF 解析（pdf.js）与生成（pdf-lib + 思源字体）
│   └── fileio.js         # 文件识别 + txt/md/rtf/html 解析 + .doc 服务调用
├── start.bat / start.ps1         # 本机一键启动
├── start-lan.bat / start-lan.ps1 # 局域网版一键启动
├── netlify.toml          # 公网部署配置（Netlify）
├── netlify/functions/api-chat.mjs  # 公网 AI 代理云函数
├── 部署说明.md           # 网址版（公网/局域网）部署教程
├── test.js / test-doc.js / test-word.js  # 自动化测试
├── desktop/              # 桌面端工程（Electron）
│   ├── main.js           # 桌面端入口（内嵌服务 + 窗口）
│   ├── package.json      # electron-builder 打包配置
│   ├── gen-icon.js       # 应用图标生成（纯 Node）
│   └── dist/             # 打包产物：单文件便携版 exe
└── README.md
```

## 支持的论文格式与导出

| 输入格式 | 降重方式 | 导出格式 | 说明 |
| --- | --- | --- | --- |
| .docx | 段落级（保留样式/图片/表格/公式） | .docx | 推荐，格式还原度最高 |
| .pdf | 文本抽取（段落近似恢复） | .pdf | 扫描版/公式对象 PDF 抽取质量受限 |
| .doc | 服务端解析（word-extractor） | .docx | 需用 start.bat 启动；老格式无法回写 |
| .txt / .md | 段落级 | .txt / .md | 按空行分段 |
| .rtf | 段落级 | .rtf | 简化解析 |
| .html | 段落级 | .html | 按块级元素分段 |

> 说明：PDF 本质是打印格式，文本抽取后按近似排版重新输出（嵌入开源思源字体）；含复杂多栏、公式图片的 PDF 顺序可能失真，建议优先使用 docx。老版 .doc 无法回写为 .doc 二进制，导出为 .docx（Word/WPS 均可打开）。

## AI 服务商接入

内置 5 类服务商：**DeepSeek / OpenAI GPT / Anthropic Claude / Google Gemini / 自定义（OpenAI 兼容）**。界面中即可切换、换模型、分别保存各家的 API Key。

**接入更多服务商**：编辑 `js/ai.js` 的 `PROVIDERS` 数组，按模板加一行即可（保存刷新页面生效）：

```js
{
  id: 'moonshot',                 // 唯一标识
  name: 'Moonshot（Kimi）',        // 显示名
  type: 'openai',                 // openai=兼容格式 / anthropic / gemini
  apiBase: 'https://api.moonshot.cn/v1',  // 接口地址
  models: ['moonshot-v1-8k', 'moonshot-v1-32k'],
  keyHint: '在 platform.moonshot.cn 申请',
  defaultModel: 'moonshot-v1-8k',
},
```

- 已支持的 OpenAI 兼容服务（在界面选"自定义"填地址即可）：Kimi `https://api.moonshot.cn/v1`、智谱 GLM `https://open.bigmodel.cn/api/paas/v4`、通义千问 `https://dashscope.aliyuncs.com/compatible-mode/v1`、OpenRouter `https://openrouter.ai/api/v1`、硅基流动 `https://api.siliconflow.cn/v1`、Groq、Together 等。
- 浏览器直连：仅 Gemini 官方支持 CORS；其余服务商建议通过 `start.bat` 本地服务（内置代理）调用，公网版则使用 Netlify 云函数代理。

## 自定义词典

- 通用同义词：编辑 `js/dictionary.js` 中 `SYNONYM_DICT`（格式 `'原词': ['替换1','替换2']`）
- 数学建模同义词：`MATH_SYNONYMS`；数学建模保护术语：`MATH_TERMS`
- 句式变换：`CONJ_PAIRS`（关联词）、`SUBJECT_VARIANTS`（主语变体）、`EXPAND_PATTERNS`（扩写）、`SPLIT_CONJUNCTIONS`（拆分点）
- 保存后刷新页面即生效。

## 知识库链接来源（编写时经网络检索核实）

- 全国大学生数学建模竞赛官网 https://www.mcm.edu.cn
- 数学建模竞赛论文格式规范（2026修订稿，中国大学生在线） http://dxs.moe.gov.cn/zx/a/hd_sxjm_gsyw/260702/2046411.shtml
- 中国研究生数学建模竞赛 https://www.cmathc.org.cn
- 教育部令第40号（教育部官网/中国政府网）
- GB/T 7714—2015 参考文献著录规则（全国标准信息公共服务平台）
- 中国知网 https://www.cnki.net 、知网个人查重 https://cx.cnki.net
- 万方检测 https://cx.wanfangdata.com.cn 、维普 https://www.cqvip.com
- 国家哲学社会科学文献中心 https://www.ncpssd.org 、中国科技论文在线 https://www.paper.edu.cn

链接如遇失效，请搜索机构官方名称进入。

## 免责声明

本软件不接入任何商业查重系统，不提供"保证过查重"承诺；AI 改写的输出必须人工逐句核对。学术诚信是底线。
