# AI 议程生成小程序

这是一个原生微信小程序 + CloudBase + DeepSeek 的议程生成系统骨架。用户粘贴微信群接龙文本后，云函数会解析出结构化议程，前端提供可编辑表单、拖拽排序、保存、历史列表和中英文 PDF 导出。

## 目录

- `miniprogram/`：原生微信小程序页面和工具。
- `cloudfunctions/`：CloudBase 云函数。
- `cloudfunctions/common/`：云函数复用的权限、解析、DeepSeek、PDF、数据库工具。
- `cloudfunctions/agendaQuery/`：历史议程和单条议程的服务端权限查询。
- `cloudfunctions/lookupOptions/`：编辑页会员和 Pathways 的服务端候选搜索。
- `cloudfunctions/seedWorkbookData/workbook-parser.js`：解析 Excel 中的 Membership / Pathways 工作表。
- `scripts/check-comments.js`：中文三段式方法注释检查。
- `tests/run-tests.js`：核心解析与 Excel 导入测试。

## 环境变量

在 CloudBase 云函数环境中配置：

- `DEEPSEEK_API_KEY`：DeepSeek API Key。
- `DEEPSEEK_MODEL`：可选，默认 `deepseek-v4-flash`。
- `DEEPSEEK_TIMEOUT_MS`：可选，AI 请求超时时间，限制在 1000-15000ms，默认 15000ms。
- `PDF_FONT_PATH`：可选，中文字体路径。项目已在 `cloudfunctions/common/fonts/` 内置一份中文字体，默认可直接生成中文 PDF。

`parseAgenda` 云函数的 CloudBase 执行超时时间需要设置为至少 20 秒，为 DeepSeek 15 秒请求和数据库读取留出运行余量。

## 初始化顺序

1. 在微信开发者工具中打开项目。
2. 将 `project.config.json` 里的 `appid` 替换为真实小程序 AppID。
3. 在 `miniprogram/app.js` 中替换 `CLOUDBASE_ENV_ID`。
4. 执行 `npm run install:cloudfunctions` 安装所有云函数依赖。该脚本会使用 `--install-links`，避免本地公共包以 Windows 链接形式上传后导致云端运行时报 `Invalid or unexpected token`。
5. 上传并部署云函数。
6. 第一个登录用户在首页点击“领取管理员”。
7. 执行一次性 Membership 导入脚本。脚本默认读取 `E:\小程序\广州双语议程表.xlsx`，也可以通过命令行参数传入其他文件路径。

```powershell
$env:CLOUDBASE_ENV_ID = 'ai-agenda-d1gxlfuz6843bbed0'
$env:TENCENTCLOUD_SECRETID = '你的 SecretId'
$env:TENCENTCLOUD_SECRETKEY = '你的 SecretKey'
npm run import:membership -- 'E:\小程序\广州双语议程表.xlsx'
npm run import:pathways -- 'E:\小程序\广州双语议程表.xlsx'
```

脚本只导入 `Membership` 工作表的前 26 条记录，写入前会清理其余会员，并删除 `clubEn`、`clubZh`、`rawRow`、`sourceKey`、`agendaNameZh`、`aliases`、`titleOnAgenda` 字段。重复执行会按姓名更新记录，不会重复创建。
`import:pathways` 会导入同一文件中 `Pathways(新)` 工作表的全部项目到 `pathways` 集合。

## 开发验证

```bash
npm run verify
```

该命令会检查所有 JS 方法是否有中文三段式注释，并运行核心解析测试。

## 数据权限建议

上线时建议把云数据库集合默认设置为仅云函数可读写。`agendas` 的列表和详情读取已经通过 `agendaQuery` 云函数做 owner/admin 校验；Membership、Pathways 的候选搜索通过 `lookupOptions` 云函数处理；Membership、Pathways、roles 的维护也都在管理员云函数中校验。
