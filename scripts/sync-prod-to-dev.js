const cloud = require('../cloudfunctions/seedWorkbookData/node_modules/wx-server-sdk');

const COLLECTIONS = [
  'clubs',
  'users',
  'club_members',
  'club_pathways',
  'meetings',
  'club_templates',
  'membership_invites',
  'membership_identity_bindings',
  'roles',
  'pdf_exports'
];

/**
 * 方法是什么：创建指定环境的 CloudBase 客户端。
 * 方法作用：为生产库和开发库分别创建独立 SDK 实例，避免 init 单例复用错误环境。
 * 为什么添加：同一进程同步时必须保证生产库只读、开发库只写。
 */
function createClient(envId, secretId, secretKey) {
  if (typeof cloud.Cloud !== 'function') {
    throw new Error('当前 wx-server-sdk 不支持独立 Cloud 实例，不能安全执行跨环境同步');
  }
  const client = cloud.Cloud({ env: envId, resourceEnv: envId, secretId, secretKey });
  client.init();
  return client;
}

/**
 * 方法是什么：读取同步配置。
 * 方法作用：要求显式提供生产环境、开发环境和凭据，并默认执行 dry-run。
 * 为什么添加：覆盖开发库是不可逆操作，必须显式确认后才能写。
 */
function getConfig() {
  const sourceEnv = process.env.SOURCE_CLOUDBASE_ENV_ID || 'ai-agenda-prod-d0g7cdazf8d1e1695';
  const targetEnv = process.env.TARGET_CLOUDBASE_ENV_ID;
  const secretId = process.env.TENCENTCLOUD_SECRETID || process.env.TCB_SECRET_ID;
  const secretKey = process.env.TENCENTCLOUD_SECRETKEY || process.env.TCB_SECRET_KEY;
  if (!targetEnv || sourceEnv === targetEnv) {
    throw new Error('必须设置 TARGET_CLOUDBASE_ENV_ID（开发环境 ID），且不能与生产环境相同');
  }
  if (!secretId || !secretKey) throw new Error('缺少 TENCENTCLOUD_SECRETID/TENCENTCLOUD_SECRETKEY');
  const apply = process.argv.includes('--apply');
  if (apply && process.env.CONFIRM_OVERWRITE !== 'YES') {
    throw new Error('覆盖开发库前必须设置 CONFIRM_OVERWRITE=YES 确认旧数据可以丢弃');
  }
  return {
    sourceEnv,
    targetEnv,
    secretId,
    secretKey,
    prefix: process.env.DB_COLLECTION_PREFIX || 'app_',
    apply
  };
}

/**
 * 方法是什么：判断集合不存在错误。
 * 方法作用：允许同步脚本区分空集合和真实数据库异常。
 * 为什么添加：开发环境集合可能尚未创建，删除或写入前需要容忍缺失。
 */
function isMissingCollection(error) {
  const code = Number(error && (error.errCode || error.code));
  const message = String(error && (error.errMsg || error.message) || '').toLowerCase();
  return code === -502005 || message.includes('collection not exist') || message.includes('collection_not_exist');
}

/**
 * 方法是什么：读取集合全部记录。
 * 方法作用：分页读取生产环境数据，避免单次查询超过 CloudBase 限制。
 * 为什么添加：同步必须覆盖所有数据，同时保持生产库只读。
 */
async function readAll(db, collectionName) {
  const result = [];
  let skip = 0;
  while (true) {
    let page;
    try {
      page = await db.collection(collectionName).skip(skip).limit(100).get();
    } catch (error) {
      if (isMissingCollection(error)) return result;
      throw error;
    }
    const rows = page.data || [];
    result.push(...rows);
    if (rows.length < 100) return result;
    skip += rows.length;
  }
}

/**
 * 方法是什么：清空开发环境集合。
 * 方法作用：删除目标集合中的全部旧记录。
 * 为什么添加：开发环境旧数据确认丢弃，避免与生产数据混杂。
 */
async function clearCollection(db, collectionName) {
  try {
    const result = await db.collection(collectionName).where({ _id: db.command.exists(true) }).remove();
    return Number(result.stats && result.stats.removed || 0);
  } catch (error) {
    if (isMissingCollection(error)) return 0;
    throw error;
  }
}

/**
 * 方法是什么：写入开发环境集合。
 * 方法作用：按生产记录 ID 原样写入开发集合，必要时先创建集合。
 * 为什么添加：保持 _id 一致可以让开发环境完整复现生产数据引用关系。
 */
async function writeCollection(db, collectionName, rows) {
  if (!rows.length) return { written: 0 };
  const collection = db.collection(collectionName);
  try {
    await collection.limit(1).get();
  } catch (error) {
    if (!isMissingCollection(error)) throw error;
    await db.createCollection(collectionName);
  }
  const stats = { written: 0 };
  for (const row of rows) {
    const payload = Object.assign({}, row);
    const targetId = payload._id;
    delete payload._id;
    if (targetId) {
      await collection.doc(targetId).set({ data: payload });
    } else {
      await collection.add({ data: payload });
    }
    stats.written += 1;
  }
  return stats;
}

/**
 * 方法是什么：执行生产到开发的数据同步。
 * 方法作用：只从生产环境读取，清空开发环境目标集合后写入生产数据，输出每个集合的统计。
 * 为什么添加：开发环境需要与生产环境保持一致的数据基线，且操作可审计、默认 dry-run。
 */
async function run() {
  const config = getConfig();
  const sourceDb = createClient(config.sourceEnv, config.secretId, config.secretKey).database();
  const targetDb = createClient(config.targetEnv, config.secretId, config.secretKey).database();
  const summary = {};
  for (const name of COLLECTIONS) {
    const physical = `${config.prefix}${name}`;
    const rows = await readAll(sourceDb, physical);
    const entry = { source: rows.length };
    if (config.apply) {
      entry.removed = await clearCollection(targetDb, physical);
      entry.written = (await writeCollection(targetDb, physical, rows)).written;
    }
    summary[physical] = entry;
    console.log(`${physical}: 生产 ${entry.source} 条` + (config.apply ? `，开发删除 ${entry.removed} 条，写入 ${entry.written} 条` : '（dry-run，未修改开发库）'));
  }
  console.log(config.apply ? '同步完成。' : 'dry-run 完成，加 --apply 并设置 CONFIRM_OVERWRITE=YES 才会真正覆盖开发库。');
  return summary;
}

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
