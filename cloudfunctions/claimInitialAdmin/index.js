const common = require('agenda-common');

/**
 * 方法是什么：处理首次管理员领取请求。
 * 方法作用：在系统没有 admin 用户时，为当前 openid 绑定 admin 角色。
 * 为什么添加：新系统上线后需要一个无需手工改库的管理员初始化入口。
 */
async function main(event) {
  try {
    common.initCloud();
    const openid = common.getOpenid();
    await common.upsertUser(openid, event && event.profile ? event.profile : {});
    await common.ensureDefaultRoles();
    const alreadyHasAdmin = await common.hasAdmin();
    if (alreadyHasAdmin) {
      return common.fail('ADMIN_ALREADY_EXISTS', '系统已存在管理员，不能再次领取');
    }
    const db = common.getDb();
    await db.collection('user_roles').add({
      data: {
        bindingKey: `${openid}:admin`,
        openid,
        roleCode: 'admin',
        createdAt: common.nowIso(),
        updatedAt: common.nowIso()
      }
    });
    return common.ok({ roles: await common.getUserRoles(openid) });
  } catch (error) {
    return common.handleError(error);
  }
}

exports.main = main;
