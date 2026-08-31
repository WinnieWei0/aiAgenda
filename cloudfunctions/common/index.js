const cloud = require('wx-server-sdk');
const parser = require('./parser');
const deepseek = require('./deepseek');
const agendaModel = require('./agenda-model');
const signup = require('./signup');

let cloudInitialized = false;
const ensuredCollections = new Set();

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
 * 方法是什么：判断数据库错误是否表示集合不存在。
 * 方法作用：兼容 CloudBase SDK 的数字错误码和文本错误信息。
 * 为什么添加：新环境首次读取集合时会抛出 -502005，不能直接进入后续初始化逻辑。
 */
function isCollectionMissingError(error) {
  const code = Number(error && (error.errCode || error.code));
  const message = String(error && (error.errMsg || error.message) || '').toLowerCase();
  return code === -502005 || message.includes('collection not exist') || message.includes('collection_not_exist');
}

/**
 * 方法是什么：确保云数据库集合存在。
 * 方法作用：首次运行时自动创建缺失集合，并在当前云函数实例中缓存检查结果。
 * 为什么添加：CloudBase 对不存在集合执行查询会直接失败，无法依靠首次 add 自动完成初始化。
 */
async function ensureCollection(collectionName) {
  if (ensuredCollections.has(collectionName)) {
    return getDb().collection(collectionName);
  }
  const db = getDb();
  try {
    await db.collection(collectionName).limit(1).get();
  } catch (error) {
    if (!isCollectionMissingError(error)) {
      throw error;
    }
    try {
      await db.createCollection(collectionName);
    } catch (createError) {
      const message = String(createError && (createError.errMsg || createError.message) || '').toLowerCase();
      if (!message.includes('already exist') && !message.includes('collection exists')) {
        throw createError;
      }
    }
  }
  ensuredCollections.add(collectionName);
  return db.collection(collectionName);
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
  const collection = await ensureCollection('users');
  const userProfile = profile || {};
  const existing = await collection.where({ openid }).limit(1).get();
  const data = {
    openid,
    nickName: userProfile.nickName || '',
    avatarUrl: userProfile.avatarUrl || '',
    lastLoginAt: nowIso(),
    updatedAt: nowIso()
  };
  if (existing.data && existing.data.length) {
    await collection.doc(existing.data[0]._id).update({ data });
    return Object.assign({}, existing.data[0], data);
  }
  const addRes = await collection.add({ data: Object.assign({}, data, { createdAt: nowIso() }) });
  return Object.assign({}, data, { _id: addRes._id });
}

/**
 * 方法是什么：查询指定用户的系统角色。
 * 方法作用：返回用户绑定的角色编码列表。
 * 为什么添加：前端菜单显示和后端权限校验都需要知道用户是否为管理员。
 */
async function getUserRoles(openid) {
  const membership = await getMembershipByOpenid(openid);
  return membership ? [normalizeMembershipRole(membership.role)] : [];
}

const MEMBERSHIP_ROLES = ['super_admin', 'admin', 'member'];

function normalizeMembershipRole(role) {
  return MEMBERSHIP_ROLES.includes(role) ? role : 'member';
}

async function getMembershipByOpenid(openid) {
  if (!openid) return null;
  const res = await (await ensureCollection('memberships')).where({ openid }).limit(1).get();
  return res.data && res.data.length ? res.data[0] : null;
}

function membershipIdentity(membership) {
  if (!membership) return { role: 'guest', roleLabel: '宾客', name: '', membership: null };
  const role = normalizeMembershipRole(membership.role);
  const labels = { super_admin: '超管', admin: '管理员', member: '会员' };
  return {
    role,
    roleLabel: labels[role],
    name: membership.nameZh || membership.nameEn || membership.nickName || '',
    membership
  };
}

/**
 * 方法是什么：判断系统是否已有管理员。
 * 方法作用：检查 memberships 中是否存在已绑定的超管或管理员。
 * 为什么添加：初始化和管理能力都依赖真实会员身份。
 */
async function hasAdmin() {
  const collection = await ensureCollection('memberships');
  const [superAdmins, admins] = await Promise.all([
    collection.where({ role: 'super_admin' }).limit(100).get(),
    collection.where({ role: 'admin' }).limit(100).get()
  ]);
  return (superAdmins.data || []).concat(admins.data || []).some((member) => Boolean(member.openid));
}

/**
 * 方法是什么：判断指定 openid 是否是管理员。
 * 方法作用：检查用户是否绑定 `admin` 系统角色。
 * 为什么添加：Membership、Pathways、角色管理和 Excel 导入都必须限制为管理员操作。
 */
