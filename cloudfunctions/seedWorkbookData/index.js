const common = require('agenda-common');
const workbookParser = require('./workbook-parser');

const MEMBER_FIELDS = [
  'birthday', 'competitionEligible', 'educationAwards', 'educationProgress', 'educationProgressUpdatedAt',
  'email', 'isMentor', 'joinedAt', 'menteeCount', 'mentorName', 'nameEn', 'nameZh', 'nickName', 'notes',
  'officerTitleEn', 'officerTitleZh', 'pathNameEn', 'pathNameZh', 'phone', 'quarter', 'status', 'role'
];
const PATHWAY_FIELDS = ['code', 'fullLabelEn', 'fullLabelZh', 'level', 'objectiveEn', 'objectiveZh'];

/**
 * 方法是什么：清洗 Excel 会员记录。
 * 方法作用：只保留会员业务白名单、俱乐部作用域和搜索字段。
 * 为什么添加：云端上传入口不能把工作表原始结构写入新数据库。
 */
function sanitizeMembership(member) {
  const payload = { clubId: common.config.getConfig().clubId };
  MEMBER_FIELDS.forEach((field) => {
    payload[field] = member[field] === undefined || member[field] === null ? '' : member[field];
  });
  payload.role = common.normalizeMembershipRole(payload.role || 'member');
  payload.status = payload.status || 'active';
  payload.searchText = [payload.nickName, payload.nameZh, payload.nameEn, payload.mentorName, payload.officerTitleZh, payload.officerTitleEn, payload.pathNameZh, payload.pathNameEn]
    .filter(Boolean).join(' ').toLowerCase();
  return payload;
}

/**
 * 方法是什么：清洗 Excel 路径记录。
 * 方法作用：只保留路径业务白名单、俱乐部作用域和搜索字段。
 * 为什么添加：Pathways 的工作表辅助列不属于运行时业务数据。
 */
function sanitizePathway(pathway) {
  const payload = { clubId: common.config.getConfig().clubId };
  PATHWAY_FIELDS.forEach((field) => {
    payload[field] = pathway[field] === undefined || pathway[field] === null ? '' : pathway[field];
  });
  payload.searchText = [payload.code, payload.level, payload.fullLabelEn, payload.fullLabelZh, payload.objectiveEn, payload.objectiveZh]
    .filter(Boolean).join(' ').toLowerCase();
  return payload;
}

/**
 * 方法是什么：批量写入指定集合的种子数据。
 * 方法作用：按照唯一键逐条 upsert，返回创建和更新数量。
 * 为什么添加：初始化 Excel 数据时需要可重复执行，不能每次都产生重复记录。
 */
async function seedCollection(collectionName, uniqueKey, rows) {
  const stats = { created: 0, updated: 0, total: 0 };
  for (const row of rows || []) {
    const result = await common.upsertByKey(collectionName, uniqueKey, row[uniqueKey], row);
    if (result.action === 'created') {
      stats.created += 1;
    }
    if (result.action === 'updated') {
      stats.updated += 1;
    }
    stats.total += 1;
  }
  return stats;
}

/**
 * 方法是什么：下载前端上传的 Excel 文件。
 * 方法作用：通过 CloudBase 文件 ID 获取工作簿二进制内容。
 * 为什么添加：云函数不能访问用户手机上的临时文件，必须先从云存储下载后再解析。
 */
async function downloadWorkbook(event) {
  const fileID = event && (event.fileID || event.fileId);
  if (!fileID) {
    const error = new Error('请先选择要导入的 Excel 文件');
    error.code = 'MISSING_FILE';
    throw error;
  }
  const result = await common.cloud.downloadFile({ fileID });
  if (!result || !result.fileContent || !result.fileContent.length) {
    const error = new Error('无法读取上传的 Excel 文件');
    error.code = 'EMPTY_FILE';
    throw error;
  }
  return result.fileContent;
}

/**
 * 方法是什么：处理 Excel 数据入库请求。
 * 方法作用：解析上传的 Membership 和 Pathways 工作表，并将记录写入数据库。
 * 为什么添加：生产数据源必须是用户选择的 Excel 文件，不能再从代码内置 JSON 导入。
 */
async function main(event) {
  try {
    common.initCloud();
    await common.requireAdmin(common.getOpenid());
    const workbook = workbookParser.parseWorkbook(await downloadWorkbook(event));
    const membershipStats = await seedCollection('memberships', 'nameZh', workbook.memberships.map(sanitizeMembership));
    const pathwayStats = await seedCollection('pathways', 'code', workbook.pathways.map(sanitizePathway));
    return common.ok({
      memberships: membershipStats,
      pathways: pathwayStats,
      sheets: workbook.sheets
    });
  } catch (error) {
    return common.handleError(error);
  }
}

exports.main = main;
module.exports = { sanitizeMembership, sanitizePathway, seedCollection, downloadWorkbook, main };
