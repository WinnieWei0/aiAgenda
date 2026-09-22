const fs = require('fs');
const path = require('path');
const cloud = require('../cloudfunctions/seedWorkbookData/node_modules/wx-server-sdk');

const SOURCE_COLLECTIONS = ['memberships', 'pathways', 'agenda_templates', 'agendas'];
const TARGET_COLLECTIONS = {
  memberships: 'club_members',
  pathways: 'club_pathways',
  agenda_templates: 'club_templates',
  agendas: 'meetings'
};

/**
 * 方法是什么：创建指定环境的 CloudBase 客户端。
 * 方法作用：为源库和目标库分别创建独立 SDK 实例，避免 init 单例复用错误环境。
 * 为什么添加：同一进程迁移时必须保证源库只读、目标库只写。
 */
function createClient(envId, secretId, secretKey) {
  if (typeof cloud.Cloud !== 'function') {
    throw new Error('当前 wx-server-sdk 不支持独立 Cloud 实例，不能安全执行跨环境迁移');
  }
  return cloud.Cloud({ resourceEnv: envId, secretId, secretKey });
}

/**
 * 方法是什么：读取迁移配置。
 * 方法作用：要求显式提供源环境、目标环境和凭据，并默认执行 dry-run。
 * 为什么添加：迁移必须保证旧环境只读，避免误写正在使用的用户数据。
 */
function getConfig() {
  const sourceEnv = process.env.SOURCE_CLOUDBASE_ENV_ID;
  const targetEnv = process.env.TARGET_CLOUDBASE_ENV_ID;
  const secretId = process.env.TENCENTCLOUD_SECRETID || process.env.TCB_SECRET_ID;
  const secretKey = process.env.TENCENTCLOUD_SECRETKEY || process.env.TCB_SECRET_KEY;
  if (!sourceEnv || !targetEnv || sourceEnv === targetEnv) {
    throw new Error('必须设置不同的 SOURCE_CLOUDBASE_ENV_ID 和 TARGET_CLOUDBASE_ENV_ID');
  }
  if (!secretId || !secretKey) throw new Error('缺少 TENCENTCLOUD_SECRETID/TENCENTCLOUD_SECRETKEY');
  return {
    sourceEnv,
    targetEnv,
    secretId,
    secretKey,
    prefix: process.env.DB_COLLECTION_PREFIX || 'dev_',
    clubId: process.env.DEFAULT_CLUB_ID || 'default-club',
    apply: process.argv.includes('--apply')
  };
}

/**
 * 方法是什么：删除导入辅助字段。
 * 方法作用：将旧集合记录转换为新模型允许的最小字段集合。
 * 为什么添加：新库不能继续携带历史兼容字段和原始工作表结构。
 */
function sanitizeRecord(collectionName, record, config) {
  const source = record || {};
  const base = { _id: source._id || '', clubId: config.clubId };
  if (collectionName === 'memberships') {
    const fields = ['birthday', 'competitionEligible', 'educationAwards', 'educationProgress', 'educationProgressUpdatedAt', 'email', 'isMentor', 'joinedAt', 'menteeCount', 'mentorName', 'nameEn', 'nameZh', 'nickName', 'notes', 'officerTitleEn', 'officerTitleZh', 'pathNameEn', 'pathNameZh', 'phone', 'quarter', 'status', 'role', 'searchText'];
    fields.forEach((field) => { if (source[field] !== undefined) base[field] = source[field]; });
    return base;
  }
  if (collectionName === 'pathways') {
    ['code', 'fullLabelEn', 'fullLabelZh', 'level', 'objectiveEn', 'objectiveZh', 'searchText'].forEach((field) => { if (source[field] !== undefined) base[field] = source[field]; });
    return base;
  }
  if (collectionName === 'agenda_templates') {
    return Object.assign(base, source, { _id: source._id || '', clubId: config.clubId });
  }
  if (collectionName === 'agendas') {
    return {
      _id: source._id || '',
      clubId: config.clubId,
      ownerOpenid: source.ownerOpenid || '',
      agenda: source.agenda || source,
      meetingSummary: source.meetingSummary || {},
      signupPublicId: source.signupPublicId || 'current',
      signupSlots: Array.isArray(source.signupSlots) ? source.signupSlots : [],
      signupVersion: Number(source.signupVersion || 0),
      updatedAt: source.updatedAt || new Date().toISOString(),
      createdAt: source.createdAt || new Date().toISOString()
    };
  }
  return base;
}