async function isAdmin(openid) {
  const membership = await getMembershipByOpenid(openid);
  const role = membership && normalizeMembershipRole(membership.role);
  return role === 'super_admin' || role === 'admin';
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
    { code: 'super_admin', name: '超管', description: '可维护全部系统数据和议程' },
    { code: 'admin', name: '管理员', description: '可维护全部系统数据和议程' },
    { code: 'member', name: '会员', description: '可使用会议和报名功能' },
    { code: 'guest', name: '宾客', description: '未绑定会员身份的用户' }
  ];
  const results = [];
  for (const role of defaults) {
    const result = await upsertByKey('roles', 'code', role.code, role);
    results.push(result);
  }
  return results;
}

/**
 * 方法是什么：读取当前全局议程模板。
 * 方法作用：按固定模板 ID 查询数据库，并在首次使用时写入默认两页模板。
 * 为什么添加：解析、预览、保存和 PDF 导出必须共享同一份模板内容与规则。
 */
async function getAgendaTemplate() {
  const db = getDb();
  const collection = await ensureCollection('agenda_templates');
  const templateId = agendaModel.TEMPLATE_ID;
  const result = await collection.where({ templateId }).limit(1).get();
  if (result.data && result.data.length) {
    return Object.assign(agendaModel.normalizeTemplate(result.data[0]), { _id: result.data[0]._id });
  }
  const template = agendaModel.createDefaultTemplate();
  const addResult = await collection.add({ data: Object.assign({}, template, { createdAt: nowIso(), updatedAt: nowIso() }) });
  return Object.assign({}, template, { _id: addResult._id });
}

/**
 * 方法是什么：保存当前全局议程模板。
 * 方法作用：合并默认结构、校验数组字段并更新模板单例。
 * 为什么添加：模拟超管需要维护两页固定内容、素材、环节规则和会员权限。
 */
async function saveAgendaTemplate(value) {
  const db = getDb();
  const source = value || {};
  const defaults = agendaModel.createDefaultTemplate();
  const template = agendaModel.normalizeTemplate(Object.assign({}, defaults, source, {
    templateId: agendaModel.TEMPLATE_ID,
    schemaVersion: agendaModel.AGENDA_SCHEMA_VERSION,
    fixedContent: Object.assign({}, defaults.fixedContent, source.fixedContent || {}),
    assets: Object.assign({}, defaults.assets, source.assets || {}),
    sidebar: Object.assign({}, defaults.sidebar, source.sidebar || {}),
    page2: Object.assign({}, defaults.page2, source.page2 || {}),
    settings: Object.assign({}, defaults.settings, source.settings || {}),
    agendaRules: Array.isArray(source.agendaRules) && source.agendaRules.length ? source.agendaRules : defaults.agendaRules,
    timerRules: Array.isArray(source.timerRules) && source.timerRules.length ? source.timerRules : defaults.timerRules,
    locales: source.locales || defaults.locales,
    updatedAt: nowIso()
  }));
  template.updatedAt = nowIso();
  delete template._id;
  // locales 是模板文案的唯一持久化来源，旧版顶层字段只在读取时由 normalizeTemplate 补回。
  ['fixedContent', 'sidebar', 'page2', 'timerRules'].forEach((field) => {
    delete template[field];
  });
  const collection = await ensureCollection('agenda_templates');
  const existing = await collection.where({ templateId: agendaModel.TEMPLATE_ID }).limit(1).get();
  if (existing.data && existing.data.length) {
    const updateData = Object.assign({}, template, {
      fixedContent: db.command.remove(),
      sidebar: db.command.remove(),
      page2: db.command.remove(),
      timerRules: db.command.remove()
    });
    await collection.doc(existing.data[0]._id).update({ data: updateData });
    return Object.assign({}, template, { _id: existing.data[0]._id });
  }
  const added = await collection.add({ data: Object.assign({}, template, { createdAt: nowIso() }) });
  return Object.assign({}, template, { _id: added._id });
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

const commonExports = {
  CURRENT_AGENDA_ID: 'current',
  cloud,
  parser,
  deepseek,
  agendaModel,
  signup,
  initCloud,
  getDb,
  isCollectionMissingError,
  ensureCollection,
  getOpenid,
  ok,
  fail,
  nowIso,
  listCollection,
  upsertByKey,
  upsertUser,
  MEMBERSHIP_ROLES,
  normalizeMembershipRole,
  getMembershipByOpenid,
  membershipIdentity,
  getUserRoles,
  hasAdmin,
  isAdmin,
  requireAdmin,
  ensureDefaultRoles,
  getAgendaTemplate,
  saveAgendaTemplate,
  handleError
};

Object.defineProperty(commonExports, 'pdfRenderer', {
  enumerable: true,
  /**
   * 方法是什么：按需读取 PDF 渲染模块。
   * 方法作用：只在导出云函数实际访问时加载 PDF 引擎。
   * 为什么添加：普通查询和保存云函数不应携带或初始化大型 PDF 依赖。
   */
  get() {
    return require('./pdf-renderer');
  }
});

module.exports = commonExports;
