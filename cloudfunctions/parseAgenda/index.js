const common = require('agenda-common');

const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LEGACY_FIELDS = [
  'rawText', 'meetingInfo', 'items', 'sections', 'participants', 'warnings', 'unresolvedNames',
  'confidence', 'source'
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
 * 方法作用：保存用户、JSON 议程、更新时间和七天过期时间。
 * 为什么添加：解析成功必须立即形成可恢复的数据库草稿。
 */
function buildDraftPayload(agenda, openid, now) {
  return {
    ownerOpenid: openid,
    agenda,
    expiresAt: new Date(now.getTime() + DRAFT_TTL_MS).toISOString(),
    updatedAt: now.toISOString()
  };
}

/**
 * 方法是什么：保存当前用户草稿。
 * 方法作用：更新最新草稿、清理重复记录并移除旧平面字段。
 * 为什么添加：每个用户只允许保留一份当前议程。
 */
async function saveCurrentDraft(db, openid, agenda) {
  const now = new Date();
  const collection = db.collection('agendas');
  const existing = await collection.where({ ownerOpenid: openid }).get();
  const payload = buildDraftPayload(agenda, openid, now);
  const records = (existing.data || []).sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
  if (records.length) {
    const record = records[0];
    for (const duplicate of records.slice(1)) {
      await collection.doc(duplicate._id).remove();
    }
    const updateData = Object.assign({}, payload);
    LEGACY_FIELDS.forEach((field) => {
      updateData[field] = db.command.remove();
    });
    await collection.doc(record._id).update({ data: updateData });
    return { _id: record._id, expiresAt: payload.expiresAt };
  }
  const result = await collection.add({
    data: Object.assign({}, payload, { createdAt: now.toISOString() })
  });
  return { _id: result._id, expiresAt: payload.expiresAt };
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
    const agenda = common.parser.buildAgendaFromAi(aiResult, memberships, pathways, template);
    const validated = common.parser.validateAgenda(Object.assign({}, agenda, { rawText }));
    const draft = await saveCurrentDraft(common.getDb(), openid, validated);
    const savedAgenda = Object.assign({}, validated, { _id: draft._id, expiresAt: draft.expiresAt });
    return common.ok({ agenda: savedAgenda, aiUsed: true, expiresAt: draft.expiresAt });
  } catch (error) {
    return common.handleError(error);
  }
}

module.exports = { DRAFT_TTL_MS, buildDraftPayload, saveCurrentDraft, main };
exports.main = main;
