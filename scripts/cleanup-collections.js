/**
 * 方法是什么：列出 CloudBase 环境中的全部集合并统计文档数。
 * 方法作用：区分项目在用集合法与历史遗留集合法，为清理提供依据。
 * 为什么添加：前缀统一为 app_ 后，旧的 dev_ 前缀集合仍留在库中，需要先核查再删除。
 */
const fs = require('fs');
const path = require('path');
const manager = require('@cloudbase/manager-node');
const cloud = require('../cloudfunctions/seedWorkbookData/node_modules/wx-server-sdk');

// 项目代码实际读写的逻辑集合，前缀固定为 app_
const IN_USE_LOGICAL = [
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

// 云端历史集合名，用于识别早期未加前缀的旧集合
const LEGACY_NAMES = ['club_members', 'club_pathways', 'meetings', 'clubs'];

/**
 * 方法是什么：读取命令参数与凭据。
 * 方法作用：要求显式指定环境 ID 和密钥，并默认执行 dry-run。
 * 为什么添加：删除集合不可逆，必须默认只读并强制二次确认。
 */
function getConfig() {
  const envId = process.env.TARGET_CLOUDBASE_ENV_ID;
  const secretId = process.env.TENCENTCLOUD_SECRETID || process.env.TCB_SECRET_ID;
  const secretKey = process.env.TENCENTCLOUD_SECRETKEY || process.env.TCB_SECRET_KEY;
  if (!envId) throw new Error('缺少 TARGET_CLOUDBASE_ENV_ID');
  if (!secretId || !secretKey) throw new Error('缺少 TENCENTCLOUD_SECRETID/TENCENTCLOUD_SECRETKEY');
  const apply = process.argv.includes('--apply');
  if (apply && process.env.CONFIRM_DROP_COLLECTIONS !== 'YES') {
    throw new Error('删除集合前必须设置 CONFIRM_DROP_COLLECTIONS=YES 确认可以丢弃');
  }
  return {
    envId,
    secretId,
    secretKey,
    prefix: process.env.DB_COLLECTION_PREFIX || 'app_',
    apply
  };
}

/**
 * 方法是什么：判断集合的分类。
 * 方法作用：把集合标记为在用、孤儿（非 app_ 前缀）或旧命名空间。
 * 为什么添加：删除决策需要可读的分类结果，而不是人工比对集合名。
 */
function classify(name, prefix) {
  const inUse = new Set(IN_USE_LOGICAL.map((item) => `${prefix}${item}`));
  if (inUse.has(name)) return 'in-use';
  if (LEGACY_NAMES.includes(name)) return 'legacy-no-prefix';
  if (!name.startsWith(prefix)) return 'orphan-other-prefix';
  return 'app-unknown';
}

/**
 * 方法是什么：创建指定环境的数据库客户端。
 * 方法作用：以环境 ID 和密钥初始化独立 SDK 实例，用于全量读取集合数据。
 * 为什么添加：删除前必须完整导出有数据的集合，作为可回滚的本地备份。
 */
function createDb(config) {
  const client = cloud.Cloud({
    env: config.envId,
    resourceEnv: config.envId,
    secretId: config.secretId,
    secretKey: config.secretKey
  });
  client.init();
  return client.database();
}

/**
 * 方法是什么：分页读取集合全部记录。
 * 方法作用：按 100 条一页循环读取，直到取完为止。
 * 为什么添加：CloudBase 单次查询有条数上限，备份必须覆盖全部数据。
 */
async function readAll(db, name) {
  const rows = [];
  let skip = 0;
  while (true) {
    const page = await db.collection(name).skip(skip).limit(100).get();
    const batch = page.data || [];
    rows.push(...batch);
    if (batch.length < 100) return rows;
    skip += batch.length;
  }
}

/**
 * 方法是什么：备份有数据的集合到本地文件。
 * 方法作用：把每个待删除集合导出为独立 JSON，并回读校验记录数。
 * 为什么添加：删除不可逆，必须先落地可读的离线副本再执行。
 */
async function backupCollections(config, entries) {
  const dir = path.join(process.cwd(), 'tmp', 'collection-backup', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const db = createDb(config);
  const manifest = [];
  for (const entry of entries) {
    const rows = await readAll(db, entry.name);
    const file = path.join(dir, `${entry.name}.json`);
    fs.writeFileSync(file, JSON.stringify(rows, null, 2), 'utf8');
    const verify = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (verify.length !== rows.length) {
      throw new Error(`备份校验失败：${entry.name} 期望 ${rows.length} 条，实际 ${verify.length} 条`);
    }
    manifest.push({ collection: entry.name, count: rows.length, file });
    console.log(`已备份：${entry.name} -> ${rows.length} 条`);
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return dir;
}

/**
 * 方法是什么：执行集合核查与可选清理。
 * 方法作用：列出全部集合及分类、记录数，备份有数据的孤儿集合后再逐个删除。
 * 为什么添加：让清理过程可审计，默认 dry-run，避免误删在用集合。
 */
async function run() {
  const config = getConfig();
  const app = manager.init({ secretId: config.secretId, secretKey: config.secretKey, envId: config.envId });
  const listResult = await app.database.listCollections();
  const collections = (listResult && listResult.Collections) || [];
  const rows = [];
  const droppable = [];
  for (const item of collections) {
    const name = item.CollectionName || item.TableName;
    const kind = classify(name, config.prefix);
    const total = Number(item.Count) || 0;
    rows.push({ 集合: name, 分类: kind, 记录数: total });
    if (kind === 'orphan-other-prefix' || kind === 'legacy-no-prefix') droppable.push({ name, total });
  }
  rows.sort((a, b) => a.集合.localeCompare(b.集合));
  console.table(rows);
  if (!droppable.length) {
    console.log('没有发现需要清理的孤儿集合。');
    return;
  }
  if (!config.apply) {
    console.log(`dry-run：可清理集合 ${droppable.length} 个 -> ${droppable.map((item) => item.name).join(', ')}`);
    console.log('确认后设置 CONFIRM_DROP_COLLECTIONS=YES 并加 --apply。');
    return;
  }
  const withData = droppable.filter((item) => item.total > 0);
  if (withData.length) {
    const dir = await backupCollections(config, withData);
    console.log(`备份完成，目录：${dir}`);
  }
  for (const item of droppable) {
    await app.database.deleteCollection(item.name);
    console.log(`已删除：${item.name}（原 ${item.total} 条）`);
  }
  console.log(`清理完成，共删除 ${droppable.length} 个集合。`);
}

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
