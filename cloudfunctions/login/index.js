const common = require('agenda-common');

/**
 * 方法是什么：处理小程序登录云函数请求。
 * 方法作用：记录当前用户、返回用户角色和是否可以领取首个管理员。
 * 为什么添加：前端需要在启动时知道用户身份，才能控制管理入口和管理员初始化按钮。
 */
async function main(event) {
  try {
    common.initCloud();
    const openid = common.getOpenid();
    const user = await common.upsertUser(openid, event && event.profile ? event.profile : {});
    const membership = await common.getMembershipByOpenid(openid);
    const identity = common.membershipIdentity(membership);
    return common.ok({ user, roles: identity.role === 'guest' ? [] : [identity.role], identity });
  } catch (error) {
    return common.handleError(error);
  }
}

exports.main = main;
