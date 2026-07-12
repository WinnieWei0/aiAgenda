const XLSX = require('xlsx');

const MEMBERSHIP_HEADERS = {
  nickName: ['昵称'],
  nameZh: ['姓名'],
  nameEn: ['英文名'],
  joinedAt: ['加入头马时间'],
  phone: ['联系电话'],
  email: ['邮箱地址'],
  birthday: ['生日（月/日）', '生日(月/日)'],
  quarter: ['季度'],
  titleOnAgenda: ['Title on Agenda'],
  agendaNameZh: ['议程表填写'],
  educationAwards: ['已完成教育进度'],
  mentorName: ['导师'],
  officerTitleZh: ['官员(中文)', '官员（中文）'],
  officerTitleEn: ['官员(英文)', '官员（英文）'],
  pathNameEn: ['路径'],
  pathNameZh: ['路径(中文)', '路径（中文）'],
  educationProgress: ['教育进度'],
  educationProgressUpdatedAt: ['教育进度更新时间（24.7.18）', '教育进度更新时间(24.7.18)'],
  isMentor: ['是否导师'],
  menteeCount: ['学员数量'],
  competitionEligible: ['是否达到参赛要求'],
  notes: ['备注']
};

/**
 * 方法是什么：标准化 Excel 表头或工作表名称。
 * 方法作用：去掉空白和大小写差异，让同一字段的不同书写方式可以被识别。
 * 为什么添加：Excel 表头经常带有尾部空格或全角空格，直接比较会导致导入漏字段。
 */
function normalizeLabel(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/[\s\u3000]+/g, '')
    .toLowerCase();
}

/**
 * 方法是什么：把 Excel 单元格转换为可写入数据库的文本。
 * 方法作用：统一处理空单元格、日期对象和数字单元格，避免 CloudBase 收到不可序列化值。
 * 为什么添加：会员电话、日期和积分在 Excel 中可能分别被保存为数字、日期或文本。
 */
function toText(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDate(value);
  }
  return String(value).trim();
}

/**
 * 方法是什么：格式化 Excel 日期值。
 * 方法作用：把日期对象或 Excel 日期序列号转换为 `YYYY-MM-DD`。
 * 为什么添加：数据库和前端表单需要稳定的日期字符串，不能依赖 Excel 的本地显示格式。
 */
function formatDate(value) {
  let year;
  let month;
  let day;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    year = value.getFullYear();
    month = value.getMonth() + 1;
    day = value.getDate();
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      year = parsed.y;
      month = parsed.m;
      day = parsed.d;
    }
  }
  if (year && month && day) {
    return [year, String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-');
  }
  const text = toTextWithoutDate(value);
  const match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!match) {
    return text;
  }
  return [match[1], String(match[2]).padStart(2, '0'), String(match[3]).padStart(2, '0')].join('-');
}

/**
 * 方法是什么：在日期格式化过程中读取普通文本。
 * 方法作用：避免日期对象递归调用 `toText`，只保留字符串和数字的原始内容。
 * 为什么添加：日期字段可能是 ISO 文本，必须先读取文本再统一格式化。
 */
