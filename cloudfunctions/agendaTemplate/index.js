const common = require('agenda-common');

/**
 * 方法是什么：解析模板和议程为统一视图模型。
 * 方法作用：规范化用户提交的数据并生成预览与 PDF 共用的连续显示行。
 * 为什么添加：小程序预览和服务端导出必须使用相同的模板内容、时间和行顺序。
 */
function resolveViewModel(agenda, template) {
  const normalized = common.agendaModel.normalizeAgenda(agenda, template);
  const language = common.agendaModel.normalizeLanguage(normalized.meetingInfo.language);
  return {
    template: common.agendaModel.resolveTemplateLocale(template, language),
    agenda: normalized,
    rows: common.agendaModel.flattenAgendaRows(normalized)
  };
}

/**
 * 方法是什么：处理全局议程模板请求。
 * 方法作用：提供模板初始化读取、模拟超管保存和议程视图解析。
 * 为什么添加：模板编辑、A4 预览和 PDF 导出需要一个统一云端入口。
 */
async function main(event) {
  try {
    common.initCloud();
    const action = event && event.action ? event.action : 'get';
    if (action === 'get') {
      return common.ok({ template: await common.getAgendaTemplate() });
    }
    if (action === 'save') {
      return common.ok({ template: await common.saveAgendaTemplate(event.template || {}) });
    }
    if (action === 'resolve') {
      const template = event.template
        ? common.agendaModel.normalizeTemplate(event.template)
        : await common.getAgendaTemplate();
      return common.ok(resolveViewModel(event.agenda || {}, template));
    }
    return common.fail('UNKNOWN_ACTION', '不支持的模板操作');
  } catch (error) {
    return common.handleError(error);
  }
}

module.exports = { resolveViewModel, main };
exports.main = main;
