const cloud = require('../utils/cloud');
const signupView = require('../utils/signup-view');

/**
 * 方法是什么：调用会议查询服务。
 * 方法作用：统一编辑页、首页和报名页的会议快照读取。
 * 为什么添加：页面不应直接依赖云函数名称和数据库返回结构。
 */
function query(action, extra) {
  return cloud.callCloud('agendaQuery', Object.assign({ action }, extra || {}));
}

/**
 * 方法是什么：保存会议议程。
 * 方法作用：统一接龙解析后的空议程保存和编辑器保存。
 * 为什么添加：编辑与报名必须围绕同一个会议聚合更新。
 */
function save(agenda) {
  return cloud.callCloud('saveAgenda', { agenda });
}

/**
 * 方法是什么：调用报名服务并装饰快照。
 * 方法作用：统一报名、取消、清空和创建报名页的返回结构。
 * 为什么添加：避免两个页面各自拼接报名状态造成数据漂移。
 */
async function signup(action, payload) {
  const data = await cloud.callCloud('signupService', Object.assign({ action }, payload || {}));
  return signupView.decorateSignupData(data);
}

module.exports = { query, save, signup };
