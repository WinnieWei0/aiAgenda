const common = require('agenda-common');

/**
 * 方法是什么：构建会员记录的可搜索文本。
 * 方法作用：把中文名、英文名、昵称和议程显示名合并成小写搜索字段。
 * 为什么添加：管理页和解析匹配都需要通过多个名称入口快速找到会员。
 */
function buildSearchText(member) {
  const parts = [member.nickName, member.nameZh, member.nameEn, member.titleOnAgenda, member.agendaNameZh];
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
async function saveMember(member) {
  const db = common.getDb();
  const payload = Object.assign({}, member, {
    searchText: buildSearchText(member),
    updatedAt: common.nowIso()
  });
  if (member._id) {
    const id = member._id;
    delete payload._id;
    await db.collection('memberships').doc(id).update({ data: payload });
    return { _id: id, action: 'updated' };
  }
  const sourceKey = member.sourceKey || `manual-${Date.now()}`;
  const res = await db.collection('memberships').add({
    data: Object.assign({}, payload, { sourceKey, createdAt: common.nowIso() })
  });
  return { _id: res._id, action: 'created' };
}

/**
 * 方法是什么：处理 Membership 管理云函数请求。
 * 方法作用：提供列表、新增、更新和删除会员数据的管理员接口。
 * 为什么添加：Membership 必须在当前系统中以数据库表形式维护，并支持管理员 CRUD。
 */
async function main(event) {
  try {
    common.initCloud();
    const openid = common.getOpenid();
    await common.requireAdmin(openid);
    const action = event && event.action ? event.action : 'list';
    const db = common.getDb();
    if (action === 'list') {
      return common.ok(await common.listCollection('memberships', event || {}));
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
