const common = require('agenda-common');

/**
 * 方法是什么：查询当前用户可见的议程列表。
 * 方法作用：普通用户只查自己的议程，管理员可以查最近所有议程。
 * 为什么添加：历史议程读取需要在服务端控制权限，避免小程序端直连数据库泄露数据。
 */
async function listAgendas(openid) {
  const db = common.getDb();
  const admin = await common.isAdmin(openid);
  let query = db.collection('agendas');
  if (!admin) {
    query = query.where({ ownerOpenid: openid });
  }
  const res = await query.orderBy('updatedAt', 'desc').limit(50).get();
  return res.data || [];
}

/**
 * 方法是什么：查询单条议程详情。
 * 方法作用：根据议程 ID 读取记录，并校验当前用户是否有权访问。
 * 为什么添加：编辑历史议程时需要完整数据，同时必须防止用户读取他人的议程。
 */
async function getAgenda(openid, agendaId) {
  const db = common.getDb();
  const res = await db.collection('agendas').doc(agendaId).get();
  const agenda = res.data;
  if (!agenda) {
    const notFound = new Error('议程不存在');
    notFound.code = 'AGENDA_NOT_FOUND';
    throw notFound;
  }
  if (agenda.ownerOpenid !== openid && !(await common.isAdmin(openid))) {
    const forbidden = new Error('无权查看该议程');
    forbidden.code = 'FORBIDDEN';
    throw forbidden;
  }
  return agenda;
}

/**
 * 方法是什么：处理议程查询云函数请求。
 * 方法作用：根据 action 分发列表查询或详情查询。
 * 为什么添加：前端历史页和编辑页都需要读取议程，统一入口便于权限和错误处理。
 */
async function main(event) {
  try {
    common.initCloud();
    const openid = common.getOpenid();
    const action = event && event.action ? event.action : 'list';
    if (action === 'list') {
      return common.ok({ list: await listAgendas(openid) });
    }
    if (action === 'get') {
      return common.ok({ agenda: await getAgenda(openid, event.id) });
    }
    return common.fail('UNKNOWN_ACTION', '不支持的议程查询操作');
  } catch (error) {
    return common.handleError(error);
  }
}

exports.main = main;
