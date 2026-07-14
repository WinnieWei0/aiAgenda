const common = require('agenda-common');

/**
 * 方法是什么：构建 Pathways 项目的搜索文本。
 * 方法作用：合并项目代码、中英文项目名和目标说明用于关键词检索。
 * 为什么添加：管理员维护 Pathways 时需要按代码或项目名称快速定位记录。
 */
function buildSearchText(pathway) {
  const parts = [pathway.code, pathway.fullLabelZh, pathway.fullLabelEn, pathway.objectiveZh, pathway.objectiveEn];
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
const PATHWAY_FIELDS = ['code', 'fullLabelEn', 'fullLabelZh', 'level', 'objectiveEn', 'objectiveZh'];
const LEGACY_FIELDS = ['sourceKey', 'projectNameEn', 'projectNameZh', 'detailZh', 'skillZh', 'rawRow', 'id'];

function buildPathwayPayload(pathway) {
  const payload = {};
  for (const field of PATHWAY_FIELDS) {
    payload[field] = pathway[field] === undefined || pathway[field] === null ? '' : pathway[field];
  }
  payload.searchText = [payload.code, payload.fullLabelEn, payload.fullLabelZh, payload.objectiveEn, payload.objectiveZh]
    .filter(Boolean).join(' ').toLowerCase();
  return payload;
}

/**
 * 方法是什么：保存路径记录。
 * 方法作用：按路径 ID 更新或新增严格字段集合中的记录。
 * 为什么添加：路径编辑页不能继续写入旧项目字段。
 */
async function savePathway(pathway) {
  const db = common.getDb();
  const payload = Object.assign({}, buildPathwayPayload(pathway), { updatedAt: common.nowIso() });
  if (pathway._id) {
    const id = pathway._id;
    delete payload._id;
    const updateData = Object.assign({}, payload);
    LEGACY_FIELDS.forEach((field) => {
      updateData[field] = db.command.remove();
    });
    const existing = await db.collection('pathways').doc(id).get();
    const allowedFields = new Set(PATHWAY_FIELDS.concat(['searchText', 'createdAt', 'updatedAt']));
    Object.keys(existing.data || {}).forEach((field) => {
      if (field !== '_id' && !allowedFields.has(field)) {
        updateData[field] = db.command.remove();
      }
    });
    await db.collection('pathways').doc(id).update({ data: updateData });
    return { _id: id, action: 'updated' };
  }
  const res = await db.collection('pathways').add({
    data: Object.assign({}, payload, { createdAt: common.nowIso() })
  });
  return { _id: res._id, action: 'created' };
}

/**
 * 方法是什么：读取单个 Pathways 项目记录。
 * 方法作用：根据 Pathways `_id` 从 pathways 集合取回完整记录。
 * 为什么添加：独立编辑路径页需要按 id 加载已有项目，避免列表页传递大对象。
 */
async function getPathway(id) {
  const db = common.getDb();
  const res = await db.collection('pathways').doc(id).get();
  return res.data || null;
}

/**
 * 方法是什么：处理 Pathways 管理云函数请求。
 * 方法作用：提供列表、详情、新增、更新和删除 Pathways 数据的开放管理接口。
 * 为什么添加：Pathways 表必须在当前系统中维护，当前版本要求所有用户都能访问管理能力。
 */
async function main(event) {
  try {
    common.initCloud();
    const action = event && event.action ? event.action : 'list';
    const db = common.getDb();
    if (action === 'list') {
      return common.ok(await common.listCollection('pathways', Object.assign({}, event || {}, { orderBy: 'code', order: 'asc' })));
    }
    if (action === 'get') {
      return common.ok({ record: await getPathway(event.id) });
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
