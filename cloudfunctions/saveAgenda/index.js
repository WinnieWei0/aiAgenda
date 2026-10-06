const common = require('agenda-common');

const LEGACY_FIELDS = common.meetingService.LEGACY_FIELDS;

/**
 * 方法是什么：构建议程保存对象。
 * 方法作用：规范化模块、流程行和会议信息后生成 JSON 载荷。
 * 为什么添加：编辑保存和解析保存必须使用相同的数据形状。
 */
function buildAgendaPayload(agenda, template) {
  return common.meetingService.normalizeAgenda(common.agendaModel, agenda, template || common.agendaModel.createDefaultTemplate());
}

/**
 * 方法是什么：构建会议摘要。
 * 方法作用：从规范化议程提取列表、分享和报名页需要的时间字段。
 * 为什么添加：所有页面都通过同一摘要结构读取会议基本信息。
 */
function buildMeetingSummary(agenda) {
  const info = agenda && agenda.meetingInfo || {};
  return {
    meetingNo: info.meetingNo || '',
    date: info.date || '',
    startTime: info.startTime || '',
    endTime: info.endTime || ''
  };
}

/**
 * 方法是什么：读取议程记录中的 JSON 数据。
 * 方法作用：兼容新嵌套议程和旧平面数据格式。
 * 为什么添加：已有草稿升级后仍可被编辑页继续使用。
 */
function getAgendaFromRecord(record) {
  if (!record) {
    return null;
  }
  if (record.agenda) {
    return Object.assign({}, record.agenda, { _id: record._id });
  }
  return Object.assign({}, record);
}

/**
 * 方法是什么：把服务端报名槽位中的人员回写到待保存议程。
 * 方法作用：当编辑页版本过期时，保留最新报名和取消结果。
 * 为什么添加：议程字段可以继续保存，但不能把旧角色人员重新覆盖到同一会议聚合。
 */
function reconcileAgendaWithSlots(agendaValue, slots) {
  return (slots || []).reduce((agenda, slot) => {
    const person = slot.occupied && slot.person || null;
    const profile = person ? {
      memberId: person.memberId || '',
      name: person.rawName || person.displayNameZh || person.displayNameEn || '',
      displayNameZh: person.displayNameZh || person.rawName || '',
      displayNameEn: person.displayNameEn || person.rawName || '',
      club: person.clubZh || person.clubEn || '',
      clubEn: person.clubEn || person.clubZh || '',
      educationAwards: person.educationAwards || '',
      officerTitleZh: person.officerTitleZh || '',
      officerTitleEn: person.officerTitleEn || ''
    } : null;
    return common.signup.writeSlotPerson(agenda, slot, profile);
  }, agendaValue);
}

/**
 * 方法是什么：根据事务内最新会议记录构建保存状态。
 * 方法作用：合并议程编辑、报名槽位、报名明细和版本号。
 * 为什么添加：保存按钮不应因报名变化失败，也不能覆盖并发报名。
 */
function buildSaveState(existing, submitted, template, context) {
  const options = context || {};
  const actualVersion = Number(existing && existing.signupVersion || 0);
  const rawSubmittedVersion = submitted && submitted.signupVersion;
  const submittedSlots = Array.isArray(submitted && submitted.signupSlots) ? submitted.signupSlots : null;
  const submittedVersion = rawSubmittedVersion === undefined || rawSubmittedVersion === null || rawSubmittedVersion === ''
    ? null
    : Number(rawSubmittedVersion);
  let agenda = buildAgendaPayload(submitted, template);
  let currentSlots = [];
  if (existing) {
    const currentAgenda = buildAgendaPayload(getAgendaFromRecord(existing), template);
    currentSlots = common.signup.mergeSlots(existing.signupSlots, currentAgenda);
  }
  const versionReconciled = Boolean(existing && (submittedVersion === null ? actualVersion > 0 : submittedVersion !== actualVersion));
  if (versionReconciled) {
    const submittedSlotById = new Map((submittedSlots || []).map((slot) => [slot.id, slot]));
    const changedSlots = submittedSlots === null
      ? currentSlots
      : currentSlots.filter((slot) => {
        const submittedSlot = submittedSlotById.get(slot.id);
        return String(slot.signupId || '') !== String(submittedSlot && submittedSlot.signupId || '');
      });
    agenda = reconcileAgendaWithSlots(agenda, changedSlots);
    agenda = buildAgendaPayload(agenda, template);
  }
  const signupSlots = common.signup.mergeSlots(currentSlots, agenda);
  const signupSlotIds = new Set(signupSlots.map((slot) => slot.id));
  const signups = existing && Array.isArray(existing.signups)
    ? existing.signups.filter((item) => !item.slotId || signupSlotIds.has(item.slotId))
    : [];
  const payload = {
    clubId: options.clubId,
    ownerOpenid: existing && existing.ownerOpenid || options.openid || '',
    agenda,
    meetingSummary: buildMeetingSummary(agenda),
    signupPublicId: common.CURRENT_AGENDA_ID,
    signupSlots,
    signups,
    signupVersion: actualVersion,
    updatedAt: options.updatedAt
  };
  const responseAgenda = Object.assign({}, agenda, {
    _id: common.CURRENT_AGENDA_ID,
    signupPublicId: common.CURRENT_AGENDA_ID,
    signupSlots,
    signupVersion: actualVersion
  });
  return { payload, responseAgenda, versionReconciled };
}

/**
 * 方法是什么：处理议程保存请求。
 * 方法作用：更新全局唯一的长期有效会议议程。
 * 为什么添加：报名流程以组织者主动重置为生命周期终点。
 */
async function main(event) {
  try {
    common.initCloud();
    const openid = common.getOpenid();
    const submitted = event && event.agenda ? event.agenda : null;
    if (!submitted) {
      return common.fail('EMPTY_AGENDA', '缺少议程数据');
    }
    const db = common.getDb();
    const collection = await common.ensureCollection('agendas');
    const existingResult = await collection.where({ _id: common.CURRENT_AGENDA_ID, clubId: common.config.getConfig().clubId }).limit(1).get();
    const existing = existingResult.data && existingResult.data[0] || null;
    const now = new Date();
    const template = await common.getAgendaTemplate();
    const context = { clubId: common.config.getConfig().clubId, openid, updatedAt: now.toISOString() };
    let state;
    if (existing) {
      state = await db.runTransaction(async (transaction) => {
        const meetingRef = transaction.collection(common.collectionName('agendas')).doc(existing._id);
        const latestResult = await meetingRef.get();
        const latest = latestResult.data;
        const next = buildSaveState(latest, submitted, template, context);
        const updateData = Object.assign({}, next.payload, common.meetingService.legacyRemovalFields(db));
        await meetingRef.update({ data: updateData });
        return next;
      });
      return common.ok({ _id: common.CURRENT_AGENDA_ID, action: 'updated', agenda: state.responseAgenda, signupVersion: state.payload.signupVersion, versionReconciled: state.versionReconciled });
    }
    state = buildSaveState(null, submitted, template, context);
    await collection.doc(common.CURRENT_AGENDA_ID).set({ data: Object.assign({}, state.payload, { createdAt: now.toISOString() }) });
    return common.ok({ _id: common.CURRENT_AGENDA_ID, action: 'created', agenda: state.responseAgenda, signupVersion: state.payload.signupVersion, versionReconciled: false });
  } catch (error) {
    return common.handleError(error);
  }
}

module.exports = { buildAgendaPayload, buildMeetingSummary, getAgendaFromRecord, reconcileAgendaWithSlots, buildSaveState, main };
exports.main = main;
