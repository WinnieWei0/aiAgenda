/**
 * 方法是什么：把本地全部云函数部署到指定 CloudBase 环境。
 * 方法作用：按目录逐个 zip 上传函数代码，替代微信开发者工具的手工部署。
 * 为什么添加：本地公共包刷新后云端版本经常过期，脚本化部署可以保证云函数与本地代码一致。
 */
const fs = require('fs');
const path = require('path');
const manager = require('@cloudbase/manager-node');

const FUNCTION_ROOT = path.join(process.cwd(), 'cloudfunctions');
const SKIP_DIRS = new Set(['common']);

/**
 * 方法是什么：读取部署配置。
 * 方法作用：要求显式指定目标环境和密钥，防止误部署到其他环境。
 * 为什么添加：部署会覆盖云端代码，必须显式指定目标。
 */
function getConfig() {
  const envId = process.env.TARGET_CLOUDBASE_ENV_ID;
  const secretId = process.env.TENCENTCLOUD_SECRETID || process.env.TCB_SECRET_ID;
  const secretKey = process.env.TENCENTCLOUD_SECRETKEY || process.env.TCB_SECRET_KEY;
  if (!envId) throw new Error('缺少 TARGET_CLOUDBASE_ENV_ID');
  if (!secretId || !secretKey) throw new Error('缺少 TENCENTCLOUD_SECRETID/TENCENTCLOUD_SECRETKEY');
  return { envId, secretId, secretKey };
}

/**
 * 方法是什么：列出待部署的云函数目录。
 * 方法作用：扫描 cloudfunctions 下含 package.json 的目录，跳过公共包目录。
 * 为什么添加：函数目录以文件结构为准，新增函数后无需维护清单。
 */
function listFunctionDirs() {
  return fs.readdirSync(FUNCTION_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !SKIP_DIRS.has(entry.name))
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(FUNCTION_ROOT, name, 'package.json')));
}

/**
 * 方法是什么：读取函数 package.json 中的超时与内存配置。
 * 方法作用：保留每个函数已有的运行参数。
 * 为什么添加：部署代码时不能意外重置 exportAgendaPdf 等函数的超时设置。
 */
function readFunctionOptions(dir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(FUNCTION_ROOT, dir, 'package.json'), 'utf8'));
  const options = { name: dir, handler: 'index.main', runtime: 'Nodejs16.13', installDependency: 'FALSE', ignore: [] };
  const tcb = pkg.cloudbase || {};
  if (tcb.timeout) options.timeout = tcb.timeout;
  if (tcb.memorySize) options.memorySize = tcb.memorySize;
  return options;
}

/**
 * 方法是什么：部署单个云函数。
 * 方法作用：函数已存在时更新代码，不存在时创建后再更新代码。
 * 为什么添加：新函数首次部署和存量函数更新需要走不同入口。
 */
async function deployOne(app, name) {
  const func = readFunctionOptions(name);
  const functionPath = path.join(FUNCTION_ROOT, name);
  try {
    await app.functions.updateFunctionCode({ func, functionPath, deployMode: 'cos' });
    return 'updated';
  } catch (error) {
    const message = String(error && (error.errMsg || error.message) || '');
    if (!/not exist|不存在|ResourceNotFound/i.test(message)) throw error;
    await app.functions.createFunction({ func: Object.assign({}, func, { path: functionPath }), functionRootPath: FUNCTION_ROOT, force: true, deployMode: 'cos' });
    return 'created';
  }
}

/**
 * 方法是什么：执行全量云函数部署。
 * 方法作用：列出目标环境现有函数，逐个部署本地目录并输出结果。
 * 为什么添加：部署结果需要可审计，失败函数需要单独暴露。
 */
async function run() {
  const config = getConfig();
  const app = manager.init({ secretId: config.secretId, secretKey: config.secretKey, envId: config.envId });
  const existing = await app.functions.listFunctions(100, 0);
  console.log(`目标环境 ${config.envId} 现有函数：${(existing || []).map((item) => item.FunctionName || item.name || item).join(', ') || '（空）'}`);
  const dirs = listFunctionDirs();
  console.log(`本地待部署函数 ${dirs.length} 个：${dirs.join(', ')}`);
  const failed = [];
  for (const name of dirs) {
    try {
      const action = await deployOne(app, name);
      console.log(`${name}: ${action}`);
    } catch (error) {
      failed.push(name);
      console.error(`${name}: 部署失败 - ${error && (error.errMsg || error.message) || error}`);
    }
  }
  if (failed.length) throw new Error(`以下函数部署失败：${failed.join(', ')}`);
  console.log('全部云函数部署完成。');
}

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
