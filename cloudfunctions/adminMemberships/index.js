const common = require('agenda-common');

/**
 * 方法是什么：构建会员记录的可搜索文本。
 * 方法作用：把中文名、英文名、昵称和议程显示名合并成小写搜索字段。
 * 为什么添加：管理页和解析匹配都需要通过多个名称入口快速找到会员。
 */
function buildSearchText(member) {
  const parts = [member.nickName, member.nameZh, member.nameEn, member.mentorName,
    member.officerTitleZh, member.officerTitleEn, member.pathNameZh, member.pathNameEn];
  const text = [];
  for (const part of parts) {
    if (part) {
      text.push(String(part).toLowerCase());
    }
  }
  return text.join(' ');
}

/**
 * 方法是什么：保存会员记录。
 * 方法作用：根据是否存在 `_id` 决定新增或更新 Membership。
 * 为什么添加：管理员需要在系统内维护会员数据，保存逻辑应复用同一入口。
 */
const MEMBER_FIELDS = [
  'birthday', 'competitionEligible', 'educationAwards', 'educationProgress',
  'educationProgressUpdatedAt', 'email', 'isMentor', 'joinedAt', 'menteeCount',
  'mentorName', 'nameEn', 'nameZh', 'nickName', 'notes', 'officerTitleEn',
  'officerTitleZh', 'pathNameEn', 'pathNameZh', 'phone', 'quarter', 'status'
];
const LEGACY_FIELDS = ['clubEn', 'clubZh', 'rawRow', 'sourceKey', 'agendaNameZh', 'aliases', 'titleOnAgenda', 'id'];

/**
 * 方法是什么：构建会员白名单数据。
 * 方法作用：只保留 Membership 允许的业务字段并重新生成搜索词。
 * 为什么添加：编辑接口不能让旧字段重新写回数据库。
 */
function buildMemberPayload(member) {
  const payload = {};
  for (const field of MEMBER_FIELDS) {
    payload[field] = member[field] === undefined || member[field] === null ? '' : member[field];
  }
  payload.searchText = [payload.nickName, payload.nameZh, payload.nameEn, payload.mentorName,
    payload.officerTitleZh, payload.officerTitleEn, payload.pathNameZh, payload.pathNameEn]
    .filter(Boolean).join(' ').toLowerCase();
  return payload;
}

/**
 * 方法是什么：保存会员记录。
 * 方法作用：按会员 ID 更新或新增严格字段集合中的记录。
 * 为什么添加：会员编辑页需要稳定的单一保存入口。
 */
async function saveMember(member) {
  const db = common.getDb();
  const payload = Object.assign({}, buildMemberPayload(member), { updatedAt: common.nowIso() });
  if (member._id) {
    const id = member._id;
    delete payload._id;
    const updateData = Object.assign({}, payload);
    LEGACY_FIELDS.forEach((field) => {
      updateData[field] = db.command.remove();
    });
    const existing = await db.collection('memberships').doc(id).get();
    const allowedFields = new Set(MEMBER_FIELDS.concat(['searchText', 'createdAt', 'updatedAt']));
    Object.keys(existing.data || {}).forEach((field) => {
      if (field !== '_id' && !allowedFields.has(field)) {
        updateData[field] = db.command.remove();
      }
    });
    await db.collection('memberships').doc(id).update({ data: updateData });
    return { _id: id, action: 'updated' };
  }
  const res = await db.collection('memberships').add({
    data: Object.assign({}, payload, { createdAt: common.nowIso() })
  });
  return { _id: res._id, action: 'created' };
}

/**
 * 方法是什么：读取单个会员记录。
 * 方法作用：根据会员 `_id` 从 memberships 集合取回完整记录。
 * 为什么添加：独立编辑会员页需要在打开时加载当前记录，而不是依赖列表页传递完整对象。
 */
async function getMember(id) {
  const db = common.getDb();
  const res = await db.collection('memberships').doc(id).get();
  return res.data || null;
}

/**
 * 方法是什么：处理 Membership 管理云函数请求。
 * 方法作用：提供列表、详情、新增、更新和删除会员数据的开放管理接口。
 * 为什么添加：Membership 必须在当前系统中以数据库表形式维护，并支持当前版本所有用户 CRUD。
 */
async function main(event) {
  try {
    common.initCloud();
    const action = event && event.action ? event.action : 'list';
    const db = common.getDb();
    if (action === 'list') {
      return common.ok(await common.listCollection('memberships', Object.assign({}, event || {}, { orderBy: 'joinedAt', order: 'asc' })));
    }
    if (action === 'get') {
      return common.ok({ record: await getMember(event.id) });
    }
    if (action === 'save') {
      return common.ok(await saveMember(event.member || {}));
    }
    if (action === 'delete') {
      await db.collection('memberships').doc(event.id).remove();
      return common.ok({ removed: true });
    }
    return common.fail('UNKNOWN_ACTION', '不支持的会员管理操作');
  } catch (error) {
    return common.handleError(error);
  }
}

exports.main = main;
