const fs = require('fs');
const membershipImporter = require('./import-membership');
const workbookParser = require('../cloudfunctions/seedWorkbookData/workbook-parser');
const cloud = require('../cloudfunctions/seedWorkbookData/node_modules/wx-server-sdk');

const PATHWAY_FIELDS = ['code', 'fullLabelEn', 'fullLabelZh', 'level', 'objectiveEn', 'objectiveZh'];
const REMOVED_FIELDS = [
  'sourceKey', 'projectNameEn', 'projectNameZh', 'detailZh', 'skillZh', 'rawRow', 'id'
];

/**
 * 方法是什么：清理路径记录。
 * 方法作用：只生成路径白名单字段和搜索关键词。
 * 为什么添加：Excel 导入不能把旧辅助字段写回数据库。
 */
function preparePathway(pathway) {
  const payload = {};
  for (const field of PATHWAY_FIELDS) {
    payload[field] = pathway[field] === undefined || pathway[field] === null ? '' : pathway[field];
  }
  payload.searchText = [payload.code, payload.fullLabelEn, payload.fullLabelZh, payload.objectiveEn, payload.objectiveZh]
    .filter(Boolean).join(' ').toLowerCase();
  return payload;
}

/**
 * 方法是什么：按 code 更新路径。
 * 方法作用：重复导入时更新现有路径并删除旧字段。
 * 为什么添加：路径 code 是数据库中的稳定业务键。
 */
async function upsertPathway(collection, pathway, removeCommand) {
  const payload = preparePathway(pathway);
  const existing = await collection.where({ code: payload.code }).limit(1).get();
  const now = new Date().toISOString();
  if (existing.data && existing.data.length) {
    const updateData = Object.assign({}, payload, { updatedAt: now });
    for (const field of REMOVED_FIELDS) {
      updateData[field] = removeCommand.remove();
    }
    const allowedFields = new Set(PATHWAY_FIELDS.concat(['searchText', 'createdAt', 'updatedAt']));
    Object.keys(existing.data[0]).forEach(function removeUnknownField(field) {
      if (field !== '_id' && !allowedFields.has(field)) {
        updateData[field] = removeCommand.remove();
      }
    });
    await collection.doc(existing.data[0]._id).update({ data: updateData });
    return 'updated';
  }
  await collection.add({ data: Object.assign({}, payload, { createdAt: now, updatedAt: now }) });
  return 'created';
}

/**
 * 方法是什么：执行路径导入。
 * 方法作用：读取 Excel 的 Pathways 工作表并写入数据库。
 * 为什么添加：路径数据必须直接来源于 Excel。
 */
async function run() {
  const config = membershipImporter.getConfig();
  if (!fs.existsSync(config.workbookPath)) {
    throw new Error(`找不到 Excel 文件：${config.workbookPath}`);
  }
  cloud.init({ env: config.envId, secretId: config.secretId, secretKey: config.secretKey });
  const workbook = workbookParser.parsePathwaysWorkbook(fs.readFileSync(config.workbookPath));
  const collection = cloud.database().collection('pathways');
  const stats = { created: 0, updated: 0, total: 0 };
  for (const pathway of workbook.pathways) {
    const action = await upsertPathway(collection, pathway, cloud.database().command);
    stats[action] += 1;
    stats.total += 1;
    console.log(`${action}: ${pathway.code} ${pathway.fullLabelZh || pathway.fullLabelEn}`);
  }
  console.log(`Pathways 导入完成：新增 ${stats.created}，更新 ${stats.updated}，共 ${stats.total} 条。`);
  return stats;
}

/**
 * 方法是什么：处理导入错误。
 * 方法作用：输出错误并设置失败退出码。
 * 为什么添加：命令行导入失败不能被误认为成功。
 */
function handleError(error) {
  console.error(error && error.message ? error.message : error);
  process.exitCode = 1;
}

if (require.main === module) {
  run().catch(handleError);
}

module.exports = { PATHWAY_FIELDS, preparePathway, upsertPathway, run };
