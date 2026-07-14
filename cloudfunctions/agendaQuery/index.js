const common = require('agenda-common');

/**
 * 方法是什么：判断议程草稿是否过期。
 * 方法作用：比较草稿的 expiresAt 与当前时间。
 * 为什么添加：读取和导出都必须阻止访问超过七天的数据。
 */
function isExpired(record, now) {
  const expiry = record && record.expiresAt ? new Date(record.expiresAt).getTime() : NaN;
  return Boolean(!Number.isFinite(expiry) || expiry <= now.getTime());
}

/**
 * 方法是什么：转换数据库议程记录。
 * 方法作用：兼容新 JSON 草稿和旧平面文档并补回文档 ID。
 * 为什么添加：升级期间已有数据仍需要能够打开。
 */
function hydrateRecord(record) {
  if (!record) {
    return null;
  }
  const agenda = record.agenda || record;
  return Object.assign({}, agenda, { _id: record._id, expiresAt: record.expiresAt });
}

/**
 * 方法是什么：查询当前用户草稿。
 * 方法作用：读取最新未过期草稿并清理重复或过期记录。
 * 为什么添加：系统只保留每个用户一份当前议程。
 */
async function getCurrentDraft(openid) {
  const db = common.getDb();
  const collection = db.collection('agendas');
  const result = await collection.where({ ownerOpenid: openid }).get();
  const records = (result.data || []).sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
  const record = records.length ? records[0] : null;
  if (!record) {
    return null;
  }
  if (isExpired(record, new Date())) {
    await collection.doc(record._id).remove();
    return null;
  }
  for (const duplicate of records.slice(1)) {
    await collection.doc(duplicate._id).remove();
  }
  return hydrateRecord(record);
}

/**
 * 方法是什么：查询指定议程。
 * 方法作用：读取议程详情并校验归属和有效期。
 * 为什么添加：编辑和导出入口都需要服务端权限控制。
 */
async function getAgenda(openid, agendaId) {
  const db = common.getDb();
  const result = await db.collection('agendas').doc(agendaId).get();
  const record = result.data;
  if (!record || isExpired(record, new Date())) {
    const notFound = new Error('议程不存在或已过期');
    notFound.code = 'AGENDA_NOT_FOUND';
    throw notFound;
  }
  if (record.ownerOpenid !== openid && !(await common.isAdmin(openid))) {
    const forbidden = new Error('无权查看该议程');
    forbidden.code = 'FORBIDDEN';
    throw forbidden;
  }
  return hydrateRecord(record);
}

/**
 * 方法是什么：查询议程列表。
 * 方法作用：保留旧历史接口的兼容返回，但只返回当前有效草稿。
 * 为什么添加：移除历史页面后仍避免旧客户端调用失败。
 */
async function listAgendas(openid) {
  const db = common.getDb();
  const result = await db.collection('agendas').where({ ownerOpenid: openid }).limit(20).get();
  const list = [];
  for (const record of result.data || []) {
    if (!isExpired(record, new Date())) {
      list.push(hydrateRecord(record));
    }
  }
  return list;
}

/**
 * 方法是什么：处理议程查询请求。
 * 方法作用：分发 current、get 和兼容 list 操作。
 * 为什么添加：小程序重启后需要从服务端恢复当前草稿。
 */
async function main(event) {
  try {
    common.initCloud();
    const openid = common.getOpenid();
    const action = event && event.action ? event.action : 'current';
    if (action === 'current') {
      return common.ok({ agenda: await getCurrentDraft(openid) });
    }
    if (action === 'list') {
      return common.ok({ list: await listAgendas(openid) });
    }
    if (action === 'get') {
      return common.ok({ agenda: await getAgenda(openid, event.id) });
    }
    return common.fail('UNKNOWN_ACTION', '不支持的议程查询操作');
  } catch (error) {
    return common.handleError(error);
  }
}

module.exports = { isExpired, hydrateRecord, getCurrentDraft, getAgenda, main };
exports.main = main;
