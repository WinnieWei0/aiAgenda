/**
 * 方法是什么：创建一个空议程对象。
 * 方法作用：为编辑页新增议程或无解析数据时提供默认结构。
 * 为什么添加：表单双向绑定需要稳定的数据模型，空对象会导致字段更新报错。
 */
function createEmptyAgenda() {
  return {
    rawText: '',
    meetingInfo: {
      meetingNo: '',
      date: '',
      weekday: '',
      startTime: '19:30',
      endTime: '21:30',
      address: '',
      theme: '',
      language: 'zh'
    },
    items: [],
    participants: [],
    warnings: [],
    unresolvedNames: []
  };
}

/**
 * 方法是什么：创建一个空流程项目。
 * 方法作用：为用户手动新增流程提供默认字段。
 * 为什么添加：用户需要在 AI 解析结果之外补充工作坊、颁奖或其他临时流程。
 */
function createEmptyItem(order) {
  return {
    id: `manual-${Date.now()}`,
    order,
    type: 'manual',
    section: 'manual',
    titleZh: '',
    titleEn: '',
    duration: 0,
    person: {
      rawName: '',
      displayNameZh: '',
      displayNameEn: '',
      clubZh: '',
      clubEn: '',
      unresolved: true
    }
  };
}

/**
 * 方法是什么：重新计算流程顺序。
 * 方法作用：把数组下标转换为从 1 开始的 `order` 字段。
 * 为什么添加：拖拽或上下移动后需要保证保存到数据库的顺序连续可靠。
 */
function normalizeItemOrders(items) {
  const normalized = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = Object.assign({}, items[index], { order: index + 1 });
    normalized.push(item);
  }
  return normalized;
}

/**
 * 方法是什么：交换两个流程项目的位置。
 * 方法作用：按索引移动项目并重新计算 order。
 * 为什么添加：编辑页的拖拽排序和上下移动按钮都需要复用同一套排序逻辑。
 */
function moveItem(items, fromIndex, toIndex) {
  if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length) {
    return normalizeItemOrders(items);
  }
  const cloned = items.slice();
  const moving = cloned.splice(fromIndex, 1)[0];
  cloned.splice(toIndex, 0, moving);
  return normalizeItemOrders(cloned);
}

/**
 * 方法是什么：深拷贝普通 JSON 对象。
 * 方法作用：避免页面直接修改全局状态或云函数返回对象。
 * 为什么添加：小程序 setData 对引用对象较敏感，编辑前拷贝可以减少状态串改。
 */
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

module.exports = {
  createEmptyAgenda,
  createEmptyItem,
  normalizeItemOrders,
  moveItem,
  cloneJson
};
