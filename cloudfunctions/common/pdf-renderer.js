const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const agendaModel = require('./agenda-model');

const LATIN_FONTS = new WeakMap();
const PDF_EN_TITLES = {
  preparation: 'Meeting Manager', signIn: 'Sign In &Welcome Guests', venueIntroduction: 'Call Meeting Order',
  opening: 'Opening Remark', openingRemarks: 'Introduction', guestIntroduction: 'Guest Self-introduction',
  facilitatorIntroduction: 'Meeting Facilitators', host: 'Toastmaster of the Meeting', photographer: 'Photo Master',
  timerIntro: 'Timer', ahCounterIntro: 'Ah-counter', grammarianIntro: 'Grammarian', generalEvaluatorIntro: 'General Evaluator',
  tableTopics: 'Table Topics Section', topicExplanation: 'Explain Table Topics and the Theme',
  tableTopicsSpeech: 'Impromptu Speaking in 2 mins',
  topicNote: 'Each speaker may be given an individual subject. Think on your feet and speak for 1-2 minutes',
  topicSummary: 'Conclude the Table Topics', tableTopicsEvaluation: 'Table Topics Evaluator',
  preparedSpeech: 'Prepared Speeches Section', break: 'Break+Photograph', evaluation: 'Individual Evaluation',
  facilitatorReport: "Facilitators' Report", grammarianReport: 'Grammarian', ahCounterReport: 'Ah-counter',
  timerReport: 'Timer', generalEvaluatorReport: 'General Evaluator', vote: 'Voting', closing: 'Closing Remark',
  feedback: 'Feedback', award: 'Present Awards to Best Speakers', roleBooking: 'Role Booking Time', end: 'Meeting Adjourned'
};

function getLocalizedRoleTitle(row, language) {
  if (language !== 'en') return row.titleZh || '';
  return PDF_EN_TITLES[row.id] || row.titleEn || row.titleZh || '';
}

const PAGE = { width: 595.28, height: 841.89, margin: 26 };
const BLACK = rgb(0.05, 0.05, 0.05);
const BORDER = rgb(0.12, 0.12, 0.12);
const LIGHT_BORDER = rgb(0.82, 0.85, 0.89);

/**
 * 方法是什么：把十六进制颜色转换为 PDF RGB。
 * 方法作用：允许版式配置继续使用熟悉的网页颜色字符串。
 * 为什么添加：pdf-lib 绘图接口只接受归一化 rgb 对象。
 */
function hexToRgb(hex) {
  const value = String(hex || '#ffffff').replace('#', '');
  return rgb(parseInt(value.slice(0, 2), 16) / 255, parseInt(value.slice(2, 4), 16) / 255, parseInt(value.slice(4, 6), 16) / 255);
}

/**
 * 方法是什么：查找中文 PDF 字体。
 * 方法作用：按环境变量、公共包字体和项目字体顺序返回可用路径。
 * 为什么添加：云函数系统字体不稳定，中文导出必须嵌入确定字体。
 */
