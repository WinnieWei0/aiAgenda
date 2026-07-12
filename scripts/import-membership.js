const fs = require('fs');
const path = require('path');
const workbookParser = require('../cloudfunctions/seedWorkbookData/workbook-parser');
const cloud = require('../cloudfunctions/seedWorkbookData/node_modules/wx-server-sdk');

const DEFAULT_WORKBOOK_PATH = 'E:\\小程序\\广州双语议程表.xlsx';
const DEFAULT_ENV_ID = 'ai-agenda-d1gxlfuz6843bbed0';
const MAX_MEMBERS = 26;
const REMOVED_FIELDS = ['clubEn', 'clubZh', 'rawRow', 'sourceKey', 'agendaNameZh', 'aliases', 'titleOnAgenda'];

/**
 * 方法是什么：读取本地导入配置。
 * 方法作用：获取 Excel 路径、CloudBase 环境和腾讯云密钥，并提供明确的默认值。
 * 为什么添加：一次性导入应直接在开发机执行，不应把文件路径或密钥写入云函数代码。
 */
function getConfig() {
  const workbookPath = process.argv[2] || process.env.MEMBERSHIP_WORKBOOK_PATH || DEFAULT_WORKBOOK_PATH;
  const envId = process.env.CLOUDBASE_ENV_ID || DEFAULT_ENV_ID;
  const secretId = process.env.TENCENTCLOUD_SECRETID || process.env.TCB_SECRET_ID;
  const secretKey = process.env.TENCENTCLOUD_SECRETKEY || process.env.TCB_SECRET_KEY;
  if (!secretId || !secretKey) {
    const error = new Error('缺少 CloudBase 凭据，请设置 TENCENTCLOUD_SECRETID 和 TENCENTCLOUD_SECRETKEY');
    error.code = 'MISSING_CLOUDBASE_CREDENTIALS';
    throw error;
  }
  return { workbookPath: path.resolve(workbookPath), envId, secretId, secretKey };
}

/**
 * 方法是什么：截取并精简会员记录。
 * 方法作用：只保留前 26 条记录，并删除数据库不需要的字段。
 * 为什么添加：Membership 集合只需要业务字段，避免把导入辅助信息和重复显示字段保存进去。
 */
function prepareMembers(members) {
  return (members || []).slice(0, MAX_MEMBERS).map(function prepareMember(member) {
    const payload = Object.assign({}, member);
    for (const field of REMOVED_FIELDS) {
      delete payload[field];
    }
    return payload;
  });
}

/**
 * 方法是什么：查找已有会员记录。
 * 方法作用：优先按导入行号查找，字段已精简后再按中文名或英文名兜底匹配。
 * 为什么添加：`sourceKey` 不写入数据库后，重复执行仍需更新原会员而不是创建重复记录。
 */
async function findExistingMember(collection, member) {
  const bySourceKey = await collection.where({ sourceKey: member.sourceKey }).limit(1).get();
  if (bySourceKey.data && bySourceKey.data.length) {
    return bySourceKey.data[0];
  }
  if (member.nameZh) {
    const byNameZh = await collection.where({ nameZh: member.nameZh }).limit(1).get();
    if (byNameZh.data && byNameZh.data.length) {
      return byNameZh.data[0];
    }
  }
  if (member.nameEn) {
    const byNameEn = await collection.where({ nameEn: member.nameEn }).limit(1).get();
    if (byNameEn.data && byNameEn.data.length) {
      return byNameEn.data[0];
    }
  }
  return null;
}

/**
 * 方法是什么：按 sourceKey 写入一条会员记录。
 * 方法作用：已有记录执行更新，新记录执行新增，并维护创建和更新时间。
 * 为什么添加：同一张 Excel 可以重复执行导入而不会产生重复会员，同时不保存 sourceKey。
 */
async function upsertMember(collection, member, removeCommand) {
  const existing = await findExistingMember(collection, member);
  const payload = prepareMembers([member])[0];
  const now = new Date().toISOString();
  payload.updatedAt = now;
  if (existing) {
    const updateData = Object.assign({}, payload);
    for (const field of REMOVED_FIELDS) {
      updateData[field] = removeCommand.remove();
    }
    await collection.doc(existing._id).update({ data: updateData });
    return 'updated';
  }
  await collection.add({ data: Object.assign({}, payload, { createdAt: now }) });
  return 'created';
}

/**
 * 方法是什么：删除前 26 条之外的会员记录。
 * 方法作用：清理数据库中之前导入的后续会员，确保集合最终只保留本次指定范围。
 * 为什么添加：用户明确要求后面的 Membership 数据不要保留，单纯停止导入无法清除旧记录。
 */
async function removeExtraMembers(collection, members) {
  const sourceKeys = new Set(members.map(function getSourceKey(member) {
    return member.sourceKey;
  }));
  const names = new Set();
  for (const member of members) {
    if (member.nameZh) {
      names.add(member.nameZh);
    }
    if (member.nameEn) {
      names.add(member.nameEn);
    }
  }
  const result = await collection.limit(1000).get();
  let removed = 0;
  for (const record of result.data || []) {
    const keepBySourceKey = record.sourceKey && sourceKeys.has(record.sourceKey);
    const keepByName = !record.sourceKey && (names.has(record.nameZh) || names.has(record.nameEn));
    if (!keepBySourceKey && !keepByName) {
      await collection.doc(record._id).remove();
      removed += 1;
    }
  }
  return removed;
}

/**
 * 方法是什么：执行 Membership Excel 导入。
 * 方法作用：读取指定工作簿的 Membership 工作表，只写入前 26 条精简记录。
 * 为什么添加：当前需求只保留 Membership 前 26 条数据，不需要导入后续会员或无关字段。
 */
async function run() {
  const config = getConfig();
  if (!fs.existsSync(config.workbookPath)) {
    throw new Error(`找不到 Excel 文件：${config.workbookPath}`);
  }
  cloud.init({
    env: config.envId,
    secretId: config.secretId,
    secretKey: config.secretKey
  });
  const buffer = fs.readFileSync(config.workbookPath);
  const workbook = workbookParser.parseMembershipWorkbook(buffer);
  const db = cloud.database();
  const collection = db.collection('memberships');
  const members = workbook.memberships.slice(0, MAX_MEMBERS);
  const removed = await removeExtraMembers(collection, members);
  const stats = { created: 0, updated: 0, removed, total: 0 };
  for (const member of members) {
    const action = await upsertMember(collection, member, db.command);
    stats[action] += 1;
    stats.total += 1;
    console.log(`${action}: ${member.sourceKey} ${member.nameZh || member.nameEn}`);
  }
  console.log(`Membership 导入完成：新增 ${stats.created}，更新 ${stats.updated}，删除 ${stats.removed}，保留 ${stats.total} 条。`);
  return stats;
}

/**
 * 方法是什么：处理命令行导入异常。
 * 方法作用：输出错误并以失败状态结束，避免误以为数据已经写入。
 * 为什么添加：一次性数据导入失败时必须让命令行和自动化流程明确感知失败。
 */
function handleError(error) {
  console.error(error && error.message ? error.message : error);
  process.exitCode = 1;
}

if (require.main === module) {
  run().catch(handleError);
}

module.exports = { getConfig, prepareMembers, findExistingMember, upsertMember, removeExtraMembers, run };
