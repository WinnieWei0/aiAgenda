const fs = require('fs');
const path = require('path');
const cloud = require('../cloudfunctions/seedWorkbookData/node_modules/wx-server-sdk');

const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/isolated-schema.json'), 'utf8'));

/**
 * 方法是什么：读取目标环境建表配置。
 * 方法作用：要求显式指定新 CloudBase 环境和凭据，默认只执行 dry-run。
 * 为什么添加：建表操作不能因为缺少参数而误触当前正在使用的旧环境。
 */
function getConfig() {
  const envId = process.env.TARGET_CLOUDBASE_ENV_ID;
  const secretId = process.env.TENCENTCLOUD_SECRETID || process.env.TCB_SECRET_ID;
  const secretKey = process.env.TENCENTCLOUD_SECRETKEY || process.env.TCB_SECRET_KEY;
  if (!envId) throw new Error('必须设置 TARGET_CLOUDBASE_ENV_ID');
  const apply = process.argv.includes('--apply');
  if (apply && (!secretId || !secretKey)) throw new Error('缺少 TENCENTCLOUD_SECRETID/TENCENTCLOUD_SECRETKEY');
  const environment = String(process.env.APP_ENV || 'development').toLowerCase() === 'production' ? 'production' : 'development';
  return {
    envId,
    secretId,
    secretKey,
    prefix: process.env.DB_COLLECTION_PREFIX || schema.environmentNamespaces[environment],
    clubId: process.env.DEFAULT_CLUB_ID || schema.defaultClubId,
    apply
  };
}

/**
 * 方法是什么：创建指定环境的 CloudBase 客户端。
 * 方法作用：返回只连接目标环境的独立 SDK 实例。
 * 为什么添加：建表脚本必须和旧环境连接完全隔离。
 */
function createClient(config) {
  if (typeof cloud.Cloud !== 'function') throw new Error('当前 wx-server-sdk 不支持独立 Cloud 实例');
  return cloud.Cloud({ resourceEnv: config.envId, secretId: config.secretId, secretKey: config.secretKey });
}

/**
 * 方法是什么：判断集合不存在错误。
 * 方法作用：区分首次建表和其他数据库错误。
 * 为什么添加：重复执行 provision 必须幂等，不能把真实异常吞掉。
 */
function isMissingCollection(error) {
  const code = Number(error && (error.errCode || error.code));
  const message = String(error && (error.errMsg || error.message) || '').toLowerCase();
  return code === -502005 || message.includes('collection not exist') || message.includes('collection_not_exist');
}

/**
 * 方法是什么：创建一个隔离集合。
 * 方法作用：检查集合是否存在，不存在时创建，已存在时保持不变。
 * 为什么添加：开发和生产环境都需要可重复执行的初始化流程。
 */
async function ensureCollection(db, collectionName, apply) {
  try {
    await db.collection(collectionName).limit(1).get();
    return 'exists';
  } catch (error) {
    if (!isMissingCollection(error)) throw error;
    if (!apply) return 'planned';
    await db.createCollection(collectionName);
    return 'created';
  }
}

/**
 * 方法是什么：初始化默认俱乐部记录。
 * 方法作用：为新环境创建可被登录和模板服务读取的匿名俱乐部配置。
 * 为什么添加：空数据库首次启动时不能依赖页面临时拼接俱乐部信息。
 */
async function ensureDefaultClub(db, config) {
  const collection = db.collection(`${config.prefix}clubs`);
  const existing = await collection.doc(config.clubId).get().catch((error) => {
    if (isMissingCollection(error)) return { data: null };
    throw error;
  });
  if (existing.data) return 'exists';
  if (!config.apply) return 'planned';
  const now = new Date().toISOString();
  await collection.doc(config.clubId).set({ data: {
    _id: config.clubId,
    clubId: config.clubId,
    nameZh: '俱乐部名称',
    nameEn: 'Club Name',
    locale: 'zh',
    settings: {},
    createdAt: now,
    updatedAt: now
  } });
  return 'created';
}

/**
 * 方法是什么：执行隔离 schema 初始化。
 * 方法作用：按 schema 清单创建所有 dev_/prod_ 集合并初始化默认俱乐部。
 * 为什么添加：部署人员需要一个不修改旧库的标准建表入口。
 */
async function run() {
  const config = getConfig();
  const collectionNames = Object.keys(schema.collections).map((name) => `${config.prefix}${name}`);
  if (!config.apply) {
    const result = { environment: config.envId, prefix: config.prefix, collections: collectionNames, clubId: config.clubId, apply: false };
    console.log(JSON.stringify(result, null, 2));
    console.log('dry-run：未创建集合。使用 --apply 才会写入目标环境。');
    return result;
  }
  const client = createClient(config);
  const db = client.database();
  const stats = {};
  for (const collectionName of collectionNames) {
    stats[collectionName] = await ensureCollection(db, collectionName, config.apply);
  }
  stats[`${config.prefix}clubs/default`] = await ensureDefaultClub(db, config);
  console.log(JSON.stringify({ environment: config.envId, prefix: config.prefix, stats }, null, 2));
  return stats;
}

if (require.main === module) run().catch((error) => { console.error(error.message || error); process.exitCode = 1; });

module.exports = { schema, getConfig, createClient, isMissingCollection, ensureCollection, ensureDefaultClub, run };