function resolveFontPath() {
  const candidates = [
    process.env.PDF_FONT_PATH,
    path.join(__dirname, 'fonts', 'HYShuSongErKW.ttf'),
    path.join(__dirname, 'fonts', 'HYShuSongErKW.otf'),
    path.join(__dirname, 'fonts', 'NotoSerifSC-Medium.ttf')
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || '';
}

/**
 * 方法是什么：嵌入议程中文字体。
 * 方法作用：注册 fontkit 并返回完整的中英文字体。
 * 为什么添加：当前 fontkit 子集化在大量中英文重复绘制时会生成错误字形映射，导致 PDF 只显示零散字母。
 */
async function embedAgendaFont(pdfDoc) {
  const fontPath = resolveFontPath();
  if (!fontPath) {
    throw new Error('缺少中文字体 common/fonts/NotoSerifSC-Medium.ttf');
  }
  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(fs.readFileSync(fontPath), { subset: false });
  LATIN_FONTS.set(font, await pdfDoc.embedFont(StandardFonts.TimesRoman));
  return font;
}

function fontForText(font, text) {
  return /^[\x00-\x7F]*$/.test(String(text || '')) ? LATIN_FONTS.get(font) || font : font;
}

/**
 * 方法是什么：转换顶部坐标。
 * 方法作用：把从页面顶部向下的坐标转换成 PDF 底部坐标系。
 * 为什么添加：按照源 PDF 视觉稿排版时使用顶部坐标更容易核对。
 */
function topY(y, height) {
  return PAGE.height - y - height;
}

/**
 * 方法是什么：按可用宽度拆分文字。
 * 方法作用：使用真实字体宽度把中英文内容切成可绘制行。
 * 为什么添加：固定卡片、项目目标和第二页说明不能溢出边框。
 */
function wrapText(text, font, fontSize, maxWidth) {
  const value = String(text || '');
  const lines = [];
  for (const paragraph of value.split('\n')) {
    const paragraphFont = fontForText(font, paragraph);
    let current = '';
    for (const char of paragraph) {
      const next = current + char;
      if (!current || paragraphFont.widthOfTextAtSize(next, fontSize) <= maxWidth) {
        current = next;
      } else {
        lines.push(current);
        current = char;
      }
    }
    lines.push(current);
  }
  return lines.length ? lines : [''];
}

/**
 * 方法是什么：绘制自动换行文字。
 * 方法作用：在指定矩形内支持字号、颜色、粗细感和水平对齐。
 * 为什么添加：页眉、单元格和第二页说明需要共享一致的文字裁切规则。
 */
function drawText(page, font, text, x, y, options) {
  const opts = options || {};
  const fontSize = opts.fontSize || 7;
  const width = opts.width || 100;
  const height = opts.height || 12;
  const lineHeight = opts.lineHeight || fontSize + 1.5;
  const maxLines = Math.max(1, Math.floor((height - fontSize) / lineHeight) + 1);
  const lines = wrapText(text, font, fontSize, width).slice(0, maxLines);
  const textHeight = fontSize + Math.max(lines.length - 1, 0) * lineHeight;
  const verticalOffset = opts.verticalAlign === 'middle' ? Math.max((height - textHeight) / 2, 0) : 1;
  let cursorY = topY(y, height) + height - fontSize - verticalOffset;
  for (const line of lines) {
    if (cursorY < topY(y, height)) {
      break;
    }
    const lineFont = fontForText(font, line);
    const lineWidth = lineFont.widthOfTextAtSize(line, fontSize);
    const offset = opts.align === 'center' ? Math.max((width - lineWidth) / 2, 0) : opts.align === 'right' ? Math.max(width - lineWidth, 0) : 0;
    const textOptions = { x: x + offset, y: cursorY, size: fontSize, font: lineFont, color: opts.color || BLACK };
    page.drawText(line, textOptions);
    if (opts.bold) {
      page.drawText(line, Object.assign({}, textOptions, { x: textOptions.x + 0.18 }));
    }
    cursorY -= lineHeight;
  }
}

/**
 * 方法是什么：绘制模板单元格。
 * 方法作用：输出背景、边框和自动换行文本并保持统一内边距。
 * 为什么添加：议程两页包含大量规则表格，必须共用精确线条样式。
 */
function drawCell(page, font, x, y, width, height, text, options) {
  const opts = options || {};
  const paddingLeft = opts.paddingLeft === undefined ? 2.5 : opts.paddingLeft;
  const paddingRight = opts.paddingRight === undefined ? 2.5 : opts.paddingRight;
  if (opts.fill || opts.border !== false) {
    page.drawRectangle({
      x,
      y: topY(y, height),
      width,
      height,
      color: opts.fill ? hexToRgb(opts.fill) : undefined,
      borderColor: opts.border === false ? undefined : BORDER,
      borderWidth: opts.border === false ? 0 : 0.45
    });
  }
  drawText(page, font, text, x + paddingLeft, y + 1, {
    width: width - paddingLeft - paddingRight,
    height: height - 2,
    fontSize: opts.fontSize || 6.5,
    lineHeight: opts.lineHeight,
    align: opts.align || 'left',
    color: opts.color || BLACK,
    bold: opts.bold,
    verticalAlign: opts.verticalAlign
  });
}

/**
 * 方法是什么：绘制带圆角的模板信息卡。
 * 方法作用：恢复原议程表页眉四张蓝色信息卡的柔和轮廓。
 * 为什么添加：方角卡片会让页眉显得像普通报表，偏离原模板的视觉特征。
 */
function drawRoundedCell(page, font, x, y, width, height, text, options) {
  const opts = options || {};
  const radius = Math.min(opts.radius || 8, width / 2, height / 2);
  const control = radius * 0.55228475;
  const roundedPath = [
    `M ${radius} 0`,
    `L ${width - radius} 0`,
    `C ${width - radius + control} 0 ${width} ${radius - control} ${width} ${radius}`,
    `L ${width} ${height - radius}`,
    `C ${width} ${height - radius + control} ${width - radius + control} ${height} ${width - radius} ${height}`,
    `L ${radius} ${height}`,
    `C ${radius - control} ${height} 0 ${height - radius + control} 0 ${height - radius}`,
    `L 0 ${radius}`,
    `C 0 ${radius - control} ${radius - control} 0 ${radius} 0`,
    'Z'
  ].join(' ');
  page.drawSvgPath(roundedPath, {
    x,
    y: PAGE.height - y,
    color: opts.fill ? hexToRgb(opts.fill) : rgb(1, 1, 1),
    borderColor: BORDER,
    borderWidth: 0.65
  });
  if (opts.title !== undefined) {
    drawText(page, font, opts.title, x + 5, y + 4, {
      width: width - 10,
      height: 8,
      fontSize: opts.titleFontSize || 5.3,
      lineHeight: opts.titleLineHeight || 6.3,
      color: BLACK,
      bold: true
    });
    drawText(page, font, opts.value || '', x + 5, y + 12, {
      width: width - 10,
      height: height - 16,
      fontSize: opts.fontSize || 5,
      lineHeight: opts.lineHeight || 6.2,
      color: BLACK
    });
  } else {
    drawText(page, font, text, x + 5, y + 5, {
      width: width - 10,
      height: height - 10,
      fontSize: opts.fontSize || 5,
      lineHeight: opts.lineHeight || 6,
      color: BLACK
    });
  }
}

/**
 * 方法是什么：解析模板素材文件。
 * 方法作用：优先读取云端传入的 base64，再按文件名读取公共包内置图片。
 * 为什么添加：默认素材和超管替换的云存储素材需要使用同一嵌入入口。
 */
function getAssetBytes(template, field, agenda) {
  const buffers = template.assetBuffers || {};
  const agendaBuffers = agenda && agenda.assetBuffers || {};
  if (field === 'meetingGroupQr' && agendaBuffers[field]) {
    return Buffer.from(agendaBuffers[field], 'base64');
  }
  if (buffers[field]) {
    return Buffer.from(buffers[field], 'base64');
  }
  const source = field === 'meetingGroupQr' && agenda && agenda.assets ? agenda.assets[field] : template.assets && template.assets[field];
  const filename = path.basename(String(source || `${field}.png`));
  const local = path.join(__dirname, 'assets', filename);
  return fs.existsSync(local) ? fs.readFileSync(local) : null;
}

/**
 * 方法是什么：嵌入模板图片集合。
 * 方法作用：把 Logo、教育体系和三个二维码预先转换为 PDF 图片对象。
 * 为什么添加：绘制页面时重复解析图片会增加耗时并导致接口分散。
 */
async function embedTemplateImages(pdfDoc, template, agenda) {
  const result = {};
  for (const field of ['logo', 'educationSystem', 'membershipQr', 'officialQr', 'meetingGroupQr']) {
    const bytes = getAssetBytes(template, field, agenda);
    if (!bytes) {
      continue;
    }
    try {
      result[field] = await pdfDoc.embedPng(bytes);
    } catch (error) {
      result[field] = await pdfDoc.embedJpg(bytes);
    }
  }
  return result;
}

/**
 * 方法是什么：按比例绘制图片。
 * 方法作用：让品牌素材完整居中显示在目标矩形且不发生拉伸。
 * 为什么添加：二维码和教育体系图必须保持原始比例与可识别性。
 */
function drawImageFit(page, image, x, y, width, height) {
  if (!image) {
    return;
  }
  const scale = Math.min(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  page.drawImage(image, {
    x: x + (width - drawWidth) / 2,
    y: topY(y + (height - drawHeight) / 2, drawHeight),
    width: drawWidth,
    height: drawHeight
  });
}

/**
 * 方法是什么：读取人员显示姓名。
 * 方法作用：兼容普通行、备稿演讲块、多人签到和固定人员。
 * 为什么添加：不同 AgendaV2 节点在同一 PDF 人员列中必须稳定展示。
 */
function formatPersonName(person, language) {
  if (!person) {
    return '';
  }
  const field = language === 'en' ? 'displayNameEn' : 'displayNameZh';
  const name = person[field] || person.rawName || '';
  if (!person.memberId || !name) {
    return name;
  }
  const educationAwards = String(person.educationAwards || '').trim();
  const officerTitleValue = language === 'en'
    ? person.officerTitleEn || person.officerTitleZh
    : person.officerTitleZh || person.officerTitleEn;
  const officerTitle = String(officerTitleValue || '')
    .trim()
    .replace(/^[<\uFF1C\u3008\u300A]+/, '')
    .replace(/[>\uFF1E\u3009\u300B]+$/, '')
    .trim();
  return `${name}${educationAwards ? `(${educationAwards})` : ''}${officerTitle ? `<${officerTitle}>` : ''}`;
}

function getRowPersonName(row, language) {
  if (language === 'en' && row.id === 'vote') {
    return '';
  }
  if (row.type === 'preparedSpeechBlock') {
    return formatPersonName(row.speaker, language);
  }
  if (Array.isArray(row.persons) && row.persons.length) {
    return row.persons.map((person) => formatPersonName(person, language)).filter(Boolean).join(' && ');
  }
  return formatPersonName(row.person, language);
}

/**
 * 方法是什么：读取人员俱乐部。
 * 方法作用：按行级固定俱乐部、备稿演讲者或普通人员顺序选择显示值。
 * 为什么添加：中场休息、会员选择和手输来宾使用不同俱乐部来源。
 */
function getRowClub(row, language) {
  const field = language === 'en' ? 'clubEn' : 'clubZh';
  if (row[field]) {
    return row[field];
  }
  if (row.type === 'preparedSpeechBlock') {
    return row.speaker && row.speaker[field] || '';
  }
  return row.person && row.person[field] || '';
}

/**
 * 方法是什么：计算议程 PDF 行高。
 * 方法作用：为大模块、说明行、普通行和备稿项目分配不同高度。
 * 为什么添加：固定第一页必须尽量紧凑，同时保证项目描述可读且不重叠。
 */
function getAgendaRowHeight(row, language) {
  if (row.type === 'workshopTopic') {
    const length = String(row.topic || row.titleZh || '').length;
    return length > 70 ? 20 : length > 35 ? 15 : 11;
  }
  if (row.type === 'preparedSpeechBlock') {
    const objective = row.pathway && (language === 'en' ? row.pathway.objectiveEn : row.pathway.objectiveZh) || '';
    return objective.length > 90 ? 38 : 31;
  }
  if (row.type === 'note') {
    return 11;
  }
  return row.isGroup ? 10.5 : 10;
}

/**
 * 方法是什么：绘制第一页品牌页眉。
 * 方法作用：复刻标题、信息卡、使命文案和每期会议元数据。
 * 为什么添加：源 PDF 的品牌识别和基础信息必须成为固定模板的一部分。
 */
function drawFirstPageHeader(page, font, template, agenda, images, language) {
  const fixed = template.locales && template.locales.zh && template.locales.zh.fixedContent || template.fixedContent;
  drawText(page, font, fixed.clubTitle, PAGE.margin + 65, 46, { width: 410, height: 22, fontSize: 15, align: 'center', bold: true });
  drawText(page, font, fixed.clubSubtitle, PAGE.margin + 80, 69, { width: 380, height: 18, fontSize: 12.5, align: 'center', bold: true });
  drawText(page, font, fixed.charter, 487, 70, { width: 72, height: 24, fontSize: 4.8, align: 'right' });
  drawImageFit(page, images.logo, PAGE.margin + 4, 103, 47, 49);
  const cards = [
    { x: PAGE.margin + 55, w: 100, title: '会议时间 Time', value: fixed.meetingTime },
    { x: PAGE.margin + 159, w: 132, title: '会议地址 Venue', value: fixed.venue },
    { x: PAGE.margin + 295, w: 148, title: '费用说明 Fees', value: fixed.fees },
    { x: PAGE.margin + 447, w: 88, title: '禁忌话题 Taboo Topics', value: fixed.tabooTopics }
  ];
  cards.forEach((card) => {
    drawRoundedCell(page, font, card.x, 99, card.w, 55, '', {
      fill: '#62c4ee',
      title: card.title,
      value: card.value,
      titleFontSize: 5.3,
      fontSize: 5,
      lineHeight: 6.2
    });
  });
  drawText(page, font, fixed.missionEn, PAGE.margin + 65, 156, { width: 410, height: 16, fontSize: 5.6, align: 'center' });
  if (language !== 'en') {
    drawText(page, font, fixed.missionZh, PAGE.margin + 62, 173, { width: 416, height: 12, fontSize: 5.6, align: 'center' });
  }
  const info = agenda.meetingInfo || {};
  drawText(page, font, `No. ${info.meetingNo || ''}`, PAGE.margin + 4, 182, { width: 95, height: 10, fontSize: 7.2, bold: true });
  drawText(page, font, `${language === 'en' ? 'Date: ' : '日期：'}${info.date || ''}`, PAGE.margin + 150, 182, { width: 120, height: 10, fontSize: 7.2, bold: true });
  drawText(page, font, `${language === 'en' ? 'Theme: ' : '主题：'}${info.theme || ''}`, PAGE.margin + 278, 182, { width: 245, height: 10, fontSize: 7.2, bold: true });
}

/**
 * 方法是什么：绘制第一页页眉区域外边框。
 * 方法作用：包围俱乐部标题、信息卡、使命文案和会议元数据，并与议程表左右边界对齐。
 * 为什么添加：导出 PDF 的页眉区域需要形成完整线框，明确区分固定信息与下方议程表。
 */
function drawFirstPageHeaderFrame(page, agendaTop) {
  const top = 20;
  const bottom = Number(agendaTop) || 250;
  page.drawRectangle({
    x: PAGE.margin,
    y: topY(top, bottom - top),
    width: PAGE.width - PAGE.margin * 2,
    height: bottom - top,
    borderColor: BORDER,
    borderWidth: 0.6
  });
}

/**
 * 方法是什么：绘制议程表头。
 * 方法作用：保留时间数据列但隐藏时间表头，并输出流程、限时、演讲者和俱乐部标题。
 * 为什么添加：第一页和续页需要复用完全一致的列宽与表头。
 */
function drawAgendaHeader(page, font, y, language, drawRightBoundaryValue) {
  const x = PAGE.margin;
  const widths = [26, 140, 68, 115, 71];
  const headerHeight = 13;
  const labels = language === 'en' ? ['', 'Meeting Facilitators', 'Duration', 'Speaker', 'Club'] : ['', '会议促进者', '限时', '演讲者', '俱乐部'];
  let cursor = x;
  labels.forEach((label, index) => {
    drawCell(page, font, cursor, y, widths[index], headerHeight, label, { fill: '#9bdcf6', align: index === 2 ? 'right' : 'left', fontSize: 7.5, border: false, bold: true, paddingRight: index === 2 ? 10 : 2.5, verticalAlign: 'middle' });
    cursor += widths[index];
  });
  page.drawLine({
    start: { x, y: topY(y + headerHeight, 0) },
    end: { x: x + widths.reduce((total, width) => total + width, 0), y: topY(y + headerHeight, 0) },
    thickness: 0.35,
    color: LIGHT_BORDER
  });
  const drawRightBoundary = drawRightBoundaryValue !== false;
  if (drawRightBoundary) {
    const boundaryX = x + widths.reduce((total, width) => total + width, 0);
    page.drawLine({ start: { x: boundaryX, y: topY(y, headerHeight) }, end: { x: boundaryX, y: topY(y, 0) }, thickness: 0.25, color: BORDER });
  }
  return { x, widths, height: headerHeight, drawRightBoundary };
}

/**
 * 方法是什么：绘制一条议程数据。
 * 方法作用：按节点类型输出标题、项目描述、限时、人员和俱乐部。
 * 为什么添加：预览解析出的连续行必须在 PDF 中保持相同顺序和内容。
 */
function drawAgendaRow(page, font, row, table, y, language, forcedHeight) {
  const height = forcedHeight || getAgendaRowHeight(row, language);
  const tableWidth = table.widths.reduce((total, width) => total + width, 0);
  if (row.type === 'workshopTopic') {
    drawCell(page, font, table.x, y, tableWidth, height, row.topic || row.titleZh || '', {
      fill: '#f3f6f8', border: false, fontSize: 7.2, lineHeight: 8, paddingLeft: 4, verticalAlign: 'middle'
    });
    page.drawLine({ start: { x: table.x, y: topY(y + height, 0) }, end: { x: table.x + tableWidth, y: topY(y + height, 0) }, thickness: 0.25, color: BORDER });
    return height;
  }
  const fill = row.id === 'topicNote' ? '#d8d8d8' : '';
  const duration = row.duration ? `${row.duration} ${language === 'en' ? 'mins' : '分钟'}` : '';
  let title = getLocalizedRoleTitle(row, language);
  let projectName = '';
  let objective = '';
  if (row.type === 'preparedSpeechBlock') {
    const pathway = row.pathway || {};
    const isOtherPathway = Boolean(pathway.isOther || pathway.code === 'OTHER');
    projectName = isOtherPathway ? '' : language === 'en' ? pathway.fullLabelEn || pathway.fullLabelZh : pathway.fullLabelZh;
    objective = language === 'en' ? pathway.objectiveEn || pathway.objectiveZh : pathway.objectiveZh;
  }
  const values = [row.startTime || '', title, duration, getRowPersonName(row, language), row.id === 'topicNote' ? '' : getRowClub(row, language)];
  if (row.type === 'preparedSpeechBlock') {
    const backgroundOverlap = row.firstPreparedSpeech ? 0 : 0.6;
    page.drawRectangle({
      x: table.x,
      y: topY(y - backgroundOverlap, 10 + backgroundOverlap),
      width: tableWidth,
      height: 10 + backgroundOverlap,
      color: hexToRgb('#d8d8d8'),
      borderWidth: 0
    });
  }
  if (row.pdfSectionStart) {
    page.drawLine({
      start: { x: table.x, y: topY(y, 0) },
      end: { x: table.x + tableWidth, y: topY(y, 0) },
      thickness: 0.25,
      color: BORDER
    });
  }
  let cursor = table.x;
  const preparedTitleHeight = 10;
  const topicNoteMerged = language === 'en' && row.id === 'topicNote';
  values.forEach((value, index) => {
    const cellValue = topicNoteMerged && index === 1 ? '' : value;
    const cellHeight = row.type === 'preparedSpeechBlock' ? preparedTitleHeight : height;
    drawCell(page, font, cursor, y, table.widths[index], cellHeight, cellValue, {
      fill,
      border: false,
      fontSize: 7.2,
      lineHeight: 8,
      align: index === 2 ? 'right' : 'left',
      bold: row.isGroup,
      paddingRight: index === 2 ? 10 : 2.5,
      verticalAlign: 'middle'
    });
    cursor += table.widths[index];
  });
  if (topicNoteMerged) {
    const mergedX = table.x + table.widths[0];
    const mergedWidth = table.widths.slice(1, 4).reduce((total, width) => total + width, 0);
    drawCell(page, font, mergedX, y, mergedWidth, height, title, {
      border: false,
      fontSize: 7.2,
      lineHeight: 8,
      verticalAlign: 'middle'
    });
  }
  if (row.type === 'preparedSpeechBlock' && projectName) {
    const projectX = table.x + table.widths[0];
    const projectWidth = table.widths.slice(1, 4).reduce((total, width) => total + width, 0);
    drawCell(page, font, projectX, y + preparedTitleHeight, projectWidth, 9, projectName, {
      border: false,
      fontSize: 6.8,
      lineHeight: 7.5,
      verticalAlign: 'middle'
    });
  }
  if (row.type === 'preparedSpeechBlock' && objective) {
    const objectiveY = y + (projectName ? 19 : 10);
    const objectiveX = table.x + table.widths[0];
    const objectiveWidth = table.widths.slice(1, 4).reduce((total, width) => total + width, 0);
    drawCell(page, font, objectiveX, objectiveY, objectiveWidth, height - (objectiveY - y), objective, {
      fill,
      border: false,
      fontSize: 7.2,
      lineHeight: 8,
      align: 'left',
      verticalAlign: 'middle'
    });
  }
  if (row.firstPreparedSpeech) {
    page.drawLine({
      start: { x: table.x, y: topY(y, 0) },
      end: { x: table.x + tableWidth, y: topY(y, 0) },
      thickness: 0.25,
      color: BORDER
    });
  }
  if (row.pdfSectionStart || row.id === 'end') {
    page.drawLine({
      start: { x: table.x, y: topY(y + height, 0) },
      end: { x: table.x + tableWidth, y: topY(y + height, 0) },
      thickness: 0.25,
      color: BORDER
    });
  }
  if (table.drawRightBoundary !== false) {
    const boundaryX = table.x + tableWidth;
    page.drawLine({ start: { x: boundaryX, y: topY(y, height) }, end: { x: boundaryX, y: topY(y, 0) }, thickness: 0.25, color: BORDER });
  }
  return height;
}

/**
 * 方法是什么：绘制第一页右侧栏。
 * 方法作用：输出上周最佳、价值观、俱乐部介绍和三个二维码。
 * 为什么添加：截图红框外的侧栏属于固定模板，导出时不能继续缺失。
 */
function resolveSidebarWinners(template, agenda) {
  const labels = (template.sidebar && template.sidebar.winners || []).map((winner) => winner.label || '');
  const awards = Object.assign({ preparedSpeech: '', tableTopics: '', role: '', evaluator: '' }, agenda && agenda.bestAwards || {});
  const values = [awards.role, awards.tableTopics, awards.preparedSpeech, awards.evaluator];
  const fallbackLabels = ['Best Meeting Role', 'Best Table Topics', 'Best Prepared', 'Best Evaluator'];
  return values.map((value, index) => ({ label: labels[index] || fallbackLabels[index], value: value || '' }));
}

function drawSidebar(page, font, template, agenda, images, y, height, language) {
  const x = PAGE.margin + 420;
  const width = PAGE.width - PAGE.margin - x;
  const headingHeight = 13;
  const drawHeading = (headingY, label, fontSize, drawTopLine) => {
    drawCell(page, font, x, headingY, width, headingHeight, label, { fill: '#9bdcf6', align: 'center', fontSize, bold: true, border: false });
    if (drawTopLine) {
      page.drawLine({ start: { x, y: topY(headingY, 0) }, end: { x: x + width, y: topY(headingY, 0) }, thickness: 0.25, color: BORDER });
    }
    page.drawLine({ start: { x, y: topY(headingY + headingHeight, 0) }, end: { x: x + width, y: topY(headingY + headingHeight, 0) }, thickness: 0.25, color: BORDER });
  };
  drawHeading(y, language === 'en' ? 'Best Speakers for Last Week' : '上周最佳演讲者', 7.6, false);
  let cursorY = y + headingHeight;
  resolveSidebarWinners(template, agenda).forEach((winner) => {
    drawText(page, font, winner.label, x + 4, cursorY + 3, { width: 65, height: 13, fontSize: 6.2 });
    drawText(page, font, winner.value, x + 70, cursorY + 3, { width: width - 74, height: 13, fontSize: 6.2 });
    cursorY += 19;
  });
  drawHeading(cursorY, language === 'en' ? 'Toastmasters Core Values' : '国际演讲会价值观', 7.8, true);
  cursorY += headingHeight;
  drawText(page, font, template.fixedContent.values, x + 4, cursorY + 5, { width: width - 8, height: 20, fontSize: 6.9, lineHeight: 8.4, align: 'center' });
  cursorY += 28;
  drawHeading(cursorY, language === 'en' ? 'GZ Bilingual Toastmasters Club' : '广州双语国际演讲俱乐部', 7.5, true);
  cursorY += 20;
  drawText(page, font, template.fixedContent.clubIntro, x + 5, cursorY, { width: width - 10, height: 55, fontSize: 6.9, lineHeight: 8.6, align: 'center' });
  cursorY += 62;
  const qrData = [
    ['membershipQr', language === 'en' ? 'Vice President of Membership' : '会员副会长'],
    ['officialQr', language === 'en' ? 'Official Account' : '公众号'],
    ['meetingGroupQr', language === 'en' ? 'Meeting Group' : '例会群']
  ];
  qrData.forEach((item) => {
    drawImageFit(page, images[item[0]], x + 37, cursorY, 58, 58);
    drawText(page, font, item[1], x + 10, cursorY + 59, { width: width - 20, height: 9, fontSize: 6.4, align: 'center' });
    cursorY += 79;
  });
}

/**
 * 方法是什么：绘制第一页计时规则。
 * 方法作用：在议程表下方输出绿卡、黄卡、红卡和鼓掌表格。
 * 为什么添加：计时提示是源模板第一页的固定使用信息。
 */
function drawTimerRules(page, font, template, language) {
  const titleY = 711;
  drawText(page, font, language === 'en' ? 'Timing Rules (Please EFFECTIVELY Use Your LIMITED Stage Time)' : '计时规则（请有效利用你在台上有限的时间）', PAGE.margin, titleY - 1, { width: PAGE.width - PAGE.margin * 2, height: 11, fontSize: 8.2, align: 'center', bold: true });
  const rows = template.timerRules || [];
  const widths = [132, 91, 91, 91, 91];
  const headerColors = ['#d0d0d0', '#008000', '#ffff00', '#ff0000', '#8c8c8c'];
  const bodyColors = ['#f2f2f2', '#c4f5c9', '#fffac4', '#ff7b7b', '#c2c2c2'];
  rows.forEach((row, rowIndex) => {
    let x = PAGE.margin + 24;
    row.forEach((cell, index) => {
      drawCell(page, font, x, titleY + 11 + rowIndex * 11, widths[index], 11, cell, {
        fill: rowIndex === 0 ? headerColors[index] : bodyColors[index],
        align: 'center',
        fontSize: 6.2,
        border: false,
        bold: rowIndex === 0,
        color: rowIndex === 0 && (index === 1 || index === 3) ? rgb(1, 1, 1) : BLACK
      });
      x += widths[index];
    });
  });
}

/**
 * 方法是什么：绘制第一页和议程续页。
 * 方法作用：在固定可用高度内绘制行，溢出时自动插入无裁切续页。
 * 为什么添加：备稿块可多次添加，不能通过压缩到不可读或覆盖计时区解决溢出。
 */
function drawAgendaPages(pdfDoc, font, template, agenda, images) {
  const language = agendaModel.normalizeLanguage(agenda.meetingInfo && agenda.meetingInfo.language);
  const sectionStartIds = new Set((agenda.sections || []).map((section) => section.type === 'row' && section.row ? section.row.id : section.id));
  let preparedSpeechSeen = false;
  const rows = agendaModel.flattenAgendaRows(agenda).map((row) => {
    const firstPreparedSpeech = row.type === 'preparedSpeechBlock' && !preparedSpeechSeen;
    if (row.type === 'preparedSpeechBlock') {
      preparedSpeechSeen = true;
    }
    return Object.assign({}, row, {
      firstPreparedSpeech,
      pdfSectionStart: row.type !== 'preparedSpeechBlock' && sectionStartIds.has(row.id)
    });
  });
  const firstPage = pdfDoc.addPage([PAGE.width, PAGE.height]);
  drawFirstPageHeader(firstPage, font, template, agenda, images, language);
  let page = firstPage;
  const agendaTop = 195;
  const agendaBottom = 697;
  let y = agendaTop;
  let table = drawAgendaHeader(page, font, y, language, false);
  y += table.height;
  drawSidebar(firstPage, font, template, agenda, images, agendaTop, agendaBottom - agendaTop, language);
  const sharedBoundaryX = PAGE.margin + table.widths.reduce((sum, width) => sum + width, 0);
  const baseHeights = rows.map((row) => getAgendaRowHeight(row, language));
  const availableFirstPageHeight = agendaBottom - y;
  const totalBaseHeight = baseHeights.reduce((sum, height) => sum + height, 0);
  const stretchPerRow = rows.length && totalBaseHeight <= availableFirstPageHeight
    ? (availableFirstPageHeight - totalBaseHeight) / rows.length
    : 0;
  for (let index = 0; index < rows.length; index += 1) {
    const height = baseHeights[index] + stretchPerRow;
    if (y + height > agendaBottom + 0.01) {
      page = pdfDoc.addPage([PAGE.width, PAGE.height]);
      drawText(page, font, `${template.fixedContent.clubTitle} - ${language === 'en' ? 'Agenda Continued' : '议程续页'}`, PAGE.margin, 22, { width: PAGE.width - PAGE.margin * 2, height: 18, fontSize: 11, align: 'center' });
      y = 48;
      table = drawAgendaHeader(page, font, y, language);
      y += table.height;
    }
    y += drawAgendaRow(page, font, rows[index], table, y, language, height);
  }
  drawTimerRules(firstPage, font, template, language);
  firstPage.drawLine({ start: { x: PAGE.margin, y: topY(agendaTop, 0) }, end: { x: PAGE.width - PAGE.margin, y: topY(agendaTop, 0) }, thickness: 0.25, color: BORDER });
  firstPage.drawLine({ start: { x: sharedBoundaryX, y: topY(agendaBottom, 0) }, end: { x: sharedBoundaryX, y: topY(agendaTop, 0) }, thickness: 0.25, color: BORDER });
  firstPage.drawRectangle({ x: 0, y: 0, width: PAGE.width, height: 70, color: rgb(1, 1, 1), borderWidth: 0 });
  drawFirstPageHeaderFrame(firstPage, 760);
}

/**
 * 方法是什么：用 PDF 基础图形绘制头马教育晋级路径。
 * 方法作用：直接输出新会员、俱乐部成长、DTM 项目和杰出会员之间的流程关系。
 * 为什么添加：教育流程需要保持清晰可缩放，不能继续依赖固定截图素材。
 */
function drawEducationPathDiagram(page, font, x, y) {
  const blue = hexToRgb('#4472c4');
  const purple = hexToRgb('#7030a0');
  const paleBlue = hexToRgb('#dbe8f5');
  const paleGray = hexToRgb('#e5e7eb');
  const white = rgb(1, 1, 1);
  page.drawRectangle({ x: x + 48, y: topY(y, 68), width: 104, height: 68, color: paleBlue, borderColor: LIGHT_BORDER, borderWidth: 0.25 });
  page.drawSvgPath('M 0 0 L 35 0 L 44 9 L 35 18 L 0 18 Z', { x, y: PAGE.height - y - 25, color: paleGray, borderColor: LIGHT_BORDER, borderWidth: 0.25 });
  drawText(page, font, '新会员\nNew Member', x + 2, y + 27, { width: 36, height: 16, fontSize: 4.1, lineHeight: 4.8, align: 'center', verticalAlign: 'middle' });
  const boxes = [
    { x: 52, y: 3, w: 46, h: 13, text: '俱乐部官员\nClub Officer' },
    { x: 102, y: 3, w: 46, h: 13, text: '大区官员\nDistrict Officer' },
    { x: 52, y: 19, w: 96, h: 12, text: '俱乐部导师 / 俱乐部教练\nClub Mentor / Club Coach' },
    { x: 52, y: 34, w: 96, h: 18, text: '俱乐部发起人 / 演讲训练营 /\n青年领导项目' },
    { x: 52, y: 55, w: 96, h: 10, text: '路径1 + 路径2  Pathway 1 + Pathway 2' }
  ];
  boxes.forEach((box) => {
    page.drawRectangle({ x: x + box.x, y: topY(y + box.y, box.h), width: box.w, height: box.h, color: blue });
    drawText(page, font, box.text, x + box.x + 2, y + box.y + 1, { width: box.w - 4, height: box.h - 2, fontSize: 3.9, lineHeight: 4.5, align: 'center', color: white, verticalAlign: 'middle' });
  });
  page.drawSvgPath('M 0 0 L 19 7 L 19 29 L 0 36 Z', { x: x + 153, y: PAGE.height - y - 17, color: purple });
  drawText(page, font, '杰出会员项目\nDTM Project', x + 153, y + 23, { width: 18, height: 24, fontSize: 3.9, lineHeight: 4.6, align: 'center', color: white, verticalAlign: 'middle' });
  page.drawEllipse({ x: x + 184, y: PAGE.height - y - 36, xScale: 12, yScale: 12, color: purple });
  drawText(page, font, '杰出会员\nDTM', x + 172, y + 26, { width: 24, height: 20, fontSize: 4.3, lineHeight: 5.1, align: 'center', color: white, verticalAlign: 'middle' });
}

/**
 * 方法是什么：补充干事职位的完整英文名称。
 * 方法作用：在职位独立行中展示缩写和全称，姓名与联系方式留到下一行。
 * 为什么添加：两行干事表需要比旧版合并字段提供更完整的职位信息。
 */
function expandOfficerRole(role) {
  const expansions = {
    VPE: 'Vice President Education', VPM: 'Vice President Membership', VPPR: 'Vice President Public Relations',
    SAA: 'Sergeant At Arms', IPP: 'Immediate Past President'
  };
  const value = String(role || '');
  const key = Object.keys(expansions).find((item) => new RegExp(`\\b${item}\\b`).test(value));
  return key ? `${value} (${expansions[key]})` : value;
}

/**
 * 方法是什么：绘制第二页俱乐部固定资料。
 * 方法作用：复刻双语动态、教育体系、成就、入会说明、干事表和资源页脚。
 * 为什么添加：原模板第二页属于完整 PDF 交付物且全部由超管维护。
 */
function drawClubInfoPage(pdfDoc, font, template, images) {
  const language = template.activeLanguage === 'en' ? 'en' : 'zh';
  const page = pdfDoc.addPage([PAGE.width, PAGE.height]);
  const drawPage2Cell = (x, y, width, height, text, options) => drawCell(page, font, x, y, width, height, text, Object.assign({}, options, { border: false }));
  const leftX = PAGE.margin;
  const leftW = 185;
  const rightX = leftX + leftW;
  const rightW = PAGE.width - PAGE.margin - rightX;
  const top = 120;
  const bodyBottom = 704;
  drawPage2Cell(leftX, top, leftW, 16, template.page2.updatesTitle, { fill: '#c9fbff', align: 'center', fontSize: 8.5 });
  drawPage2Cell(rightX, top, rightW, 16, template.page2.educationTitle, { fill: '#c9fbff', align: 'center', fontSize: 8.5 });
  drawPage2Cell(leftX, top + 16, leftW, 34, '', {});
  drawPage2Cell(leftX, top + 50, leftW, 16, template.page2.notesTitle, { fill: '#c9fbff', align: 'center', fontSize: 8.5 });
  page.drawLine({ start: { x: rightX, y: topY(top, 0) }, end: { x: rightX, y: topY(top + 16, 0) }, thickness: 0.45, color: BORDER });
  page.drawLine({ start: { x: leftX, y: topY(top + 50, 0) }, end: { x: rightX, y: topY(top + 50, 0) }, thickness: 0.45, color: BORDER });
  page.drawLine({ start: { x: leftX, y: topY(bodyBottom, 0) }, end: { x: leftX, y: topY(top + 66, 0) }, thickness: 0.45, color: BORDER });
  drawPage2Cell(rightX, top + 16, rightW, 14, language === 'en' ? 'Education Path' : '教育路径', { fill: '#d1d5db', align: 'center', fontSize: 7.4 });
  const educationY = top + 30;
  drawText(page, font, (template.page2.pathways || []).map((item, index) => `${index + 1}. ${item}`).join('\n'), rightX + 8, educationY + 7, { width: 135, height: 70, fontSize: 8, lineHeight: 10.2 });
  drawEducationPathDiagram(page, font, rightX + 153, educationY + 5);
  drawPage2Cell(rightX, educationY + 82, rightW, 13, template.page2.goal, { fill: '#e5e1f0', align: 'center', fontSize: 7.5 });
  page.drawLine({ start: { x: rightX, y: topY(educationY + 82, 0) }, end: { x: rightX + rightW, y: topY(educationY + 82, 0) }, thickness: 0.6, color: BORDER });
  page.drawLine({ start: { x: rightX, y: topY(educationY + 95, 0) }, end: { x: rightX + rightW, y: topY(educationY + 95, 0) }, thickness: 0.6, color: BORDER });
  const half = rightW / 2;
  let y = educationY + 95;
  drawPage2Cell(rightX, y, half, 13, language === 'en' ? 'Bilingual Achievements' : '双语成就', { fill: '#d1d5db', align: 'center', fontSize: 7.4 });
  drawPage2Cell(rightX + half, y, half, 13, language === 'en' ? 'Meeting Procedure' : '会议流程', { fill: '#d1d5db', align: 'center', fontSize: 7.4 });
  y += 13;
  const achievementsHeight = 72;
  const benefitsHeight = 105;
  drawPage2Cell(rightX, y, half, achievementsHeight, (template.page2.achievements || []).join('\n'), { align: 'center', fontSize: 7.4, lineHeight: 9.8, verticalAlign: 'middle' });
  drawPage2Cell(rightX + half, y, half, achievementsHeight, (template.page2.meetingFlow || []).join('\n'), { align: 'center', fontSize: 7.4, lineHeight: 10.2, verticalAlign: 'middle' });
  y += achievementsHeight;
  drawPage2Cell(rightX, y, half, 13, language === 'en' ? 'What can Iachieve in Toastmasters?' : '我们在头马可以收获什么？', { fill: '#d1d5db', align: 'center', fontSize: 7.1 });
  drawPage2Cell(rightX + half, y, half, 13, language === 'en' ? 'How to Join Us' : '如何加入我们', { fill: '#d1d5db', align: 'center', fontSize: 7.1 });
  y += 13;
  drawPage2Cell(rightX, y, half, benefitsHeight, (template.page2.benefits || []).join('\n'), { align: 'center', fontSize: 7.2, lineHeight: 10.3, verticalAlign: 'middle' });
  drawPage2Cell(rightX + half, y, half, benefitsHeight, template.page2.joining, { fontSize: 6.9, lineHeight: 9.3, verticalAlign: 'middle' });
  y += benefitsHeight;
  const officerTop = y;
  drawPage2Cell(rightX, y, rightW, 14, '俱乐部干事 Club Officer Team', { fill: '#9bdcf6', align: 'center', fontSize: 7.5, bold: true });
  y += 14;
  const officerWidths = [rightW * 0.47, rightW * 0.25, rightW * 0.28];
  (['干事 Officer', '电话 Phone', '微信 WeChat']).forEach((label, index) => {
    const x = rightX + officerWidths.slice(0, index).reduce((sum, value) => sum + value, 0);
    drawPage2Cell(x, y, officerWidths[index], 12, label, { fill: '#e2e8f0', align: index === 0 ? 'left' : 'center', fontSize: 6.4, paddingLeft: index === 0 ? 35 : 2.5 });
  });
  y += 12;
  const officerHeaderBottom = y;
  (template.page2.officers || []).forEach((officer, officerIndex) => {
    drawPage2Cell(rightX, y, rightW, 15.625, expandOfficerRole(officer.role), { fill: '#d7ffff', fontSize: 6.9, verticalAlign: 'middle' });
    y += 15.625;
    const values = [officer.name, officer.phone, officer.wechat];
    values.forEach((value, index) => {
      const x = rightX + officerWidths.slice(0, index).reduce((sum, width) => sum + width, 0);
      drawPage2Cell(x, y, officerWidths[index], 15.625, value, { fill: '#ffffff', fontSize: 6.9, align: index === 0 ? 'left' : 'center', paddingLeft: index === 0 ? 35 : 2.5, verticalAlign: 'middle' });
    });
    y += 15.625;
    page.drawLine({ start: { x: rightX, y: topY(y, 0) }, end: { x: rightX + rightW, y: topY(y, 0) }, thickness: 0.45, color: BORDER });
  });
  const officerBottom = y;
  page.drawRectangle({ x: rightX, y: topY(officerTop, officerBottom - officerTop), width: rightW, height: officerBottom - officerTop, borderColor: BORDER, borderWidth: 0.6 });
  page.drawLine({ start: { x: rightX, y: topY(officerHeaderBottom, 0) }, end: { x: rightX + rightW, y: topY(officerHeaderBottom, 0) }, thickness: 0.45, color: BORDER });
  const resourcesTop = 724;
  page.drawLine({ start: { x: PAGE.margin, y: topY(resourcesTop, 0) }, end: { x: PAGE.width - PAGE.margin, y: topY(resourcesTop, 0) }, thickness: 0.6, color: BORDER });
  drawText(page, font, template.page2.resources, PAGE.margin + 10, resourcesTop + 7, { width: PAGE.width - PAGE.margin * 2 - 20, height: 10, fontSize: 6.9, align: 'center', verticalAlign: 'middle' });
  drawText(page, font, 'Recommended Resources: Toastmasters International - http://www.toastmasters.org    District 118 Official Account - Toastmasters D118', PAGE.margin + 10, resourcesTop + 20, { width: PAGE.width - PAGE.margin * 2 - 20, height: 10, fontSize: 6.7, align: 'center', verticalAlign: 'middle' });
  page.drawLine({ start: { x: rightX, y: topY(resourcesTop, 0) }, end: { x: rightX, y: topY(top + 16, 0) }, thickness: 0.45, color: BORDER });
  page.drawRectangle({ x: PAGE.margin, y: topY(top, 640), width: PAGE.width - PAGE.margin * 2, height: 640, borderColor: BORDER, borderWidth: 0.6 });
}

/**
 * 方法是什么：生成完整议程 PDF。
 * 方法作用：规范化 AgendaV2，绘制第一页、必要续页和固定俱乐部资料页。
 * 为什么添加：导出必须由当前全局模板驱动并确保任意备稿数量不会裁切。
 */
async function renderAgendaPdf(agendaValue, language, templateValue) {
  const agendaLanguage = agendaModel.normalizeLanguage(language || agendaValue && agendaValue.meetingInfo && agendaValue.meetingInfo.language);
  const fullTemplate = agendaModel.normalizeTemplate(templateValue);
  const template = agendaModel.resolveTemplateLocale(fullTemplate, agendaLanguage);
  const agenda = agendaModel.normalizeAgenda(agendaValue, fullTemplate);
  const pdfDoc = await PDFDocument.create();
  const font = await embedAgendaFont(pdfDoc);
  const images = await embedTemplateImages(pdfDoc, template, agenda);
  drawAgendaPages(pdfDoc, font, template, agenda, images);
  drawClubInfoPage(pdfDoc, font, template, images);
  return Buffer.from(await pdfDoc.save());
}

module.exports = {
  getLocalizedRoleTitle,
  hexToRgb,
  resolveFontPath,
  embedAgendaFont,
  topY,
  wrapText,
  drawText,
  drawCell,
  drawRoundedCell,
  getAssetBytes,
  embedTemplateImages,
  drawImageFit,
  drawFirstPageHeaderFrame,
  formatPersonName,
  getRowPersonName,
  getRowClub,
  getAgendaRowHeight,
  drawFirstPageHeader,
  drawAgendaHeader,
  drawAgendaRow,
  resolveSidebarWinners,
  drawSidebar,
  drawTimerRules,
  drawAgendaPages,
  drawClubInfoPage,
  renderAgendaPdf
};
