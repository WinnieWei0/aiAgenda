function unwrapPathway(item) {
  return item && item.pathway ? item.pathway : item;
}

/**
 * 方法是什么：筛选 Pathways 项目。
 * 方法作用：按代码、等级和中英文完整标签过滤项目候选。
 * 为什么添加：项目选择弹窗需要支持 level 和双语标签搜索，而原有会员搜索只处理姓名字段。
 */
function filterPathways(items, keyword) {
  const value = String(keyword || '').trim().toLowerCase();
  return (items || []).map(unwrapPathway).filter((pathway) => {
    if (!pathway) return false;
    return !value || [pathway.code, pathway.level, pathway.fullLabelZh, pathway.fullLabelEn]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(value);
  });
}

function pathwayKey(pathway) {
  return pathway && (pathway._id || pathway.code) || '';
}

module.exports = { unwrapPathway, filterPathways, pathwayKey };
