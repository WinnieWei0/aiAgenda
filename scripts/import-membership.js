const fs = require('fs');
const path = require('path');
const workbookParser = require('../cloudfunctions/seedWorkbookData/workbook-parser');
const cloud = require('../cloudfunctions/seedWorkbookData/node_modules/wx-server-sdk');

const DEFAULT_WORKBOOK_PATH = 'E:\\小程序\\广州双语议程表.xlsx';
const DEFAULT_ENV_ID = 'ai-agenda-d1gxlfuz6843bbed0';

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
 * 方法是什么：按 sourceKey 写入一条会员记录。
 * 方法作用：已有记录执行更新，新记录执行新增，并维护创建和更新时间。
 * 为什么添加：同一张 Excel 可以重复执行导入而不会产生重复会员。
 */
async function upsertMember(collection, member) {
  const existing = await collection.where({ sourceKey: member.sourceKey }).limit(1).get();
  const now = new Date().toISOString();
  const payload = Object.assign({}, member, { updatedAt: now });
  if (existing.data && existing.data.length) {
    await collection.doc(existing.data[0]._id).update({ data: payload });
    return 'updated';
  }
  await collection.add({ data: Object.assign({}, payload, { createdAt: now }) });
  return 'created';
}

/**
 * 方法是什么：执行 Membership Excel 导入。
 * 方法作用：读取指定工作簿的 Membership 工作表并直接写入 CloudBase memberships 集合。
 * 为什么添加：当前需求是开发机一次性入库，不需要把 Excel 选择和上传暴露为小程序功能。
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
  const collection = cloud.database().collection('memberships');
  const stats = { created: 0, updated: 0, total: 0 };
  for (const member of workbook.memberships) {
    const action = await upsertMember(collection, member);
    stats[action] += 1;
    stats.total += 1;
    console.log(`${action}: ${member.sourceKey} ${member.nameZh || member.nameEn}`);
  }
  console.log(`Membership 导入完成：新增 ${stats.created}，更新 ${stats.updated}，共 ${stats.total} 条。`);
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

module.exports = { getConfig, upsertMember, run };
