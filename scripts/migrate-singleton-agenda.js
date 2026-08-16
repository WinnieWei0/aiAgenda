const membershipImporter = require('./import-membership');
const agendaModel = require('../cloudfunctions/common/agenda-model');
const cloud = require('../cloudfunctions/seedWorkbookData/node_modules/wx-server-sdk');

const CURRENT_AGENDA_ID = 'current';

/**
 * 方法是什么：清空指定集合。
 * 方法作用：分批删除集合中的全部文档并返回删除数量。
 * 为什么添加：单例迁移明确要求清除所有旧议程、报名和占位数据。
 */
async function clearCollection(db, collectionName) {
  let removed = 0;
  while (true) {
    let result;
    try {
      result = await db.collection(collectionName).limit(100).get();
    } catch (error) {
      if (String(error && (error.errMsg || error.message) || '').includes('collection not exists')) return removed;
      throw error;
    }
    const records = result.data || [];
    if (!records.length) return removed;
    for (const record of records) {
      await db.collection(collectionName).doc(record._id).remove();
      removed += 1;
    }
  }
}

/**
 * 方法是什么：读取当前议程模板。
 * 方法作用：优先使用数据库模板，没有时回退代码默认模板。
 * 为什么添加：迁移创建的空白议程必须与线上编辑器规则一致。
 */
async function loadTemplate(db) {
  try {
    const result = await db.collection('agenda_templates').where({ templateId: agendaModel.TEMPLATE_ID }).limit(1).get();
    if (result.data && result.data.length) return agendaModel.normalizeTemplate(result.data[0]);
  } catch (error) {
    if (!String(error && (error.errMsg || error.message) || '').includes('collection not exists')) throw error;
  }
  return agendaModel.createDefaultTemplate();
}

/**
 * 方法是什么：构建空白单例议程记录。
 * 方法作用：生成 current 文档需要的议程、摘要和报名字段。
 * 为什么添加：迁移重复执行后必须稳定得到同一份空白单例结构。
 */
function buildCurrentRecord(template, nowValue) {
  const now = nowValue || new Date().toISOString();
  const agenda = agendaModel.createAgendaFromFacts({}, template);
  const info = agenda.meetingInfo || {};
  return {
    ownerOpenid: '',
    agenda,
    meetingSummary: { meetingNo: info.meetingNo || '', date: info.date || '', startTime: info.startTime || '', endTime: info.endTime || '' },
    signupPublicId: CURRENT_AGENDA_ID,
    signupSlots: [],
    signupVersion: 0,
    createdAt: now,
    updatedAt: now
  };
}

/**
 * 方法是什么：执行全局单例议程迁移。
 * 方法作用：清空旧会议数据并创建固定 agendas/current 文档。
 * 为什么添加：固定报名链接上线前必须消除按用户保存的旧议程。
 */
async function run() {
  const config = membershipImporter.getConfig();
  cloud.init({ env: config.envId, secretId: config.secretId, secretKey: config.secretKey });
  const db = cloud.database();
  const removed = {};
  removed.agenda_signups = await clearCollection(db, 'agenda_signups');
  removed.agenda_signup_claims = await clearCollection(db, 'agenda_signup_claims');
  removed.agendas = await clearCollection(db, 'agendas');
  const template = await loadTemplate(db);
  await db.collection('agendas').doc(CURRENT_AGENDA_ID).set({ data: buildCurrentRecord(template) });
  console.log(`单例议程迁移完成：${JSON.stringify(removed)}，已创建 agendas/${CURRENT_AGENDA_ID}`);
  return { removed, agendaId: CURRENT_AGENDA_ID };
}

if (require.main === module) {
  run().catch((error) => { console.error(error && error.message || error); process.exitCode = 1; });
}

module.exports = { CURRENT_AGENDA_ID, clearCollection, loadTemplate, buildCurrentRecord, run };
