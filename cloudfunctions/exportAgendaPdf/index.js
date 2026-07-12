const common = require('agenda-common');

/**
 * 方法是什么：根据 ID 查询议程记录。
 * 方法作用：从 `agendas` 集合读取用户要导出的议程。
 * 为什么添加：PDF 导出必须以服务器保存的数据为准，避免前端临时数据和数据库不一致。
 */
async function loadAgenda(agendaId) {
  const db = common.getDb();
  const res = await db.collection('agendas').doc(agendaId).get();
  return res.data;
}

/**
 * 方法是什么：上传 PDF Buffer 到云存储。
 * 方法作用：把生成的 PDF 存到 `agenda-pdfs/` 路径并返回 fileID。
 * 为什么添加：小程序预览和分享 PDF 都需要先把文件保存到云存储。
 */
async function uploadPdf(buffer, agenda, language) {
  const cloud = common.initCloud();
  const info = agenda.meetingInfo || {};
  const meetingNo = info.meetingNo || agenda._id || Date.now();
  const cloudPath = `agenda-pdfs/${meetingNo}-${language}-${Date.now()}.pdf`;
  const res = await cloud.uploadFile({ cloudPath, fileContent: buffer });
  return res.fileID;
}

/**
 * 方法是什么：记录 PDF 导出历史。
 * 方法作用：把 agendaId、语言、fileID 和导出人写入 `pdf_exports`。
 * 为什么添加：历史议程页需要展示最近导出的文件，也方便后续审计和重新下载。
 */
async function saveExportRecord(agendaId, language, fileID, openid) {
  const db = common.getDb();
  const res = await db.collection('pdf_exports').add({
    data: {
      agendaId,
      language,
      fileID,
      ownerOpenid: openid,
      createdAt: common.nowIso(),
      updatedAt: common.nowIso()
    }
  });
  return res._id;
}

/**
 * 方法是什么：处理议程 PDF 导出云函数请求。
 * 方法作用：读取议程、生成中/英文 PDF、上传云存储并返回文件 ID。
 * 为什么添加：PDF 生成需要服务端能力，小程序端只负责触发和预览结果。
 */
async function main(event) {
  try {
    common.initCloud();
    const openid = common.getOpenid();
    const agendaId = event && event.agendaId ? event.agendaId : '';
    const language = event && event.language === 'en' ? 'en' : 'zh';
    if (!agendaId) {
      return common.fail('EMPTY_AGENDA_ID', '缺少议程 ID');
    }
    const agenda = await loadAgenda(agendaId);
    if (!agenda) {
      return common.fail('AGENDA_NOT_FOUND', '议程不存在');
    }
    if (agenda.ownerOpenid !== openid && !(await common.isAdmin(openid))) {
      return common.fail('FORBIDDEN', '只能导出自己的议程');
    }
    const buffer = await common.pdfRenderer.renderAgendaPdf(agenda, language);
    const fileID = await uploadPdf(buffer, agenda, language);
    const exportId = await saveExportRecord(agendaId, language, fileID, openid);
    const temp = await common.cloud.getTempFileURL({ fileList: [fileID] });
    return common.ok({ exportId, fileID, tempFileURL: temp.fileList && temp.fileList[0] ? temp.fileList[0].tempFileURL : '' });
  } catch (error) {
    return common.handleError(error);
  }
}

exports.main = main;
