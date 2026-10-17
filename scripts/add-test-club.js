const cloud = require('../cloudfunctions/seedWorkbookData/node_modules/wx-server-sdk');

/**
 * 方法是什么：读取当前 app_clubs 写入配置。
 * 方法作用：把测试俱乐部写入实际业务数据库，而不是隔离 schema。
 * 为什么添加：测试俱乐部需要立即出现在生产使用的俱乐部列表中。
 */
function getConfig() {
  const envId = process.env.TARGET_CLOUDBASE_ENV_ID;
  const secretId = process.env.TENCENTCLOUD_SECRETID || process.env.TCB_SECRET_ID;
  const secretKey = process.env.TENCENTCLOUD_SECRETKEY || process.env.TCB_SECRET_KEY;
  if (!envId || !secretId || !secretKey) throw new Error('请设置 TARGET_CLOUDBASE_ENV_ID、TENCENTCLOUD_SECRETID、TENCENTCLOUD_SECRETKEY');
  return { envId, secretId, secretKey, apply: process.argv.includes('--apply') };
}

/**
 * 方法是什么：写入测试俱乐部。
 * 方法作用：在 app_clubs/2 创建或更新测试俱乐部及简称。
 * 为什么添加：首页俱乐部列表直接读取该集合，必须有真实记录。
 */
async function run() {
  const config = getConfig();
  const client = cloud.Cloud({ env: config.envId, resourceEnv: config.envId, secretId: config.secretId, secretKey: config.secretKey });
  client.init();
  const data = { clubId: 2, nameZh: '测试俱乐部', nameEn: 'Test Club', shortNameZh: '测试俱乐部', shortNameEn: 'Test Club', locale: 'zh', settings: {}, updatedAt: new Date().toISOString() };
  if (!config.apply) { console.log(JSON.stringify({ collection: 'app_clubs', document: '2', data, apply: false }, null, 2)); return; }
  await client.database().collection('app_clubs').doc('2').set({ data: Object.assign({}, data, { createdAt: new Date().toISOString() }) });
  console.log('已写入 app_clubs/2：测试俱乐部');
}

if (require.main === module) run().catch((error) => { console.error(error.message || error); process.exitCode = 1; });

module.exports = { getConfig, run };
