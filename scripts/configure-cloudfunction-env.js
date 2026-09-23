const CloudBase = require('@cloudbase/manager-node');

const REQUIRED_VARIABLES = {
  DB_COLLECTION_PREFIX: 'app_',
  DEFAULT_CLUB_ID: '1'
};

/**
 * 方法是什么：读取云函数环境变量更新配置。
 * 方法作用：要求目标环境和腾讯云凭据，并默认只预览修改。
 * 为什么添加：批量配置时必须显式指向新环境，不能误改旧生产环境。
 */
function getConfig() {
  const envId = process.env.TARGET_CLOUDBASE_ENV_ID;
  const secretId = process.env.TENCENTCLOUD_SECRETID || process.env.TCB_SECRET_ID;
  const secretKey = process.env.TENCENTCLOUD_SECRETKEY || process.env.TCB_SECRET_KEY;
  if (!envId) throw new Error('必须设置 TARGET_CLOUDBASE_ENV_ID');
  if (!secretId || !secretKey) throw new Error('缺少 TENCENTCLOUD_SECRETID/TENCENTCLOUD_SECRETKEY');
  return { envId, secretId, secretKey, apply: process.argv.includes('--apply') };
}

/**
 * 方法是什么：把云函数环境变量数组转换为普通对象。
 * 方法作用：保留已有变量，再合并当前系统所需配置。
 * 为什么添加：直接覆盖会误删 DEEPSEEK_API_KEY 等线上配置。
 */
function variablesToObject(environment) {
  const variables = environment && Array.isArray(environment.Variables) ? environment.Variables : [];
  return Object.fromEntries(variables.map((item) => [item.Key, item.Value]));
}

/**
 * 方法是什么：读取目标环境中的全部云函数。
 * 方法作用：分页获取函数名称，避免手工遗漏新旧函数。
 * 为什么添加：集合前缀和俱乐部编号必须在所有业务云函数中一致。
 */
async function listAllFunctions(functions) {
  const result = [];
  let offset = 0;
  while (true) {
    const page = await functions.getFunctionList(100, offset);
    const rows = page.Functions || [];
    result.push(...rows);
    if (result.length >= Number(page.TotalCount || 0) || rows.length === 0) return result;
    offset += rows.length;
  }
}

/**
 * 方法是什么：批量合并云函数环境变量。
 * 方法作用：为目标环境现有函数添加 app_ 前缀和数字俱乐部编号。
 * 为什么添加：登录、会员、模板和会议服务必须读取同一套集合及 clubId。
 */
async function run() {
  const config = getConfig();
  const manager = new CloudBase({ secretId: config.secretId, secretKey: config.secretKey, envId: config.envId });
  const functions = manager.functions;
  const list = await listAllFunctions(functions);
  const stats = [];
  for (const item of list) {
    const name = item.FunctionName;
    const detail = await functions.getFunctionDetail(name);
    const existing = variablesToObject(detail.Environment);
    const merged = Object.assign({}, existing, REQUIRED_VARIABLES);
    if (config.apply) await functions.updateFunctionConfig({ name, envVariables: merged });
    stats.push({ name, existingVariableCount: Object.keys(existing).length, values: REQUIRED_VARIABLES, action: config.apply ? 'updated' : 'planned' });
  }
  console.log(JSON.stringify({ environment: config.envId, functionCount: stats.length, apply: config.apply, stats }, null, 2));
  if (!config.apply) console.log('dry-run：未修改云函数。使用 --apply 才会合并环境变量。');
  return stats;
}

if (require.main === module) run().catch((error) => { console.error(error.message || error); process.exitCode = 1; });

module.exports = { REQUIRED_VARIABLES, getConfig, variablesToObject, listAllFunctions, run };