function toTextWithoutDate(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

/**
 * 方法是什么：格式化可选日期字段。
 * 方法作用：有日期值时进行标准化，没有日期值时返回空字符串。
 * 为什么添加：Excel 中的空日期不能被误转换为字符串 `undefined` 或数字零。
 */
function toDateText(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  return formatDate(value);
}

/**
 * 方法是什么：转换 Excel 中的是否类字段。
 * 方法作用：识别“是”、Y、true、1 等常见值并输出布尔值。
 * 为什么添加：会员表中的导师和参赛资格字段使用了中文、英文和数字混合表示。
 */
function toBoolean(value) {
  const text = toText(value).toLowerCase();
  return ['是', 'y', 'yes', 'true', '1'].includes(text);
}

/**
 * 方法是什么：建立表头到列下标的映射。
 * 方法作用：支持通过字段别名从一行 Excel 数据中读取值。
 * 为什么添加：源表中存在中英文表头、全角括号和尾部空格等差异。
 */
function buildHeaderMap(headers) {
  const map = {};
  (headers || []).forEach(function mapHeader(header, index) {
    const key = normalizeLabel(header);
    if (key && map[key] === undefined) {
      map[key] = index;
    }
  });
  return map;
}

/**
 * 方法是什么：按照字段别名读取单元格。
 * 方法作用：返回当前行第一个匹配表头的单元格值。
 * 为什么添加：导入逻辑集中处理表头别名后，可以兼容用户稍微调整过的 Excel 表头。
 */
function getCellByAliases(row, headerMap, aliases) {
  for (const alias of aliases || []) {
    const index = headerMap[normalizeLabel(alias)];
    if (index !== undefined) {
      return row[index];
    }
  }
  return '';
}

/**
 * 方法是什么：查找会员表的表头行。
 * 方法作用：在 Membership 工作表中定位同时包含姓名和英文名的表头。
 * 为什么添加：Excel 允许在表头前保留标题或说明行，不能固定假设表头永远是第一行。
 */
function findMembershipHeaderRow(rows) {
  return (rows || []).findIndex(function findHeader(row) {
    const map = buildHeaderMap(row);
    return map[normalizeLabel('姓名')] !== undefined && map[normalizeLabel('英文名')] !== undefined;
  });
}

/**
 * 方法是什么：创建会员原始行对象。
 * 方法作用：把 Excel 表头和值保存为可审计的 `rawRow` 字段。
 * 为什么添加：导入后的数据库记录需要保留原始表格内容，便于管理员追溯字段来源。
 */
function buildRawObject(headers, row) {
  const raw = {};
  (headers || []).forEach(function addRawValue(header, index) {
    const key = toTextWithoutDate(header);
    if (key) {
      raw[key] = toText(row[index]);
    }
  });
  return raw;
}

/**
 * 方法是什么：去除数组尾部的空单元格。
 * 方法作用：保留路径表中间的空列，同时避免把无意义的尾部空列写入数据库。
 * 为什么添加：Pathways 工作表的详情字段位于后面的列，不能直接用 `filter(Boolean)` 破坏列位置。
 */
function trimTrailingEmpty(values) {
  const result = (values || []).map(function normalizeValue(value) {
    return toText(value);
  });
  while (result.length && !result[result.length - 1]) {
    result.pop();
  }
  return result;
}

/**
 * 方法是什么：去重并保留别名顺序。
 * 方法作用：把昵称、中英文名和议程显示名整理成稳定的别名数组。
 * 为什么添加：接龙解析需要支持用户使用昵称、中文名或英文名报名。
 */
function uniqueValues(values) {
  const result = [];
  for (const value of values || []) {
    const text = toText(value);
    if (text && !result.includes(text)) {
      result.push(text);
    }
  }
  return result;
}

/**
 * 方法是什么：构建会员搜索字段。
 * 方法作用：合并姓名、议程显示名和路径信息生成小写搜索文本。
 * 为什么添加：编辑页和接龙解析需要通过多种名称快速匹配会员。
 */
function buildMembershipSearchText(member) {
  return uniqueValues([
    ...(member.aliases || []),
    member.pathNameEn,
    member.pathNameZh
  ]).join(' ').toLowerCase();
}

/**
 * 方法是什么：把 Membership 工作表转换为会员记录。
 * 方法作用：读取当前会员和历史会员区域，并转换为 memberships 集合字段。
 * 为什么添加：数据库必须直接以 Excel 为数据源，不能再依赖仓库内生成的 JSON。
 */
function parseMembershipSheet(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '', blankrows: false });
  const headerIndex = findMembershipHeaderRow(rows);
  if (headerIndex < 0) {
    throw createParseError('MISSING_MEMBERSHIP_HEADER', '未找到 Membership 工作表表头');
  }
  const headers = rows[headerIndex] || [];
  const headerMap = buildHeaderMap(headers);
  const members = [];
  let historyStarted = false;
  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const nameZh = toText(getCellByAliases(row, headerMap, MEMBERSHIP_HEADERS.nameZh));
    const nameEn = toText(getCellByAliases(row, headerMap, MEMBERSHIP_HEADERS.nameEn));
    if (!nameZh && !nameEn) {
      continue;
    }
    if (!nameEn && /历史会员/.test(nameZh)) {
      historyStarted = true;
      continue;
    }
    const nickName = toText(getCellByAliases(row, headerMap, MEMBERSHIP_HEADERS.nickName));
    const titleOnAgenda = toText(getCellByAliases(row, headerMap, MEMBERSHIP_HEADERS.titleOnAgenda));
    const agendaNameZh = toText(getCellByAliases(row, headerMap, MEMBERSHIP_HEADERS.agendaNameZh));
    const pathNameEn = toText(getCellByAliases(row, headerMap, MEMBERSHIP_HEADERS.pathNameEn));
    const pathNameZh = toText(getCellByAliases(row, headerMap, MEMBERSHIP_HEADERS.pathNameZh));
    const member = {
      sourceKey: `membership-row-${rowIndex + 1}`,
      status: historyStarted ? 'history' : 'active',
      nickName,
      nameZh,
      nameEn,
      joinedAt: toDateText(getCellByAliases(row, headerMap, MEMBERSHIP_HEADERS.joinedAt)),
      phone: toText(getCellByAliases(row, headerMap, MEMBERSHIP_HEADERS.phone)),
      email: toText(getCellByAliases(row, headerMap, MEMBERSHIP_HEADERS.email)),
      birthday: toDateText(getCellByAliases(row, headerMap, MEMBERSHIP_HEADERS.birthday)),
      quarter: toText(getCellByAliases(row, headerMap, MEMBERSHIP_HEADERS.quarter)),
      titleOnAgenda,
      agendaNameZh,
      educationAwards: toText(getCellByAliases(row, headerMap, MEMBERSHIP_HEADERS.educationAwards)),
      mentorName: toText(getCellByAliases(row, headerMap, MEMBERSHIP_HEADERS.mentorName)),
      officerTitleZh: toText(getCellByAliases(row, headerMap, MEMBERSHIP_HEADERS.officerTitleZh)),
      officerTitleEn: toText(getCellByAliases(row, headerMap, MEMBERSHIP_HEADERS.officerTitleEn)),
      pathNameEn,
      pathNameZh,
      educationProgress: toText(getCellByAliases(row, headerMap, MEMBERSHIP_HEADERS.educationProgress)),
      educationProgressUpdatedAt: toDateText(getCellByAliases(row, headerMap, MEMBERSHIP_HEADERS.educationProgressUpdatedAt)),
      isMentor: toBoolean(getCellByAliases(row, headerMap, MEMBERSHIP_HEADERS.isMentor)),
      menteeCount: toText(getCellByAliases(row, headerMap, MEMBERSHIP_HEADERS.menteeCount)),
      competitionEligible: toBoolean(getCellByAliases(row, headerMap, MEMBERSHIP_HEADERS.competitionEligible)),
      notes: toText(getCellByAliases(row, headerMap, MEMBERSHIP_HEADERS.notes)),
      clubZh: historyStarted ? '历史会员' : '广州双语',
      clubEn: historyStarted ? 'History' : 'Bilingual',
      aliases: uniqueValues([nickName, nameZh, nameEn, titleOnAgenda, agendaNameZh]),
      rawRow: buildRawObject(headers, row)
    };
    member.searchText = buildMembershipSearchText(member);
    members.push(member);
  }
  if (!members.length) {
    throw createParseError('EMPTY_MEMBERSHIP_DATA', 'Membership 工作表没有可导入的会员数据');
  }
  return members;
}

