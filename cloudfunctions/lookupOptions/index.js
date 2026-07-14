const common = require('agenda-common');

/**
 * 方法是什么：转义数据库正则搜索关键词。
 * 方法作用：把用户输入中的正则特殊字符转换为普通字符匹配。
 * 为什么添加：姓名和项目代码可能包含括号或点号，直接拼正则会导致搜索不准或报错。
 */
function escapeSearchKeyword(keyword) {
  return String(keyword || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 方法是什么：查询会员候选。
 * 方法作用：根据关键词搜索 Membership 的 `searchText` 字段，并返回少量候选。
 * 为什么添加：议程编辑页需要从会员表选择正式姓名，但不应让小程序端直连数据库。
 */
async function searchMembers(keyword) {
  const db = common.getDb();
  const collection = db.collection('memberships');
  const query = keyword
    ? collection.where({ searchText: db.RegExp({ regexp: escapeSearchKeyword(keyword), options: 'i' }) })
    : collection;
  const res = await query
    .orderBy('joinedAt', 'asc')
    .limit(keyword ? 8 : 100)
    .get();
  return res.data || [];
}

/**
 * 方法是什么：查询 Pathways 项目候选。
 * 方法作用：根据关键词搜索 Pathways 的 `searchText` 字段，并返回少量候选。
 * 为什么添加：备稿项目描述必须来自 Pathways 表，服务端搜索可以统一保护基础数据读取。
 */
async function searchPathways(keyword) {
  const db = common.getDb();
  const collection = db.collection('pathways');
  const query = keyword
    ? collection.where({ searchText: db.RegExp({ regexp: escapeSearchKeyword(keyword), options: 'i' }) })
    : collection;
  const res = await query
    .orderBy('code', 'asc')
    .limit(keyword ? 8 : 100)
    .get();
  return res.data || [];
}

/**
 * 方法是什么：处理基础数据候选搜索请求。
 * 方法作用：根据 type 返回会员或 Pathways 候选列表。
 * 为什么添加：编辑页需要轻量查询选项，单独云函数可以避免暴露数据库读权限。
 */
async function main(event) {
  try {
    common.initCloud();
    const keyword = event && event.keyword ? event.keyword : '';
    if (event.type === 'pathways') {
      return common.ok({ list: await searchPathways(keyword) });
    }
    return common.ok({ list: await searchMembers(keyword) });
  } catch (error) {
    return common.handleError(error);
  }
}

exports.main = main;