/**
 * 方法是什么：读取源集合全部记录。
 * 方法作用：分页读取旧环境数据，避免单次查询超过 CloudBase 限制。
 * 为什么添加：迁移必须覆盖所有数据，同时保持源库只读。
 */
async function readAll(db, collectionName) {
  const result = [];
  let skip = 0;
  while (true) {
    const page = await db.collection(collectionName).skip(skip).limit(100).get();
    const rows = page.data || [];
    result.push(...rows);
    if (rows.length < 100) return result;
    skip += rows.length;
  }
}

/**
 * 方法是什么：写入目标集合。
 * 方法作用：按旧记录 ID 保持引用并幂等写入新集合，支持 dry-run 统计和重复执行。
 * 为什么添加：迁移失败后可以安全重试，不需要删除新库数据。
 */
async function writeCollection(db, targetName, rows, config) {
  const collection = db.collection(`${config.prefix}${targetName}`);
  const stats = { created: 0, updated: 0, total: rows.length };
  if (!config.apply) return stats;
  for (const row of rows) {
    const payload = Object.assign({}, row);
    const targetId = payload._id;
    delete payload._id;
    if (targetId) {
      let exists = false;
      try {
        const existing = await collection.where({ _id: targetId }).limit(1).get();
        exists = Boolean(existing.data && existing.data.length);
      } catch (error) {
        if (!isMissingCollection(error)) throw error;
      }
      await collection.doc(targetId).set({ data: payload });
      if (exists) {
        stats.updated += 1;
      } else {
        stats.created += 1;
      }
    } else {
      await collection.add({ data: payload });
      stats.created += 1;
    }
  }
  return stats;
}

/**
 * 方法是什么：执行隔离数据库迁移。
 * 方法作用：只从旧环境读取、清洗并写入新环境，输出每个集合的迁移统计。
 * 为什么添加：开发和生产环境初始化需要可审计、可回滚的标准入口。
 */
async function run() {
  const config = getConfig();
  const sourceCloud = createClient(config.sourceEnv, config.secretId, config.secretKey);
  const sourceDb = sourceCloud.database();
  const records = {};
  for (const name of SOURCE_COLLECTIONS) {
    records[name] = await readAll(sourceDb, name);
  }
  if (!config.apply) {
    console.log(JSON.stringify(Object.fromEntries(Object.entries(records).map(([name, rows]) => [name, rows.length])), null, 2));
    console.log('dry-run：未写入任何环境。使用 --apply 才会写入目标环境。');
    return records;
  }
  const targetCloud = createClient(config.targetEnv, config.secretId, config.secretKey);
  const targetDb = targetCloud.database();
  const stats = {};
  for (const name of SOURCE_COLLECTIONS) {
    const cleaned = records[name].map((record) => sanitizeRecord(name, record, config));
    stats[name] = await writeCollection(targetDb, TARGET_COLLECTIONS[name], cleaned, config);
  }
  fs.writeFileSync(path.resolve('output', 'isolated-migration-summary.json'), JSON.stringify({ config: { targetEnv: config.targetEnv, prefix: config.prefix, clubId: config.clubId }, stats }, null, 2));
  console.log(JSON.stringify(stats, null, 2));
  return stats;
}

if (require.main === module) run().catch((error) => { console.error(error.message || error); process.exitCode = 1; });

module.exports = { getConfig, createClient, sanitizeRecord, readAll, writeCollection, run };
