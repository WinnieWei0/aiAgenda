const common = require('agenda-common');

/**
 * 方法是什么：处理首次管理员领取请求。
 * 方法作用：在系统没有 admin 用户时，为当前 openid 绑定 admin 角色。
 * 为什么添加：新系统上线后需要一个无需手工改库的管理员初始化入口。
 */
async function main(event) {
  common.initCloud();
  return common.fail('FEATURE_RETIRED', '管理员身份请通过会员邀请绑定');
}

exports.main = main;
