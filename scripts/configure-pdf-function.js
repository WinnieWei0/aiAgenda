const FUNCTION_NAME = 'exportAgendaPdf';
const TIMEOUT_SECONDS = 60;
const MEMORY_MB = 512;

/**
 * 方法是什么：读取 PDF 云函数配置所需的目标环境和凭据。
 * 方法作用：限制配置更新只作用于显式指定的 CloudBase 环境。
 * 为什么添加：本地部署清单不会自动修改已部署函数的运行超时。
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
 * 方法是什么：检查并更新已部署 PDF 函数的执行限制。
 * 方法作用：默认只显示当前值，显式传入 --apply 时设置 60 秒和 512 MB。
 * 为什么添加：字体嵌入及 PDF 上传无法稳定在默认 3 秒限制内完成。
 */
async function run(configValue, functionService) {
  const config = configValue || getConfig();
  const functions = functionService || new (require('@cloudbase/manager-node'))({ secretId: config.secretId, secretKey: config.secretKey, envId: config.envId }).functions;
  const current = await functions.getFunctionDetail(FUNCTION_NAME);
  const before = { timeout: Number(current.Timeout), memorySize: Number(current.MemorySize) };
  if (config.apply) {
    await functions.updateFunctionConfig({ name: FUNCTION_NAME, timeout: TIMEOUT_SECONDS, memorySize: MEMORY_MB });
  }
  const result = {
    environment: config.envId,
    functionName: FUNCTION_NAME,
    before,
    target: { timeout: TIMEOUT_SECONDS, memorySize: MEMORY_MB },
    action: config.apply ? 'updated' : 'planned'
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) run().catch((error) => { console.error(error.message || error); process.exitCode = 1; });

module.exports = { FUNCTION_NAME, TIMEOUT_SECONDS, MEMORY_MB, getConfig, run };
