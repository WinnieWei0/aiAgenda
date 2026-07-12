const common = require('agenda-common');

/**
 * 方法是什么：读取指定集合的全部基础数据。
 * 方法作用：分批加载 Membership 或 Pathways，用于接龙解析时匹配姓名和项目。
 * 为什么添加：解析需要完整字典，单次查询默认限制较小，分批读取更稳。
 */
async function loadAll(collectionName) {
  const db = common.getDb();
  const list = [];
  let skip = 0;
  const pageSize = 100;
  let hasMore = true;
  while (hasMore) {
    const res = await db.collection(collectionName).skip(skip).limit(pageSize).get();
    const data = res.data || [];
    for (const item of data) {
      list.push(item);
    }
    skip += data.length;
    hasMore = data.length === pageSize;
  }
  return list;
}

/**
 * 方法是什么：处理接龙解析云函数请求。
 * 方法作用：先规则解析，再尝试 DeepSeek 解析并合并，最后补充校验信息。
 * 为什么添加：用户粘贴的是非结构化文本，需要转换成可编辑、可保存、可导出的议程结构。
 */
async function main(event) {
  try {
    common.initCloud();
    const rawText = common.parser.normalizeText(event && event.rawText);
    if (!rawText) {
      return common.fail('EMPTY_TEXT', '请先粘贴接龙文本');
    }
    const memberships = await loadAll('memberships');
    const pathways = await loadAll('pathways');
    const ruleResult = common.parser.parseAgendaByRules(rawText, memberships, pathways);
    let aiResult = null;
    try {
      aiResult = await common.deepseek.parseAgendaWithDeepSeek(rawText);
    } catch (aiError) {
      aiResult = null;
    }
    const merged = common.parser.mergeAiResult(aiResult, ruleResult, memberships, pathways);
    const validated = common.parser.validateAgenda(Object.assign({}, merged, { rawText }));
    return common.ok({ agenda: validated, aiUsed: Boolean(aiResult) });
  } catch (error) {
    return common.handleError(error);
  }
}

exports.main = main;
