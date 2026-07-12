const common = require('agenda-common');

/**
 * 方法是什么：清理前端提交的议程数据。
 * 方法作用：只保留保存需要的字段，并补充更新时间、创建人等审计字段。
 * 为什么添加：前端数据可能包含临时状态，入库前清理可以降低脏数据风险。
 */
function buildAgendaPayload(agenda, openid) {
  return {
    rawText: agenda.rawText || '',
    meetingInfo: agenda.meetingInfo || {},
    items: Array.isArray(agenda.items) ? agenda.items : [],
    participants: Array.isArray(agenda.participants) ? agenda.participants : [],
    warnings: Array.isArray(agenda.warnings) ? agenda.warnings : [],
    unresolvedNames: Array.isArray(agenda.unresolvedNames) ? agenda.unresolvedNames : [],
    ownerOpenid: agenda.ownerOpenid || openid,
    updatedAt: common.nowIso()
  };
}

/**
 * 方法是什么：处理议程保存云函数请求。
 * 方法作用：新增或更新用户编辑后的议程记录。
 * 为什么添加：用户解析后会继续编辑流程和排序，需要把最终数据保存到服务器。
 */
async function main(event) {
  try {
    common.initCloud();
    const openid = common.getOpenid();
    const agenda = event && event.agenda ? event.agenda : null;
    if (!agenda) {
      return common.fail('EMPTY_AGENDA', '缺少议程数据');
    }
    const db = common.getDb();
    const payload = buildAgendaPayload(agenda, openid);
    if (agenda._id) {
      await db.collection('agendas').doc(agenda._id).update({ data: payload });
      return common.ok({ _id: agenda._id, action: 'updated' });
    }
    const addRes = await db.collection('agendas').add({
      data: Object.assign({}, payload, { createdAt: common.nowIso() })
    });
    return common.ok({ _id: addRes._id, action: 'created' });
  } catch (error) {
    return common.handleError(error);
  }
}

exports.main = main;
