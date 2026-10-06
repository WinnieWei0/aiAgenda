const CloudBase = require('@cloudbase/manager-node');
const cloud = require('../cloudfunctions/seedWorkbookData/node_modules/wx-server-sdk');

/**
 * 方法是什么：读取内嵌报名迁移配置。
 * 方法作用：要求显式指定目标环境和凭据，并把写入与删除操作设为独立开关。
 * 为什么添加：旧报名集合迁移完成前不能直接删除，默认 dry-run 可以先核对数量。
 */
function getConfig() {
  const envId = process.env.TARGET_CLOUDBASE_ENV_ID;
  const secretId = process.env.TENCENTCLOUD_SECRETID || process.env.TCB_SECRET_ID;
  const secretKey = process.env.TENCENTCLOUD_SECRETKEY || process.env.TCB_SECRET_KEY;
  const apply = process.argv.includes('--apply');
  const dropLegacy = process.argv.includes('--drop-legacy');
  if (!envId) throw new Error('必须设置 TARGET_CLOUDBASE_ENV_ID');
  if ((apply || dropLegacy) && (!secretId || !secretKey)) throw new Error('缺少 TENCENTCLOUD_SECRETID/TENCENTCLOUD_SECRETKEY');
  if (dropLegacy && !apply) throw new Error('--drop-legacy 必须和 --apply 一起使用');
  return { envId, secretId, secretKey, prefix: process.env.DB_COLLECTION_PREFIX || 'app_', apply, dropLegacy };
}

/**
 * 方法是什么：判断 CloudBase 集合不存在错误。
 * 方法作用：允许没有旧报名集合的新环境直接完成迁移检查。
 * 为什么添加：全新环境只需要 meetings.signups，不应因为找不到旧集合而报错。
 */
function isMissingCollection(error) {
  const code = Number(error && (error.errCode || error.code));
  const message = String(error && (error.errMsg || error.message) || '').toLowerCase();
  return code === -502005 || message.includes('collection not exist') || message.includes('collection_not_exist') || message.includes('resource not found');
}

/**
 * 方法是什么：分页读取指定集合。
 * 方法作用：完整读取会议或旧报名数据，并允许旧集合不存在。
 * 为什么添加：迁移不能依赖单次查询的默认条数限制。
 */
async function readAll(db, collectionName) {
  const rows = [];
  let skip = 0;
  while (true) {
    let result;
    try {
      result = await db.collection(collectionName).skip(skip).limit(100).get();
    } catch (error) {
      if (isMissingCollection(error)) return rows;
      throw error;
    }
    const page = result.data || [];
    rows.push(...page);
    if (page.length < 100) return rows;
    skip += page.length;
  }
}

/**
 * 方法是什么：清洗旧集合中的单条报名记录。
 * 方法作用：保留报名业务字段，把旧 `_id` 转成会议数组使用的 `id` 并删除集合引用字段。
 * 为什么添加：内嵌记录不能继续携带 agendaId、meetingId 和 claimId 等旧表结构。
 */
function sanitizeSignup(record) {
  const source = record || {};
  const fields = ['slotId', 'openid', 'memberId', 'personType', 'roleLabel', 'name', 'displayNameZh', 'displayNameEn', 'club', 'clubEn', 'educationAwards', 'officerTitleZh', 'officerTitleEn', 'createdAt', 'updatedAt'];
  const result = { id: source.id || source._id || '' };
  fields.forEach((field) => { if (source[field] !== undefined) result[field] = source[field]; });
  return result;
}

/**
 * 方法是什么：合并会议已有报名和旧集合报名。
 * 方法作用：按稳定 ID 去重并保留会议文档中已经更新的记录。
 * 为什么添加：迁移脚本需要支持重复执行，不能重复插入报名人。
 */
