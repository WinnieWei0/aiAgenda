const common = require('agenda-common');

/**
 * 方法是什么：保存系统角色记录。
 * 方法作用：根据角色编码 upsert 系统角色名称和描述。
 * 为什么添加：角色管理表需要支持管理员维护权限角色定义。
 */
async function saveRole(role) {
  if (!role || !role.code) {
    const error = new Error('角色编码不能为空');
    error.code = 'EMPTY_ROLE_CODE';
    throw error;
  }
  return common.upsertByKey('roles', 'code', role.code, {
    code: role.code,
    name: role.name || role.code,
    description: role.description || '',
    locked: role.code === 'admin',
    updatedAt: common.nowIso()
  });
}

/**
 * 方法是什么：给用户绑定系统角色。
 * 方法作用：把指定 openid 和 roleCode 写入 `user_roles`。
 * 为什么添加：管理员需要通过系统分配用户权限，而不是直接修改数据库。
 */
async function assignRole(openid, roleCode) {
  return common.upsertByKey('user_roles', 'bindingKey', `${openid}:${roleCode}`, {
    bindingKey: `${openid}:${roleCode}`,
    openid,
    roleCode,
    updatedAt: common.nowIso()
  });
}

/**
 * 方法是什么：处理系统角色管理云函数请求。
 * 方法作用：提供角色列表、保存、删除、用户授权和用户列表能力。
 * 为什么添加：系统权限角色是管理中心基础能力，需要通过云函数统一校验管理员身份。
 */
async function main(event) {
  try {
    common.initCloud();
    const openid = common.getOpenid();
    await common.requireAdmin(openid);
    await common.ensureDefaultRoles();
    const action = event && event.action ? event.action : 'list';
    const db = common.getDb();
    if (action === 'list') {
      return common.ok(await common.listCollection('roles', { pageSize: 100, orderBy: 'code', order: 'asc' }));
    }
    if (action === 'save') {
      return common.ok(await saveRole(event.role || {}));
    }
    if (action === 'delete') {
      const roleCode = event.code;
      if (roleCode === 'admin') {
        return common.fail('ROLE_LOCKED', '管理员角色不可删除');
      }
      const res = await db.collection('roles').where({ code: roleCode }).remove();
      return common.ok({ removed: res.stats ? res.stats.removed : 0 });
    }
    if (action === 'assign') {
      return common.ok(await assignRole(event.openid, event.roleCode));
    }
    if (action === 'users') {
      return common.ok(await common.listCollection('users', event || {}));
    }
    return common.fail('UNKNOWN_ACTION', '不支持的角色管理操作');
  } catch (error) {
    return common.handleError(error);
  }
}

exports.main = main;
