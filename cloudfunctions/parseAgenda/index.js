const common = require('agenda-common');

const LEGACY_FIELDS = [
  'rawText', 'meetingInfo', 'items', 'sections', 'participants', 'warnings', 'unresolvedNames',
  'confidence', 'source', 'expiresAt'
];

/**
 * 方法是什么：分批加载基础数据。
 * 方法作用：读取会员或路径集合的全部记录供 DeepSeek 结果补全。
 * 为什么添加：解析时需要使用数据库中的最新字典。
 */
async function loadAll(collectionName) {
  const db = common.getDb();
  const list = [];
  let skip = 0;
  const pageSize = 100;
  while (true) {
    const res = await db.collection(collectionName).skip(skip).limit(pageSize).get();
    const data = res.data || [];
    list.push(...data);
    if (data.length < pageSize) {
      break;
    }
    skip += data.length;
  }
  return list;
}

/**
 * 方法是什么：构建当前草稿数据。
 * 方法作用：保存编辑人、JSON 议程和更新时间。
 * 为什么添加：解析成功必须立即覆盖全局唯一的长期有效议程。
 */
function buildDraftPayload(agenda, openid, now) {
  const info = agenda && agenda.meetingInfo || {};
  return {
    ownerOpenid: openid,
    agenda,
    meetingSummary: { meetingNo: info.meetingNo || '', date: info.date || '', startTime: info.startTime || '', endTime: info.endTime || '' },
    signupPublicId: common.CURRENT_AGENDA_ID,
    updatedAt: now.toISOString()
  };
}

/**
 * 方法是什么：保存当前用户草稿。
 * 方法作用：更新固定 current 文档并移除旧平面字段。
 * 为什么添加：系统只允许保留一份全局当前议程。
 */
async function saveCurrentDraft(db, openid, agenda) {
  const now = new Date();
  const collection = await common.ensureCollection('agendas');
  const existing = await collection.where({ _id: common.CURRENT_AGENDA_ID }).limit(1).get();
  const payload = buildDraftPayload(agenda, openid, now);
  const record = existing.data && existing.data[0];
  if (record) {
    payload.signupSlots = common.signup.mergeSlots(record.signupSlots, agenda);
    payload.signupVersion = Number(record.signupVersion || 0);
    const updateData = Object.assign({}, payload);
    LEGACY_FIELDS.forEach((field) => {
      updateData[field] = db.command.remove();
    });
    await collection.doc(common.CURRENT_AGENDA_ID).update({ data: updateData });
    return { _id: common.CURRENT_AGENDA_ID };
  }
  await collection.doc(common.CURRENT_AGENDA_ID).set({ data: Object.assign({}, payload, { signupSlots: [], signupVersion: 0, createdAt: now.toISOString() }) });
  return { _id: common.CURRENT_AGENDA_ID };
}

/**
 * 方法是什么：处理接龙解析请求。
 * 方法作用：加载数据库字典、调用 DeepSeek、校验结果并立即入库。
 * 为什么添加：解析功能必须完全使用 DeepSeek 且不能丢失解析结果。
 */
async function main(event) {
  try {
    common.initCloud();
    const openid = common.getOpenid();
    const rawText = common.parser.normalizeText(event && event.rawText);
    if (!rawText) {
      return common.fail('EMPTY_TEXT', '请先粘贴接龙文本');
    }
    const [memberships, pathways, template] = await Promise.all([
      loadAll('memberships'),
      loadAll('pathways'),
      common.getAgendaTemplate()
    ]);
    const aiResult = await common.deepseek.parseAgendaWithDeepSeek(rawText, { timeoutMs: 15000 });
    aiResult.rawText = rawText;
    const headerInfo = common.parser.parseMeetingHeader(rawText);
    aiResult.meetingInfo = Object.assign({}, aiResult.meetingInfo || {}, {
      meetingNo: headerInfo.meetingNo || (aiResult.meetingInfo && aiResult.meetingInfo.meetingNo) || '',
      language: headerInfo.language
    });
    const agenda = common.parser.buildAgendaFromAi(aiResult, memberships, pathways, template);
    const validated = common.parser.validateAgenda(Object.assign({}, agenda, { rawText }));
    const draft = await saveCurrentDraft(common.getDb(), openid, validated);
    const savedAgenda = Object.assign({}, validated, { _id: draft._id, signupPublicId: common.CURRENT_AGENDA_ID });
    return common.ok({ agenda: savedAgenda, aiUsed: true });
  } catch (error) {
    return common.handleError(error);
  }
}

module.exports = { buildDraftPayload, saveCurrentDraft, main };
exports.main = main;
