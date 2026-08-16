const common = require('agenda-common');

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
  return Object.assign({}, agenda, {
    _id: record._id,
    signupPublicId: record.signupPublicId || '',
    signupSlots: record.signupSlots || [],
    signupVersion: Number(record.signupVersion || 0)
  });
}

/**
 * 方法是什么：查询当前用户草稿。
 * 方法作用：读取最新未过期草稿并清理重复或过期记录。
 * 为什么添加：系统只保留每个用户一份当前议程。
 */
async function getCurrentDraft(openid) {
  const collection = await common.ensureCollection('agendas');
  const result = await collection.where({ ownerOpenid: openid }).get();
  const records = (result.data || []).sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
  const record = records.length ? records[0] : null;
  if (!record) {
    return null;
  }
  for (const duplicate of records.slice(1)) {
    await collection.doc(duplicate._id).remove();
  }
  return hydrateRecord(record);
}

function toMeetingSummary(record) {
  if (!record) return null;
  const info = record.meetingSummary || record.agenda && record.agenda.meetingInfo || record.meetingInfo || {};
  return {
    _id: record._id || '',
    signupPublicId: record.signupPublicId || '',
    meetingNo: info.meetingNo || '',
    date: info.date || '',
    startTime: info.startTime || '',
    endTime: info.endTime || ''
  };
}

/**
 * 方法是什么：查询最新开放报名的公共会议摘要。
 * 方法作用：从带有 signupPublicId 的会议中返回最近更新的一期。
 * 为什么添加：未绑定宾客没有个人议程，首页仍需要显示当前期数并进入公开报名页。
 */
async function getPublicCurrentSummary(collection) {
  const publicResult = await collection.field({ meetingSummary: true, signupPublicId: true, updatedAt: true }).get();
  const publicRecords = (publicResult.data || [])
    .filter((record) => Boolean(record.signupPublicId))
    .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
  return publicRecords.length ? toMeetingSummary(publicRecords[0]) : null;
}

async function getCurrentSummary(openid) {
  const collection = await common.ensureCollection('agendas');
  const membership = await common.getMembershipByOpenid(openid);
  if (!membership) return getPublicCurrentSummary(collection);
  const result = await collection.where({ ownerOpenid: openid }).field({ meetingSummary: true, signupPublicId: true, updatedAt: true }).get();
  const records = (result.data || []).sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
  if (records.length) {
    if (records[0].meetingSummary) return toMeetingSummary(records[0]);
    return toMeetingSummary(await getCurrentDraft(openid));
  }
  return getPublicCurrentSummary(collection);
}

/**
 * 方法是什么：查询指定议程。
 * 方法作用：读取议程详情并校验归属和有效期。
 * 为什么添加：编辑和导出入口都需要服务端权限控制。
 */
async function getAgenda(openid, agendaId) {
  const collection = await common.ensureCollection('agendas');
  const result = await collection.doc(agendaId).get();
  const record = result.data;
  if (!record) {
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
  const collection = await common.ensureCollection('agendas');
  const result = await collection.where({ ownerOpenid: openid }).limit(20).get();
  const list = [];
  for (const record of result.data || []) {
    list.push(hydrateRecord(record));
  }
  return list;
}

/**
 * 方法是什么：处理议程查询请求。
 * 方法作用：分发 summary、current、get 和兼容 list 操作。
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
    if (action === 'summary') {
      return common.ok({ summary: await getCurrentSummary(openid) });
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

module.exports = { hydrateRecord, toMeetingSummary, getCurrentSummary, getCurrentDraft, getAgenda, main };
exports.main = main;
