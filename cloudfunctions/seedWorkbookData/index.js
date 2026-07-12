const common = require('agenda-common');
const memberships = require('./data/memberships.json');
const pathways = require('./data/pathways.json');

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
 * 方法是什么：处理 Excel 初始数据入库请求。
 * 方法作用：把从 `广州双语议程表.xlsx` 解析出的 Membership 和 Pathways JSON 写入数据库。
 * 为什么添加：系统首次上线需要基础会员表和 Pathways 表，当前版本允许所有用户执行初始化以降低部署门槛。
 */
async function main() {
  try {
    common.initCloud();
    const membershipStats = await seedCollection('memberships', 'sourceKey', memberships);
    const pathwayStats = await seedCollection('pathways', 'sourceKey', pathways);
    return common.ok({ memberships: membershipStats, pathways: pathwayStats });
  } catch (error) {
    return common.handleError(error);
  }
}

exports.main = main;
