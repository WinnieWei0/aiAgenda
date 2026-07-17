# AI 议程生成小程序

这是一个原生微信小程序 + CloudBase + DeepSeek 的议程生成系统。用户粘贴微信群接龙文本后，云函数会调用 DeepSeek 生成结构化议程，前端提供模块化表单、拖拽排序、保存和中英文 PDF 导出。

当前议程使用 `AgendaV2` 固定规则模型：DeepSeek 只提取接龙事实，系统模板负责环节结构、字段权限、过渡时间和 PDF 版式。首页“我是超管”仅切换本次运行期间的模拟超管状态，不进行真实授权，也不会持久化。

## 目录

- `miniprogram/`：原生微信小程序页面和工具。
- `cloudfunctions/`：CloudBase 云函数。
- `cloudfunctions/common/`：云函数复用的权限、解析、DeepSeek、PDF、数据库工具。
- `cloudfunctions/agendaTemplate/`：全局两页模板的初始化、保存和议程视图解析。
- `cloudfunctions/agendaQuery/`：当前七天议程草稿和单条议程的服务端查询。
- `cloudfunctions/lookupOptions/`：编辑页会员和 Pathways 的服务端候选搜索。
- `cloudfunctions/seedWorkbookData/workbook-parser.js`：解析 Excel 中的 Membership / Pathways 工作表。
- `scripts/check-comments.js`：中文三段式方法注释检查。
- `tests/run-tests.js`：核心解析与 Excel 导入测试。

## 环境变量

在 CloudBase 云函数环境中配置：

- `DEEPSEEK_API_KEY`：DeepSeek API Key。
- `DEEPSEEK_MODEL`：可选，默认 `deepseek-v4-flash`。
- DeepSeek 请求超时时间固定为 15000ms，不使用规则解析降级。
- `PDF_FONT_PATH`：可选，中文字体路径。项目已在 `cloudfunctions/common/fonts/` 内置一份中文字体，默认可直接生成中文 PDF。

`parseAgenda` 云函数的 CloudBase 执行超时时间需要设置为至少 20 秒，为 DeepSeek 15 秒请求和数据库读取留出运行余量。

## 初始化顺序

1. 在微信开发者工具中打开项目。
2. 将 `project.config.json` 里的 `appid` 替换为真实小程序 AppID。
3. 在 `miniprogram/app.js` 中替换 `CLOUDBASE_ENV_ID`。
4. 执行 `npm run install:cloudfunctions` 安装所有云函数依赖。该脚本会使用 `--install-links`，避免本地公共包以 Windows 链接形式上传后导致云端运行时报 `Invalid or unexpected token`。
5. 上传并部署云函数。
6. 执行一次性 Membership 和 Pathways 导入脚本。脚本默认读取 `E:\小程序\广州双语议程表.xlsx`，也可以通过命令行参数传入其他文件路径。

```powershell
$env:CLOUDBASE_ENV_ID = 'ai-agenda-d1gxlfuz6843bbed0'
$env:TENCENTCLOUD_SECRETID = '你的 SecretId'
$env:TENCENTCLOUD_SECRETKEY = '你的 SecretKey'
npm run import:membership -- 'E:\小程序\广州双语议程表.xlsx'
npm run import:pathways -- 'E:\小程序\广州双语议程表.xlsx'
```

脚本只导入 `Membership` 工作表的前 26 条记录，写入前会清理其余会员并只保留会员白名单字段。重复执行会按姓名更新记录，不会重复创建。
`import:pathways` 会导入同一文件中 `Pathways(新)` 工作表的全部项目到 `pathways` 集合，按 `code` 更新，并只保留路径白名单字段。解析后的议程草稿按用户保存一份，七天后自动失效，下一次解析会覆盖。

## 开发验证

```bash
npm run verify
```

该命令会检查所有 JS 方法是否有中文三段式注释，并运行核心解析测试。

## 模板工作流

1. 在首页点击“我是超管”可进入模拟超管模式，并维护第一页固定内容、议程规则、图片和第二页俱乐部资料。
2. 普通会员解析接龙后只能修改模板规则开放的人员、俱乐部、时长、备稿和例会群二维码。
3. 编辑器保存后进入 A4 模板预览页，再从预览页导出 PDF。
4. 模板只有一个当前版本，保存后立即作用于所有未过期草稿的预览和导出。

部署前需重新执行 `npm run install:cloudfunctions`，确保所有云函数中的 `agenda-common` 副本包含最新 AgendaV2 和模板素材。

## 数据权限建议

上线时建议把云数据库集合默认设置为仅云函数可读写。`agendas` 的列表和详情读取已经通过 `agendaQuery` 云函数做 owner/admin 校验；Membership、Pathways 的候选搜索通过 `lookupOptions` 云函数处理；Membership、Pathways、roles 的维护也都在管理员云函数中校验。
