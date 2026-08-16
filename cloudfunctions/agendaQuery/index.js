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
 * 方法是什么：查询全局当前议程。
 * 方法作用：读取固定 current 文档并转换为前端议程。
 * 为什么添加：系统只保留一份长期有效的全局议程。
 */
async function getCurrentDraft() {
  const collection = await common.ensureCollection('agendas');
  const result = await collection.where({ _id: common.CURRENT_AGENDA_ID }).limit(1).get();
  const record = result.data && result.data[0] || null;
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
 * 方法是什么：查询全局当前会议摘要。
 * 方法作用：只读取固定 current 文档的期数和时间数据。
 * 为什么添加：所有身份必须看到同一期会议摘要。
 */
async function getCurrentSummary() {
  const collection = await common.ensureCollection('agendas');
  const result = await collection.where({ _id: common.CURRENT_AGENDA_ID }).field({ meetingSummary: true, signupPublicId: true, updatedAt: true }).limit(1).get();
  const record = result.data && result.data[0];
  if (!record) return null;
  if (record.meetingSummary) return toMeetingSummary(record);
  return toMeetingSummary(await getCurrentDraft());
}

/**
 * 方法是什么：查询指定议程。
 * 方法作用：读取议程详情并校验归属和有效期。
 * 为什么添加：编辑和导出入口都需要服务端权限控制。
 */
async function getAgenda() {
  const agenda = await getCurrentDraft();
  const record = agenda;
  if (!record) {
    const notFound = new Error('议程不存在或已过期');
    notFound.code = 'AGENDA_NOT_FOUND';
    throw notFound;
  }
  return record;
}

/**
 * 方法是什么：查询议程列表。
 * 方法作用：保留旧历史接口的兼容返回，但只返回当前有效草稿。
 * 为什么添加：移除历史页面后仍避免旧客户端调用失败。
 */
async function listAgendas() {
  const agenda = await getCurrentDraft();
  return agenda ? [agenda] : [];
}

/**
 * 方法是什么：处理议程查询请求。
 * 方法作用：分发 summary、current、get 和兼容 list 操作。
 * 为什么添加：小程序重启后需要从服务端恢复当前草稿。
 */
async function main(event) {
  try {
    common.initCloud();
    const action = event && event.action ? event.action : 'current';
    if (action === 'current') {
      return common.ok({ agenda: await getCurrentDraft() });
    }
    if (action === 'summary') {
      return common.ok({ summary: await getCurrentSummary() });
    }
    if (action === 'list') {
      return common.ok({ list: await listAgendas() });
    }
    if (action === 'get') {
      return common.ok({ agenda: await getAgenda() });
    }
    return common.fail('UNKNOWN_ACTION', '不支持的议程查询操作');
  } catch (error) {
    return common.handleError(error);
  }
}

module.exports = { hydrateRecord, toMeetingSummary, getCurrentSummary, getCurrentDraft, getAgenda, main };
exports.main = main;
