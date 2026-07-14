const SECTION_DEFINITIONS = [
  { id: 'opening', titleZh: '开场和会议促进者介绍', titleEn: 'Opening and Facilitators' },
  { id: 'tableTopics', titleZh: '即兴演讲环节', titleEn: 'Table Topics Session' },
  { id: 'preparedSpeech', titleZh: '备稿环节', titleEn: 'Prepared Speech Session' },
  { id: 'evaluation', titleZh: '备稿点评环节', titleEn: 'Evaluation Session' },
  { id: 'awardBooking', titleZh: '颁奖与角色预定', titleEn: 'Award and Role Booking' }
];

/**
 * 方法是什么：创建空的人员对象。
 * 方法作用：为流程行提供稳定的人员和俱乐部字段。
 * 为什么添加：表单绑定不能依赖可选的嵌套对象。
 */
function createPerson() {
  return {
    rawName: '',
    memberId: '',
    displayNameZh: '',
    displayNameEn: '',
    clubZh: '广州双语',
    clubEn: 'Bilingual',
    unresolved: true
  };
}

/**
 * 方法是什么：创建空流程行。
 * 方法作用：生成模块内新增流程的默认数据。
 * 为什么添加：用户需要手动补充 PDF 外的临时流程。
 */
function createEmptyItem(order, sectionId) {
  return {
    id: `manual-${Date.now()}-${order}`,
    order,
    type: 'manual',
    section: sectionId || 'awardBooking',
    startTime: '',
    titleZh: '',
    titleEn: '',
    duration: 0,
    person: createPerson()
  };
}

/**
 * 方法是什么：创建模块对象。
 * 方法作用：把模块定义转换为带空行的编辑结构。
 * 为什么添加：编辑页必须固定显示五个 PDF 模块。
 */
function createSection(definition) {
  return {
    id: definition.id,
    titleZh: definition.titleZh,
    titleEn: definition.titleEn,
    items: []
  };
}

/**
 * 方法是什么：创建默认模块列表。
 * 方法作用：按 PDF 顺序生成全部议程模块。
 * 为什么添加：新建议程和旧数据升级都需要一致的模块顺序。
 */
function createDefaultSections() {
  return SECTION_DEFINITIONS.map(createSection);
}

/**
 * 方法是什么：创建空议程。
 * 方法作用：提供会议、模块和校验字段的完整默认结构。
 * 为什么添加：编辑页首次打开时需要可绑定的数据对象。
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
    sections: createDefaultSections(),
    items: [],
    participants: [],
    warnings: [],
    unresolvedNames: []
  };
}

/**
 * 方法是什么：复制 JSON 数据。
 * 方法作用：创建普通对象的深拷贝。
 * 为什么添加：编辑状态不能直接修改全局议程引用。
 */
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value === undefined ? {} : value));
}

/**
 * 方法是什么：读取模块定义。
 * 方法作用：为自定义或旧模块补全中英文标题。
 * 为什么添加：升级数据时需要防止模块名称为空。
 */
function getSectionDefinition(id) {
  return SECTION_DEFINITIONS.find((definition) => definition.id === id) || SECTION_DEFINITIONS[SECTION_DEFINITIONS.length - 1];
}

/**
 * 方法是什么：规范化流程行。
 * 方法作用：补齐流程 ID、顺序、时长、标题和人员字段。
 * 为什么添加：拖动和保存需要稳定的行结构。
 */
function normalizeItem(item, order, sectionId) {
  const normalized = Object.assign({}, item || {});
  normalized.id = normalized.id || `manual-${Date.now()}-${order}`;
  normalized.order = order;
  normalized.section = sectionId || normalized.section || 'awardBooking';
  normalized.titleZh = normalized.titleZh || '';
  normalized.titleEn = normalized.titleEn || normalized.titleZh || '';
  normalized.duration = Math.max(Number(normalized.duration) || 0, 0);
  normalized.startTime = normalized.startTime || '';
  if (!normalized.person) {
    normalized.person = normalized.speech && normalized.speech.speaker
      ? Object.assign({}, normalized.speech.speaker)
      : createPerson();
  }
  return normalized;
}

/**
 * 方法是什么：把旧平面流程转换为模块。
 * 方法作用：按 section 字段将旧 items 放入对应模块。
 * 为什么添加：已有解析结果需要无损升级到新编辑器。
 */
function sectionsFromItems(items) {
  const sections = createDefaultSections();
  const sectionMap = sections.reduce((map, section) => {
    map[section.id] = section;
    return map;
  }, {});
  (items || []).forEach((item) => {
    const sectionId = sectionMap[item.section] ? item.section : 'awardBooking';
    sectionMap[sectionId].items.push(item);
  });
  return normalizeSections(sections);
}

/**
 * 方法是什么：规范化模块列表。
 * 方法作用：补全固定模块并重新排列模块内流程行。
 * 为什么添加：数据库和前端可能提交旧结构或缺少空模块。
 */