function mergeSignups(existing, legacy) {
  const merged = new Map();
  (legacy || []).map(sanitizeSignup).filter((item) => item.id).forEach((item) => merged.set(item.id, item));
  (existing || []).map(sanitizeSignup).filter((item) => item.id).forEach((item) => merged.set(item.id, item));
  return Array.from(merged.values());
}

/**
 * 方法是什么：删除迁移完成后的旧报名集合。
 * 方法作用：通过 CloudBase 管理接口移除 meeting_signups 和废弃的 signup claims 集合。
 * 为什么添加：业务代码和 schema 已不再使用这些集合，显式开关可完成最终清理。
 */
async function dropLegacyCollections(config) {
  const manager = new CloudBase({ secretId: config.secretId, secretKey: config.secretKey, envId: config.envId });
  const names = [`${config.prefix}meeting_signups`, `${config.prefix}meeting_signup_claims`];
  const result = {};
  for (const name of names) {
    try {
      await manager.database.deleteCollection(name);
      result[name] = 'deleted';
    } catch (error) {
      if (!isMissingCollection(error)) throw error;
      result[name] = 'missing';
    }
  }
  return result;
}

/**
 * 方法是什么：执行独立报名集合到会议聚合的迁移。
 * 方法作用：按会议 ID 合并报名数组，核对孤立记录，并可在成功写入后删除旧集合。
 * 为什么添加：部署新 signupService 前需要保证现有报名数据不会丢失。
 */
async function run() {
  const config = getConfig();
  if (typeof cloud.Cloud !== 'function') throw new Error('当前 wx-server-sdk 不支持独立 Cloud 实例');
  const client = cloud.Cloud({ env: config.envId, resourceEnv: config.envId, secretId: config.secretId, secretKey: config.secretKey });
  client.init();
  const db = client.database();
  const meetingsName = `${config.prefix}meetings`;
  const legacyName = `${config.prefix}meeting_signups`;
  const meetings = await readAll(db, meetingsName);
  const legacySignups = await readAll(db, legacyName);
  const legacyByMeeting = new Map();
  legacySignups.forEach((item) => {
    const meetingId = item.meetingId || item.agendaId || 'current';
    const list = legacyByMeeting.get(meetingId) || [];
    list.push(item);
    legacyByMeeting.set(meetingId, list);
  });
  const meetingIds = new Set(meetings.map((meeting) => meeting._id));
  const orphaned = legacySignups.filter((item) => !meetingIds.has(item.meetingId || item.agendaId || 'current'));
  const stats = meetings.map((meeting) => {
    const existingCount = Array.isArray(meeting.signups) ? meeting.signups.length : 0;
    const signups = mergeSignups(meeting.signups, legacyByMeeting.get(meeting._id));
    return { meetingId: meeting._id, existingCount, legacyCount: (legacyByMeeting.get(meeting._id) || []).length, mergedCount: signups.length, signups };
  });
  if (orphaned.length) throw new Error(`发现 ${orphaned.length} 条无法匹配会议的旧报名记录，请先检查 agendaId/meetingId`);
  if (config.apply) {
    for (const item of stats) {
      await db.collection(meetingsName).doc(item.meetingId).update({ data: { signups: item.signups } });
    }
  }
  const dropped = config.apply && config.dropLegacy ? await dropLegacyCollections(config) : {};
  const output = {
    environment: config.envId,
    meetings: stats.map(({ signups, ...summary }) => summary),
    legacySignupCount: legacySignups.length,
    apply: config.apply,
    dropLegacy: config.dropLegacy,
    dropped
  };
  console.log(JSON.stringify(output, null, 2));
  if (!config.apply) console.log('dry-run：未写入会议。使用 --apply 写入，确认后可再加 --drop-legacy 删除旧集合。');
  return output;
}

if (require.main === module) run().catch((error) => { console.error(error && error.message || error); process.exitCode = 1; });

module.exports = { getConfig, isMissingCollection, readAll, sanitizeSignup, mergeSignups, dropLegacyCollections, run };
