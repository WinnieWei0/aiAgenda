# AI 议程生成小程序

这是一个原生微信小程序 + CloudBase + DeepSeek 的议程生成系统。用户粘贴微信群接龙文本后，云函数会调用 DeepSeek 生成结构化议程，前端提供模块化表单、拖拽排序、保存和中英文 PDF 导出。

当前议程使用 `AgendaV2` 固定规则模型：DeepSeek 只提取接龙事实，系统模板负责环节结构、字段权限、过渡时间和 PDF 版式。系统身份来自 `club_members.role`，超管和管理员拥有基础数据、模板及会议管理权限。

## 目录

- `miniprogram/`：原生微信小程序页面和工具。
- `cloudfunctions/`：CloudBase 云函数。
- `cloudfunctions/common/`：云函数复用的权限、解析、DeepSeek、PDF、数据库工具。
- `cloudfunctions/agendaTemplate/`：全局两页模板的初始化、保存和议程视图解析。
- `cloudfunctions/agendaQuery/`：当前七天议程草稿和单条议程的服务端查询。
- `cloudfunctions/lookupOptions/`：编辑页会员和 Pathways 的服务端候选搜索。
- `cloudfunctions/membershipInvites/`：创建和领取 24 小时一次性会员身份邀请。
- `cloudfunctions/seedWorkbookData/workbook-parser.js`：解析 Excel 中的 Membership / Pathways 工作表。
- `scripts/check-comments.js`：中文三段式方法注释检查。
- `tests/run-tests.js`：核心解析与 Excel 导入测试。
- `scripts/migrate-isolated-data.js`：从旧环境只读复制并清洗到新环境。
- `scripts/provision-isolated-schema.js`：按 schema 清单创建隔离集合和默认俱乐部。
- `data/isolated-schema.json`：开发/生产隔离集合、字段白名单和唯一键清单。

## 环境变量

在 CloudBase 云函数环境中配置：

- `DEEPSEEK_API_KEY`：DeepSeek API Key。
- `DEEPSEEK_MODEL`：可选，默认 `deepseek-v4-flash`。
- DeepSeek 请求超时时间固定为 15000ms，不使用规则解析降级。
- `PDF_FONT_PATH`：可选，中文字体路径。项目已在 `cloudfunctions/common/fonts/` 内置一份中文字体，默认可直接生成中文 PDF。
- `APP_ENV`：`development` 或 `production`，决定集合命名空间。
- `DB_COLLECTION_PREFIX`：可选，默认开发环境为 `dev_`、生产环境为 `prod_`。
- `DEFAULT_CLUB_ID`：当前默认俱乐部 ID，默认 `default-club`。

`parseAgenda` 云函数的 CloudBase 执行超时时间需要设置为至少 20 秒，为 DeepSeek 15 秒请求和数据库读取留出运行余量。

## 初始化顺序

1. 在微信开发者工具中打开项目。
2. 将 `project.config.json` 里的 `appid` 替换为真实小程序 AppID。
3. 在 `miniprogram/config/environment.js` 中分别配置开发和生产 CloudBase 环境 ID。
4. 执行 `npm run install:cloudfunctions` 安装所有云函数依赖。该脚本会使用 `--install-links`，避免本地公共包以 Windows 链接形式上传后导致云端运行时报 `Invalid or unexpected token`。
5. 在云开发控制台打开 `exportAgendaPdf` 的函数配置，将超时时间设置为 60 秒、内存设置为 512 MB。普通云函数默认只有 3 秒，无法稳定完成字体嵌入、图片下载、PDF 生成和云存储上传。
5. 上传并部署云函数。
6. 使用外部工作簿初始化新环境的会员和 Pathways 数据。脚本必须显式指定目标环境，不会写入旧环境。

```powershell
$env:TARGET_CLOUDBASE_ENV_ID = '你的新环境 ID'
$env:DB_COLLECTION_PREFIX = 'dev_'
$env:TENCENTCLOUD_SECRETID = '你的 SecretId'
$env:TENCENTCLOUD_SECRETKEY = '你的 SecretKey'
npm run import:membership -- '你的工作簿路径.xlsx'
npm run import:pathways -- '你的工作簿路径.xlsx'
npm run migrate:membership-roles -- '管理员 openid'
```

迁移现有数据时先执行 dry-run，再使用 `--apply` 写入新环境：

```powershell
$env:SOURCE_CLOUDBASE_ENV_ID = '旧环境 ID'
$env:TARGET_CLOUDBASE_ENV_ID = '新环境 ID'
npm run migrate:isolated
npm run migrate:isolated -- --apply
```

初始化新环境集合时先执行 dry-run，再使用 `--apply`：

```powershell
$env:TARGET_CLOUDBASE_ENV_ID = '新环境 ID'
$env:APP_ENV = 'development'
npm run provision:isolated
npm run provision:isolated -- --apply
```

脚本只导入 `Membership` 工作表的前 26 条记录，并写入新环境的 `dev_club_members` / `prod_club_members` 集合。重复执行会按业务键更新，不会修改旧集合。
`import:pathways` 会导入同一文件中 `Pathways(新)` 工作表的全部项目到隔离集合，按 `code` 更新，并只保留路径白名单字段。

## 开发验证

```bash
npm run verify
```

该命令会检查所有 JS 方法是否有中文三段式注释，并运行核心解析测试。

## 模板工作流

1. 超管或管理员可在首页维护模板，并通过“邀请绑定”向未绑定会员发送一次性身份邀请。
2. 普通会员解析接龙后只能修改模板规则开放的人员、俱乐部、时长、备稿和例会群二维码。
3. 编辑器保存后进入 A4 模板预览页，再从预览页导出 PDF。
4. 模板只有一个当前版本，保存后立即作用于所有未过期草稿的预览和导出。

部署前需重新执行 `npm run install:cloudfunctions`，确保所有云函数中的 `agenda-common` 副本包含最新 AgendaV2 和模板素材。

## 数据权限建议

上线时建议把云数据库集合默认设置为仅云函数可读写。`meetings` 的列表和详情读取已经通过 `agendaQuery` 云函数做 owner/admin 校验；`club_members`、`club_pathways` 的候选搜索通过 `lookupOptions` 云函数处理；会员、路径、角色和邀请绑定都在云函数中校验，并按 `clubId` 隔离。
