const fs = require('fs');
const membershipImporter = require('./import-membership');
const workbookParser = require('../cloudfunctions/seedWorkbookData/workbook-parser');
const cloud = require('../cloudfunctions/seedWorkbookData/node_modules/wx-server-sdk');

/**
 * 方法是什么：按 sourceKey 写入一条 Pathways 记录。
 * 方法作用：已有项目执行更新，新项目执行新增，并维护创建和更新时间。
 * 为什么添加：同一张 Pathways 表可以重复导入而不会创建重复项目。
 */
async function upsertPathway(collection, pathway) {
  const existing = await collection.where({ sourceKey: pathway.sourceKey }).limit(1).get();
  const now = new Date().toISOString();
  const payload = Object.assign({}, pathway, { updatedAt: now });
  if (existing.data && existing.data.length) {
    await collection.doc(existing.data[0]._id).update({ data: payload });
    return 'updated';
  }
  await collection.add({ data: Object.assign({}, payload, { createdAt: now }) });
  return 'created';
}

/**
 * 方法是什么：执行 Pathways Excel 导入。
 * 方法作用：读取指定工作簿的 Pathways(新) 工作表并直接写入 pathways 集合。
 * 为什么添加：Pathways 项目描述必须来自 Excel，不能继续依赖代码内置数据。
 */
async function run() {
  const config = membershipImporter.getConfig();
  if (!fs.existsSync(config.workbookPath)) {
    throw new Error(`找不到 Excel 文件：${config.workbookPath}`);
  }
  cloud.init({
    env: config.envId,
    secretId: config.secretId,
    secretKey: config.secretKey
  });
  const workbook = workbookParser.parsePathwaysWorkbook(fs.readFileSync(config.workbookPath));
  const db = cloud.database();
  const collection = db.collection('pathways');
  const stats = { created: 0, updated: 0, total: 0 };
  for (const pathway of workbook.pathways) {
    const action = await upsertPathway(collection, pathway);
    stats[action] += 1;
    stats.total += 1;
    console.log(`${action}: ${pathway.sourceKey} ${pathway.code} ${pathway.projectNameZh || pathway.projectNameEn}`);
  }
  console.log(`Pathways 导入完成：新增 ${stats.created}，更新 ${stats.updated}，共 ${stats.total} 条。`);
  return stats;
}

/**
 * 方法是什么：处理 Pathways 导入异常。
 * 方法作用：输出错误并以失败状态结束，避免误以为路径数据已经写入。
 * 为什么添加：一次性数据导入失败时必须让命令行明确感知失败。
 */
function handleError(error) {
  console.error(error && error.message ? error.message : error);
  process.exitCode = 1;
}

if (require.main === module) {
  run().catch(handleError);
}

module.exports = { upsertPathway, run };
