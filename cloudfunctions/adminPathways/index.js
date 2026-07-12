const common = require('agenda-common');

/**
 * 方法是什么：构建 Pathways 项目的搜索文本。
 * 方法作用：合并项目代码、中英文项目名和目标说明用于关键词检索。
 * 为什么添加：管理员维护 Pathways 时需要按代码或项目名称快速定位记录。
 */
function buildSearchText(pathway) {
  const parts = [pathway.code, pathway.projectNameZh, pathway.projectNameEn, pathway.fullLabelZh, pathway.fullLabelEn, pathway.objectiveZh, pathway.objectiveEn];
  const text = [];
  for (const part of parts) {
    if (part) {
      text.push(String(part).toLowerCase());
    }
  }
  return text.join(' ');
}

/**
 * 方法是什么：保存 Pathways 项目记录。
 * 方法作用：根据 `_id` 新增或更新项目代码、名称和目标说明。
 * 为什么添加：备稿项目描述要从数据库读取，管理员必须能修正和补充项目数据。
 */
async function savePathway(pathway) {
  const db = common.getDb();
  const payload = Object.assign({}, pathway, {
    searchText: buildSearchText(pathway),
    updatedAt: common.nowIso()
  });
  if (pathway._id) {
    const id = pathway._id;
    delete payload._id;
    await db.collection('pathways').doc(id).update({ data: payload });
    return { _id: id, action: 'updated' };
  }
  const sourceKey = pathway.sourceKey || `manual-${Date.now()}`;
  const res = await db.collection('pathways').add({
    data: Object.assign({}, payload, { sourceKey, createdAt: common.nowIso() })
  });
  return { _id: res._id, action: 'created' };
}

/**
 * 方法是什么：处理 Pathways 管理云函数请求。
 * 方法作用：提供列表、新增、更新和删除 Pathways 数据的管理员接口。
 * 为什么添加：Pathways 表必须在当前系统中维护，备稿项目选择和 PDF 描述都依赖它。
 */
async function main(event) {
  try {
    common.initCloud();
    const openid = common.getOpenid();
    await common.requireAdmin(openid);
    const action = event && event.action ? event.action : 'list';
    const db = common.getDb();
    if (action === 'list') {
      return common.ok(await common.listCollection('pathways', event || {}));
    }
    if (action === 'save') {
      return common.ok(await savePathway(event.pathway || {}));
    }
    if (action === 'delete') {
      await db.collection('pathways').doc(event.id).remove();
      return common.ok({ removed: true });
    }
    return common.fail('UNKNOWN_ACTION', '不支持的 Pathways 管理操作');
  } catch (error) {
    return common.handleError(error);
  }
}

exports.main = main;