function normalizeSections(sections, legacyItems) {
  const source = Array.isArray(sections) && sections.length ? sections : sectionsFromItems(legacyItems || []);
  const seen = new Set();
  const normalized = [];
  source.forEach((section) => {
    const id = section && section.id && !seen.has(section.id) ? section.id : '';
    if (!id) {
      return;
    }
    seen.add(id);
    const definition = getSectionDefinition(id);
    normalized.push({
      id,
      titleZh: section.titleZh || definition.titleZh,
      titleEn: section.titleEn || definition.titleEn,
      items: (section.items || []).map((item, index) => normalizeItem(item, index + 1, id))
    });
  });
  SECTION_DEFINITIONS.forEach((definition) => {
    if (!seen.has(definition.id)) {
      normalized.push(createSection(definition));
    }
  });
  return normalized;
}

/**
 * 方法是什么：展开模块流程。
 * 方法作用：生成兼容旧接口和 PDF 的连续 items 数组。
 * 为什么添加：云端升级期间仍需要支持旧数据消费者。
 */
function flattenSections(sections) {
  let order = 1;
  const items = [];
  (sections || []).forEach((section) => {
    (section.items || []).forEach((item) => {
      items.push(Object.assign({}, item, { order, section: section.id }));
      order += 1;
    });
  });
  return items;
}

/**
 * 方法是什么：解析时间字符串。
 * 方法作用：将 HH:mm 转换为分钟数。
 * 为什么添加：开始时间计算需要可加减的数值。
 */
function parseTime(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

/**
 * 方法是什么：格式化分钟数。
 * 方法作用：将分钟数转换回 HH:mm。
 * 为什么添加：表单和 PDF 需要显示稳定的时间文本。
 */
function formatTime(totalMinutes) {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = String(Math.floor(normalized / 60)).padStart(2, '0');
  const minutes = String(normalized % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * 方法是什么：规范化议程。
 * 方法作用：统一会议信息、模块和兼容 items 并计算时间。
 * 为什么添加：页面每次编辑后都需要得到可保存结构。
 */
function normalizeAgenda(agenda) {
  const normalized = cloneJson(agenda || createEmptyAgenda());
  normalized.meetingInfo = Object.assign({}, createEmptyAgenda().meetingInfo, normalized.meetingInfo || {});
  normalized.sections = normalizeSections(normalized.sections, normalized.items);
  normalized.items = flattenSections(normalized.sections);
  return calculateStartTimes(normalized);
}

/**
 * 方法是什么：计算流程开始时间。
 * 方法作用：按模块和行顺序累计限时并写入每行 startTime。
 * 为什么添加：排序或限时变化后时间必须自动更新。
 */
function calculateStartTimes(agenda) {
  const normalized = agenda;
  let cursor = parseTime(normalized.meetingInfo && normalized.meetingInfo.startTime);
  if (cursor === null) {
    cursor = 0;
  }
  normalized.sections.forEach((section) => {
    section.items = section.items.map((item, index) => {
      const next = normalizeItem(item, index + 1, section.id);
      next.startTime = formatTime(cursor);
      cursor += next.duration;
      return next;
    });
  });
  normalized.items = flattenSections(normalized.sections);
  return normalized;
}

/**
 * 方法是什么：移动模块。
 * 方法作用：交换两个模块的位置。
 * 为什么添加：编辑器需要支持模块级拖动和按钮排序。
 */
function moveSection(sections, fromIndex, toIndex) {
  if (fromIndex < 0 || fromIndex >= sections.length || toIndex < 0 || toIndex >= sections.length) {
    return sections;
  }
  const cloned = sections.slice();
  const moving = cloned.splice(fromIndex, 1)[0];
  cloned.splice(toIndex, 0, moving);
  return cloned;
}

/**
 * 方法是什么：移动模块内流程。
 * 方法作用：交换同一模块中的两行并保留模块边界。
 * 为什么添加：流程排序不能意外跨模块移动。
 */
function moveItem(sections, sectionIndex, fromIndex, toIndex) {
  const section = sections[sectionIndex];
  if (!section || fromIndex < 0 || fromIndex >= section.items.length || toIndex < 0 || toIndex >= section.items.length) {
    return sections;
  }
  const cloned = sections.slice();
  const items = section.items.slice();
  const moving = items.splice(fromIndex, 1)[0];
  items.splice(toIndex, 0, moving);
  cloned[sectionIndex] = Object.assign({}, section, { items });
  return cloned;
}

/**
 * 方法是什么：规范化流程顺序。
 * 方法作用：为流程数组生成连续的 order 字段。
 * 为什么添加：保存和 PDF 都需要稳定的行顺序。
 */
function normalizeItemOrders(items) {
  return (items || []).map((item, index) => normalizeItem(item, index + 1, item.section));
}

module.exports = {
  SECTION_DEFINITIONS,
  createEmptyAgenda,
  createEmptyItem,
  createDefaultSections,
  normalizeSections,
  normalizeAgenda,
  calculateStartTimes,
  flattenSections,
  normalizeItemOrders,
  moveSection,
  moveItem,
  parseTime,
  formatTime,
  cloneJson
};