/**
 * 方法是什么：判断路径数据行。
 * 方法作用：识别 L1-L5 路径代码，并排除 Level 标题行。
 * 为什么添加：Pathways 工作表按级别插入了标题行，不能把标题行写成路径记录。
 */
function isPathwayCode(value) {
  return /^L\d+(?:P[\w-]+)?$/i.test(toText(value).trim());
}

/**
 * 方法是什么：从路径代码获取级别名称。
 * 方法作用：把 L1P1、L3 等代码归类到 Level 1、Level 3。
 * 为什么添加：级别标题在 Excel 中不是每一行都重复，导入时需要继承当前级别。
 */
function levelFromCode(code) {
  const match = toText(code).match(/^L(\d+)/i);
  return match ? `Level ${match[1]}` : '';
}

/**
 * 方法是什么：把 Pathways 工作表转换为项目记录。
 * 方法作用：读取中英文项目名称、目标、详情和技能字段，生成 pathways 集合记录。
 * 为什么添加：备稿描述必须直接来自 Excel 中的项目数据，不能依赖代码内置列表。
 */
function parsePathwaysSheet(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '', blankrows: false });
  const pathways = [];
  let currentLevel = '';
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const firstCell = toText(row[0]);
    const levelMatch = firstCell.match(/^Level\s*(\d+)/i);
    if (levelMatch) {
      currentLevel = `Level ${levelMatch[1]}`;
      continue;
    }
    if (!isPathwayCode(firstCell)) {
      continue;
    }
    const code = firstCell.trim();
    const projectNameEn = toText(row[1]);
    const objectiveEn = toText(row[2]);
    const fullLabelEn = toText(row[3]);
    const projectNameZh = toText(row[4]);
    const objectiveZh = toText(row[5]);
    const fullLabelZh = toText(row[6]);
    if (!projectNameEn && !projectNameZh && !objectiveEn && !objectiveZh) {
      continue;
    }
    const detailZh = toText(row[8]);
    const skillZh = toText(row[9]);
    const rawRow = trimTrailingEmpty(row.slice(0, 11));
    const item = {
      sourceKey: `pathways-row-${rowIndex + 1}`,
      level: currentLevel || levelFromCode(code),
      code,
      projectNameEn,
      objectiveEn,
      fullLabelEn,
      projectNameZh,
      objectiveZh,
      fullLabelZh,
      detailZh,
      skillZh,
      rawRow: rawRow
    };
    item.searchText = uniqueValues([
      item.code,
      item.projectNameEn,
      item.objectiveEn,
      item.fullLabelEn,
      item.projectNameZh,
      item.objectiveZh,
      item.fullLabelZh
    ]).join(' ').toLowerCase();
    pathways.push(item);
  }
  if (!pathways.length) {
    throw createParseError('EMPTY_PATHWAY_DATA', 'Pathways 工作表没有可导入的项目数据');
  }
  return pathways;
}

