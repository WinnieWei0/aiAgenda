const cloud = require('wx-server-sdk');
const parser = require('./parser');
const deepseek = require('./deepseek');
const pdfRenderer = require('./pdf-renderer');

let cloudInitialized = false;

/**
 * 方法是什么：初始化 CloudBase 云能力。
 * 方法作用：确保云函数可以访问数据库、云存储和微信上下文。
 * 为什么添加：多个云函数都会使用 CloudBase SDK，集中初始化可以避免重复代码和环境不一致。
 */
function initCloud() {
  if (!cloudInitialized) {
    cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
    cloudInitialized = true;
  }
  return cloud;
}

/**
 * 方法是什么：获取云数据库实例。
 * 方法作用：为云函数提供统一的数据库访问入口。
 * 为什么添加：所有集合操作都依赖数据库实例，封装后便于以后切换配置或增加日志。
 */
function getDb() {
  return initCloud().database();
}

/**
 * 方法是什么：获取当前调用者的 openid。
 * 方法作用：从微信云函数上下文中读取用户身份。
 * 为什么添加：权限判断、数据归属和审计字段都需要稳定的用户标识。
 */
function getOpenid() {
  const context = initCloud().getWXContext();
  return context.OPENID || context.FROM_OPENID || '';
}

/**
 * 方法是什么：生成标准成功响应。
 * 方法作用：让所有云函数返回统一的 `{ ok, data }` 格式。
 * 为什么添加：前端调用云函数时可以用同一套成功/失败处理逻辑。
 */
function ok(data) {
  return { ok: true, data: data || {} };
}

/**
 * 方法是什么：生成标准失败响应。
 * 方法作用：让所有云函数返回统一的 `{ ok, error }` 格式。
 * 为什么添加：统一错误结构便于前端展示提示，也便于后续接入监控。
 */
function fail(code, message, extra) {
  return { ok: false, error: { code, message, extra: extra || null } };
}

/**
 * 方法是什么：获取当前时间的 ISO 字符串。
 * 方法作用：为数据库记录生成创建时间和更新时间。
 * 为什么添加：所有集合都需要一致的时间格式，便于排序和审计。
 */
function nowIso() {
  return new Date().toISOString();
}

/**
 * 方法是什么：按条件查询集合列表。
 * 方法作用：封装分页、排序和关键词参数，返回统一列表数据。
 * 为什么添加：管理页的 Membership、Pathways、角色列表都需要相同的列表查询行为。
 */
async function listCollection(collectionName, options) {
  const db = getDb();
  const opts = options || {};
  const page = Math.max(Number(opts.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(opts.pageSize || 20), 1), 100);
  const query = opts.where || {};
  const orderBy = opts.orderBy || 'updatedAt';
  const order = opts.order || 'desc';
  const collection = db.collection(collectionName);
  const totalRes = await collection.where(query).count();
  const listRes = await collection
    .where(query)
    .orderBy(orderBy, order)
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get();
  return { list: listRes.data || [], total: totalRes.total || 0, page, pageSize };
}

/**
 * 方法是什么：按唯一键更新或新增一条记录。
 * 方法作用：存在相同唯一键时更新，不存在时新增。
 * 为什么添加：Excel 导入和管理页保存都需要避免重复创建同一条业务记录。
 */
async function upsertByKey(collectionName, key, value, data) {
  const db = getDb();
  const collection = db.collection(collectionName);
  const existing = await collection.where({ [key]: value }).limit(1).get();
  const payload = Object.assign({}, data, { updatedAt: nowIso() });
  if (existing.data && existing.data.length) {
    await collection.doc(existing.data[0]._id).update({ data: payload });
    return { _id: existing.data[0]._id, action: 'updated' };
  }
  const addRes = await collection.add({ data: Object.assign({}, payload, { createdAt: nowIso() }) });
  return { _id: addRes._id, action: 'created' };
}

/**
 * 方法是什么：创建或更新当前用户记录。
 * 方法作用：登录时保存用户 openid、昵称和最近访问时间。
 * 为什么添加：后续权限分配和议程归属都需要用户表作为基础数据。
 */
