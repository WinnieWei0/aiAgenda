const cloud = require('../cloudfunctions/seedWorkbookData/node_modules/wx-server-sdk');

const CLUB_SCOPED_COLLECTIONS = [
  'club_members',
  'club_pathways',
  'club_templates',
  'meetings',
  'membership_invites'
];

/**
 * 方法是什么：读取俱乐部编号迁移配置。
 * 方法作用：限定目标新环境、集合前缀和数字俱乐部编号。
 * 为什么添加：旧的 default-club 必须一次性迁移，不能在业务代码中长期兼容。
 */
function getConfig() {
  const envId = process.env.TARGET_CLOUDBASE_ENV_ID;
  const secretId = process.env.TENCENTCLOUD_SECRETID || process.env.TCB_SECRET_ID;
  const secretKey = process.env.TENCENTCLOUD_SECRETKEY || process.env.TCB_SECRET_KEY;
  const clubId = Number.parseInt(process.env.DEFAULT_CLUB_ID || '1', 10);
  if (!envId) throw new Error('必须设置 TARGET_CLOUDBASE_ENV_ID');
  if (!secretId || !secretKey) throw new Error('缺少 TENCENTCLOUD_SECRETID/TENCENTCLOUD_SECRETKEY');
  if (!Number.isSafeInteger(clubId) || clubId < 1) throw new Error('DEFAULT_CLUB_ID 必须是正整数');
  return {
    envId,
    secretId,
    secretKey,
    prefix: process.env.DB_COLLECTION_PREFIX || 'app_',
    clubId,
    apply: process.argv.includes('--apply')
  };
}

/**
 * 方法是什么：创建目标环境 CloudBase 客户端。
 * 方法作用：确保迁移只连接用户指定的新环境。
 * 为什么添加：俱乐部编号迁移不能触碰旧生产环境。
 */
function createClient(config) {
  const client = cloud.Cloud({
    env: config.envId,
    resourceEnv: config.envId,
    secretId: config.secretId,
    secretKey: config.secretKey
  });
  client.init();
  return client;
}

/**
 * 方法是什么：读取集合中的全部文档。
 * 方法作用：分页取得记录，供 clubId 类型和旧值检查。
 * 为什么添加：批量 update 可能受条数限制，逐文档迁移更容易审计。
 */
async function readAll(collection) {
  const result = [];
  let skip = 0;
  while (true) {
    const page = await collection.skip(skip).limit(100).get();
    const rows = page.data || [];
    result.push(...rows);
    if (rows.length < 100) return result;
    skip += rows.length;
  }
}

/**
 * 方法是什么：判断记录是否使用待迁移的俱乐部编号。
 * 方法作用：同时识别 default-club 和曾写入的字符串数字 1。
 * 为什么添加：此前多轮初始化可能留下两种旧格式，需要一次收敛为数值。
 */
function needsMigration(value, clubId) {
  return value === 'default-club' || value === String(clubId);
}

/**
 * 方法是什么：迁移单个业务集合的 clubId。
 * 方法作用：将旧字符串编号逐条更新为目标数字编号。
 * 为什么添加：登录、模板和会议查询要求所有关联集合使用相同字段类型。
 */
async function migrateCollection(db, name, config) {
  const collection = db.collection(`${config.prefix}${name}`);
  const rows = await readAll(collection);
  const targets = rows.filter((row) => needsMigration(row.clubId, config.clubId));
  if (config.apply) {
    for (const row of targets) {
      await collection.doc(row._id).update({ data: { clubId: config.clubId } });
    }
  }
  return { total: rows.length, migrated: targets.length };
}

/**
 * 方法是什么：迁移俱乐部主记录。
 * 方法作用：把旧 default-club 文档复制到数字文档 ID，并删除旧文档。
 * 为什么添加：俱乐部列表只能保留一个当前俱乐部，不能同时显示旧占位记录。
 */
async function migrateClubDocument(db, config) {
  const collection = db.collection(`${config.prefix}clubs`);
  const rows = await readAll(collection);
  const numericId = String(config.clubId);
  const numeric = rows.find((row) => row._id === numericId);
  const legacy = rows.find((row) => row._id === 'default-club');
  const source = numeric || legacy;
  if (!source) throw new Error(`未找到 ${config.prefix}clubs 中的当前俱乐部记录`);
  if (config.apply) {
    const payload = Object.assign({}, source, { clubId: config.clubId, updatedAt: new Date().toISOString() });
    delete payload._id;
    await collection.doc(numericId).set({ data: payload });
    if (legacy && legacy._id !== numericId) await collection.doc(legacy._id).remove();
  }
  return { sourceId: source._id, targetId: numericId, removedLegacy: Boolean(legacy && legacy._id !== numericId) };
}

/**
 * 方法是什么：执行当前新环境俱乐部编号迁移。
 * 方法作用：更新俱乐部主记录和所有带 clubId 的业务集合。
 * 为什么添加：把已同步数据从 default-club 安全收敛到递增数字编号。
 */
async function run() {
  const config = getConfig();
  const db = createClient(config).database();
  const stats = { clubs: await migrateClubDocument(db, config) };
  for (const name of CLUB_SCOPED_COLLECTIONS) {
    stats[name] = await migrateCollection(db, name, config);
  }
  console.log(JSON.stringify({ environment: config.envId, prefix: config.prefix, clubId: config.clubId, apply: config.apply, stats }, null, 2));
  if (!config.apply) console.log('dry-run：未更新数据。使用 --apply 才会迁移目标新环境。');
  return stats;
}

if (require.main === module) run().catch((error) => { console.error(error.message || error); process.exitCode = 1; });

module.exports = { CLUB_SCOPED_COLLECTIONS, getConfig, createClient, readAll, needsMigration, migrateCollection, migrateClubDocument, run };