/**
 * 方法是什么：判断工作表是否是会员表。
 * 方法作用：优先匹配 Membership 名称，名称变化时再通过表头识别。
 * 为什么添加：用户可能另存或重命名工作表，但会员表字段仍然可以作为可靠识别依据。
 */
function isMembershipSheet(workbook, sheetName) {
  if (normalizeLabel(sheetName) === 'membership') {
    return true;
  }
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: '', blankrows: false });
  return findMembershipHeaderRow(rows) >= 0;
}

/**
 * 方法是什么：判断工作表是否是 Pathways 表。
 * 方法作用：优先匹配 Pathways 名称，名称变化时再通过项目代码和中英文项目字段识别。
 * 为什么添加：工作簿包含旧 Projects 表，必须避免误把旧项目表导入当前路径集合。
 */
function isPathwaysSheet(workbook, sheetName) {
  const normalizedName = normalizeLabel(sheetName);
  if (normalizedName.includes('pathways')) {
    return true;
  }
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: '', blankrows: false });
  const hasProjectHeader = rows.some(function findProjectHeader(row) {
    const labels = (row || []).map(normalizeLabel);
    return labels.includes('project') && labels.includes('objective');
  });
  return hasProjectHeader && rows.some(function findPathwayRow(row) {
    return isPathwayCode((row || [])[0]);
  });
}

/**
 * 方法是什么：创建带业务错误码的解析异常。
 * 方法作用：让前端能够区分文件缺少工作表、表头或数据为空等问题。
 * 为什么添加：统一错误码比把 SheetJS 底层异常直接展示给用户更容易定位问题。
 */
function createParseError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * 方法是什么：解析上传的 Excel 工作簿。
 * 方法作用：定位 Membership 和 Pathways(新) 工作表并返回待写入数据库的两组记录。
 * 为什么添加：这是 Excel 直接入库的唯一数据入口，确保生产逻辑不再读取代码内置数据。
 */
function parseWorkbook(buffer) {
  if (!buffer || !buffer.length) {
    throw createParseError('EMPTY_WORKBOOK', '上传的 Excel 文件为空');
  }
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', raw: true, cellDates: false });
  } catch (error) {
    throw createParseError('INVALID_WORKBOOK', '无法读取 Excel 文件，请确认文件未损坏');
  }
  const membershipSheetName = workbook.SheetNames.find(function findMembershipSheet(sheetName) {
    return isMembershipSheet(workbook, sheetName);
  });
  const pathwaysSheetName = workbook.SheetNames.find(function findPathwaysSheet(sheetName) {
    return isPathwaysSheet(workbook, sheetName);
  });
  if (!membershipSheetName) {
    throw createParseError('MISSING_MEMBERSHIP_SHEET', 'Excel 中缺少 Membership 工作表');
  }
  if (!pathwaysSheetName) {
    throw createParseError('MISSING_PATHWAYS_SHEET', 'Excel 中缺少 Pathways 工作表');
  }
  return {
    memberships: parseMembershipSheet(workbook.Sheets[membershipSheetName]),
    pathways: parsePathwaysSheet(workbook.Sheets[pathwaysSheetName]),
    sheets: {
      memberships: membershipSheetName,
      pathways: pathwaysSheetName
    }
  };
}

module.exports = {
  parseWorkbook,
  parseMembershipSheet,
  parsePathwaysSheet,
  toDateText
};