async function upsertUser(openid, profile) {
  const db = getDb();
  const userProfile = profile || {};
  const existing = await db.collection('users').where({ openid }).limit(1).get();
  const data = {
    openid,
    nickName: userProfile.nickName || '',
    avatarUrl: userProfile.avatarUrl || '',
    lastLoginAt: nowIso(),
    updatedAt: nowIso()
  };
  if (existing.data && existing.data.length) {
    await db.collection('users').doc(existing.data[0]._id).update({ data });
    return Object.assign({}, existing.data[0], data);
  }
  const addRes = await db.collection('users').add({ data: Object.assign({}, data, { createdAt: nowIso() }) });
  return Object.assign({}, data, { _id: addRes._id });
}

/**
 * 方法是什么：查询指定用户的系统角色。
 * 方法作用：返回用户绑定的角色编码列表。
 * 为什么添加：前端菜单显示和后端权限校验都需要知道用户是否为管理员。
 */
async function getUserRoles(openid) {
  const db = getDb();
  const res = await db.collection('user_roles').where({ openid }).get();
  const roles = [];
  for (const item of res.data || []) {
    roles.push(item.roleCode);
  }
  return roles;
}

/**
 * 方法是什么：判断系统是否已有管理员。
 * 方法作用：统计 `user_roles` 中 admin 角色绑定数量。
 * 为什么添加：首次登录领取管理员只能在系统尚未初始化管理员时开放。
 */
async function hasAdmin() {
  const db = getDb();
  const res = await db.collection('user_roles').where({ roleCode: 'admin' }).count();
  return (res.total || 0) > 0;
}

/**
 * 方法是什么：判断指定 openid 是否是管理员。
 * 方法作用：检查用户是否绑定 `admin` 系统角色。
 * 为什么添加：Membership、Pathways、角色管理和 Excel 导入都必须限制为管理员操作。
 */
async function isAdmin(openid) {
  const roles = await getUserRoles(openid);
  return roles.includes('admin');
}

/**
 * 方法是什么：强制要求当前用户是管理员。
 * 方法作用：在权限不足时抛出标准错误。
 * 为什么添加：管理员云函数需要在入口处统一阻断未授权调用，避免散落重复判断。
 */
async function requireAdmin(openid) {
  const allowed = await isAdmin(openid);
  if (!allowed) {
    const error = new Error('仅管理员可以执行该操作');
    error.code = 'FORBIDDEN';
    throw error;
  }
}

/**
 * 方法是什么：确保默认系统角色存在。
 * 方法作用：初始化 admin、editor、viewer 三个基础角色。
 * 为什么添加：首次管理员领取和角色管理页都依赖基础角色数据，提前创建可减少手工配置。
 */
async function ensureDefaultRoles() {
  const defaults = [
    { code: 'admin', name: '管理员', description: '可维护基础数据、角色和所有议程' },
    { code: 'editor', name: '编辑者', description: '可创建和编辑自己的议程' },
    { code: 'viewer', name: '查看者', description: '可查看历史议程和导出结果' }
  ];
  const results = [];
  for (const role of defaults) {
    const result = await upsertByKey('roles', 'code', role.code, role);
    results.push(result);
  }
  return results;
}

/**
 * 方法是什么：把函数异常转换为标准响应。
 * 方法作用：捕获业务错误和未知错误，返回前端可识别的错误结构。
 * 为什么添加：云函数入口较多，统一错误处理能让前端提示稳定，也减少重复 try/catch 代码。
 */
function handleError(error) {
  const code = error && error.code ? error.code : 'INTERNAL_ERROR';
  const message = error && error.message ? error.message : '服务暂时不可用';
  return fail(code, message);
}

module.exports = {
  cloud,
  parser,
  deepseek,
  pdfRenderer,
  initCloud,
  getDb,
  getOpenid,
  ok,
  fail,
  nowIso,
  listCollection,
  upsertByKey,
  upsertUser,
  getUserRoles,
  hasAdmin,
  isAdmin,
  requireAdmin,
  ensureDefaultRoles,
  handleError
};
