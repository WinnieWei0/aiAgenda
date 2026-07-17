const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const agendaModel = require('./agenda-model');

const PAGE = { width: 595.28, height: 841.89, margin: 26 };
const BLACK = rgb(0.05, 0.05, 0.05);
const BORDER = rgb(0.12, 0.12, 0.12);

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
  const candidates = [process.env.PDF_FONT_PATH, path.join(__dirname, 'fonts', 'NotoSansSC-Regular.ttf')];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || '';
}

/**
 * 方法是什么：嵌入议程中文字体。
 * 方法作用：注册 fontkit 并返回支持中英文的子集字体。
 * 为什么添加：默认 PDF 字体无法正确绘制中文模板内容。
 */
async function embedAgendaFont(pdfDoc) {
  const fontPath = resolveFontPath();
  if (!fontPath) {
    throw new Error('缺少中文字体 common/fonts/NotoSansSC-Regular.ttf');
  }
  pdfDoc.registerFontkit(fontkit);
  return pdfDoc.embedFont(fs.readFileSync(fontPath), { subset: true });
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
    let current = '';
    for (const char of paragraph) {
      const next = current + char;
      if (!current || font.widthOfTextAtSize(next, fontSize) <= maxWidth) {
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
  const lines = wrapText(text, font, fontSize, width);
  let cursorY = topY(y, height) + height - fontSize - 1;
  for (const line of lines) {
    if (cursorY < topY(y, height)) {
      break;
    }
    const lineWidth = font.widthOfTextAtSize(line, fontSize);
    const offset = opts.align === 'center' ? Math.max((width - lineWidth) / 2, 0) : opts.align === 'right' ? Math.max(width - lineWidth, 0) : 0;
    page.drawText(line, { x: x + offset, y: cursorY, size: fontSize, font, color: opts.color || BLACK });
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
  page.drawRectangle({
    x,
    y: topY(y, height),
    width,
    height,
    color: opts.fill ? hexToRgb(opts.fill) : undefined,
    borderColor: opts.border === false ? undefined : BORDER,
    borderWidth: opts.border === false ? 0 : 0.45
  });
  drawText(page, font, text, x + 2.5, y + 1, {
    width: width - 5,
    height: height - 2,
    fontSize: opts.fontSize || 6.5,
    lineHeight: opts.lineHeight,
    align: opts.align || 'left',
    color: opts.color || BLACK
  });
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
function getRowPersonName(row) {
  if (row.type === 'preparedSpeechBlock') {
    return row.speaker && (row.speaker.displayNameZh || row.speaker.rawName) || '';
  }
  if (Array.isArray(row.persons) && row.persons.length) {
    return row.persons.map((person) => person.displayNameZh || person.rawName).filter(Boolean).join(' && ');
  }
  return row.person && (row.person.displayNameZh || row.person.rawName) || '';
}

/**
 * 方法是什么：读取人员俱乐部。
 * 方法作用：按行级固定俱乐部、备稿演讲者或普通人员顺序选择显示值。
 * 为什么添加：中场休息、会员选择和手输来宾使用不同俱乐部来源。
 */
function getRowClub(row) {
  if (row.clubZh) {
    return row.clubZh;
  }
  if (row.type === 'preparedSpeechBlock') {
    return row.speaker && row.speaker.clubZh || '';
  }
  return row.person && row.person.clubZh || '';
}

/**
 * 方法是什么：计算议程 PDF 行高。
 * 方法作用：为大模块、说明行、普通行和备稿项目分配不同高度。
 * 为什么添加：固定第一页必须尽量紧凑，同时保证项目描述可读且不重叠。
 */
function getAgendaRowHeight(row) {
  if (row.type === 'preparedSpeechBlock') {
    const objective = row.pathway && row.pathway.objectiveZh || '';
    return objective.length > 42 ? 38 : 31;
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
function drawFirstPageHeader(page, font, template, agenda, images) {
  const fixed = template.fixedContent;
  drawText(page, font, fixed.clubTitle, PAGE.margin + 65, 24, { width: 410, height: 22, fontSize: 15, align: 'center' });
  drawText(page, font, fixed.clubSubtitle, PAGE.margin + 80, 48, { width: 380, height: 18, fontSize: 12.5, align: 'center' });
  drawText(page, font, fixed.charter, 493, 25, { width: 72, height: 38, fontSize: 4.8, align: 'right' });
  drawImageFit(page, images.logo, PAGE.margin + 4, 76, 47, 49);
  const cards = [
    { x: PAGE.margin + 55, w: 100, title: '会议时间 Time', value: fixed.meetingTime },
    { x: PAGE.margin + 159, w: 132, title: '会议地址 Venue', value: fixed.venue },
    { x: PAGE.margin + 295, w: 132, title: '费用说明 Fees', value: fixed.fees },
    { x: PAGE.margin + 431, w: 112, title: '禁忌话题 Taboo Topics', value: fixed.tabooTopics }
  ];
  cards.forEach((card) => {
    drawCell(page, font, card.x, 72, card.w, 57, `${card.title}\n${card.value}`, { fill: '#62c4ee', fontSize: 4.5, lineHeight: 5.5 });
  });
  drawText(page, font, fixed.missionEn, PAGE.margin + 65, 133, { width: 410, height: 16, fontSize: 5.6, align: 'center' });
  drawText(page, font, fixed.missionZh, PAGE.margin + 62, 150, { width: 416, height: 12, fontSize: 5.6, align: 'center' });
  const info = agenda.meetingInfo || {};
  drawText(page, font, `No. ${info.meetingNo || ''}`, PAGE.margin + 4, 164, { width: 95, height: 10, fontSize: 6.5 });
  drawText(page, font, `日期：${info.date || ''}`, PAGE.margin + 150, 164, { width: 120, height: 10, fontSize: 6.5 });
  drawText(page, font, `主题：${info.theme || ''}`, PAGE.margin + 278, 164, { width: 245, height: 10, fontSize: 6.5 });
}

/**
 * 方法是什么：绘制议程表头。
 * 方法作用：输出时间、流程、限时、演讲者和俱乐部五列。
 * 为什么添加：第一页和续页需要复用完全一致的列宽与表头。
 */
function drawAgendaHeader(page, font, y) {
  const x = PAGE.margin;
  const widths = [42, 190, 45, 85, 48];
  const labels = ['时间', '会议促进者', '限时', '演讲者', '俱乐部'];
  let cursor = x;
  labels.forEach((label, index) => {
    drawCell(page, font, cursor, y, widths[index], 11, label, { fill: '#9bdcf6', align: 'center', fontSize: 6.2 });
    cursor += widths[index];
  });
  return { x, widths, height: 11 };
}

/**
 * 方法是什么：绘制一条议程数据。
 * 方法作用：按节点类型输出标题、项目描述、限时、人员和俱乐部。
 * 为什么添加：预览解析出的连续行必须在 PDF 中保持相同顺序和内容。
 */
function drawAgendaRow(page, font, row, table, y) {
  const height = getAgendaRowHeight(row);
  const fill = row.type === 'note' ? '#d1d5db' : row.isGroup ? '#f3f4f6' : row.type === 'preparedSpeechBlock' ? '#e5e7eb' : '';
  const duration = row.duration ? `${row.duration} 分钟` : '';
  let title = row.titleZh || '';
  if (row.type === 'preparedSpeechBlock') {
    const pathway = row.pathway || {};
    title = [title, pathway.fullLabelZh, pathway.objectiveZh].filter(Boolean).join('\n');
  }
  const values = [row.startTime || '', title, duration, getRowPersonName(row), getRowClub(row)];
  let cursor = table.x;
  values.forEach((value, index) => {
    drawCell(page, font, cursor, y, table.widths[index], height, value, {
      fill,
      fontSize: row.type === 'preparedSpeechBlock' && index === 1 ? 5.4 : 5.8,
      lineHeight: 6.4,
      align: index === 2 ? 'right' : 'left'
    });
    cursor += table.widths[index];
  });
  return height;
}

/**
 * 方法是什么：绘制第一页右侧栏。
 * 方法作用：输出上周最佳、价值观、俱乐部介绍和三个二维码。
 * 为什么添加：截图红框外的侧栏属于固定模板，导出时不能继续缺失。
 */
function drawSidebar(page, font, template, images, y, height) {
  const x = PAGE.margin + 410;
  const width = PAGE.width - PAGE.margin - x;
  drawCell(page, font, x, y, width, 12, '上周最佳演讲者', { fill: '#9bdcf6', align: 'center', fontSize: 6.4 });
  let cursorY = y + 12;
  (template.sidebar.winners || []).forEach((winner) => {
    drawText(page, font, winner.label, x + 4, cursorY + 3, { width: 72, height: 13, fontSize: 5.2 });
    drawText(page, font, winner.value, x + 78, cursorY + 3, { width: width - 82, height: 13, fontSize: 5.2 });
    cursorY += 19;
  });
  drawCell(page, font, x, cursorY, width, 12, '国际演讲会价值观', { fill: '#9bdcf6', align: 'center', fontSize: 6.4 });
  cursorY += 12;
  drawText(page, font, template.fixedContent.values, x + 4, cursorY + 5, { width: width - 8, height: 18, fontSize: 5.5, align: 'center' });
  cursorY += 25;
  drawCell(page, font, x, cursorY, width, 12, '广州双语国际演讲俱乐部', { fill: '#9bdcf6', align: 'center', fontSize: 6.2 });
  cursorY += 14;
  drawText(page, font, template.fixedContent.clubIntro, x + 5, cursorY, { width: width - 10, height: 55, fontSize: 5.5, lineHeight: 6.8, align: 'center' });
  cursorY += 58;
  const qrData = [
    ['membershipQr', '会员副会长'],
    ['officialQr', '公众号'],
    ['meetingGroupQr', '例会群']
  ];
  qrData.forEach((item) => {
    drawImageFit(page, images[item[0]], x + 37, cursorY, 58, 58);
    drawText(page, font, item[1], x + 10, cursorY + 59, { width: width - 20, height: 9, fontSize: 5.5, align: 'center' });
    cursorY += 79;
  });
  page.drawRectangle({ x, y: topY(y, height), width, height, borderColor: BORDER, borderWidth: 0.45 });
}

/**
 * 方法是什么：绘制第一页计时规则。
 * 方法作用：在议程表下方输出绿卡、黄卡、红卡和鼓掌表格。
 * 为什么添加：计时提示是源模板第一页的固定使用信息。
 */
function drawTimerRules(page, font, template) {
  const titleY = 771;
  drawText(page, font, '计时规则（请有效利用你在台上有限的时间）', PAGE.margin, titleY, { width: PAGE.width - PAGE.margin * 2, height: 10, fontSize: 6.8, align: 'center' });
  const rows = template.timerRules || [];
  const widths = [132, 91, 91, 91, 91];
  const colors = ['#e5e7eb', '#b8f5c0', '#fff58a', '#ff7777', '#b5b5b5'];
  rows.forEach((row, rowIndex) => {
    let x = PAGE.margin + 24;
    row.forEach((cell, index) => {
      drawCell(page, font, x, titleY + 11 + rowIndex * 11, widths[index], 11, cell, { fill: colors[index], align: 'center', fontSize: 5.6 });
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
  const rows = agendaModel.flattenAgendaRows(agenda);
  const firstPage = pdfDoc.addPage([PAGE.width, PAGE.height]);
  drawFirstPageHeader(firstPage, font, template, agenda, images);
  let page = firstPage;
  let y = 176;
  let table = drawAgendaHeader(page, font, y);
  y += table.height;
  drawSidebar(firstPage, font, template, images, 176, 575);
  for (let index = 0; index < rows.length; index += 1) {
    const height = getAgendaRowHeight(rows[index]);
    if (y + height > 751) {
      page = pdfDoc.addPage([PAGE.width, PAGE.height]);
      drawText(page, font, `${template.fixedContent.clubTitle} - 议程续页`, PAGE.margin, 22, { width: PAGE.width - PAGE.margin * 2, height: 18, fontSize: 11, align: 'center' });
      y = 48;
      table = drawAgendaHeader(page, font, y);
      y += table.height;
    }
    y += drawAgendaRow(page, font, rows[index], table, y);
  }
  drawTimerRules(firstPage, font, template);
}

/**
 * 方法是什么：绘制第二页俱乐部固定资料。
 * 方法作用：复刻双语动态、教育体系、成就、入会说明、干事表和资源页脚。
 * 为什么添加：原模板第二页属于完整 PDF 交付物且全部由超管维护。
 */
function drawClubInfoPage(pdfDoc, font, template, images) {
  const page = pdfDoc.addPage([PAGE.width, PAGE.height]);
  const leftX = PAGE.margin;
  const leftW = 185;
  const rightX = leftX + leftW;
  const rightW = PAGE.width - PAGE.margin - rightX;
  const top = 112;
  drawCell(page, font, leftX, top, leftW, 16, template.page2.updatesTitle, { fill: '#c9fbff', align: 'center', fontSize: 7.5 });
  drawCell(page, font, rightX, top, rightW, 16, template.page2.educationTitle, { fill: '#c9fbff', align: 'center', fontSize: 7.5 });
  drawCell(page, font, leftX, top + 16, leftW, 34, '', {});
  drawCell(page, font, leftX, top + 50, leftW, 16, template.page2.notesTitle, { fill: '#c9fbff', align: 'center', fontSize: 7.5 });
  page.drawRectangle({ x: leftX, y: topY(top + 66, 560), width: leftW, height: 560, borderColor: BORDER, borderWidth: 0.45 });
  const educationY = top + 16;
  drawText(page, font, (template.page2.pathways || []).map((item, index) => `${index + 1}. ${item}`).join('\n'), rightX + 8, educationY + 8, { width: 135, height: 82, fontSize: 6.5, lineHeight: 9 });
  drawImageFit(page, images.educationSystem, rightX + 145, educationY + 4, rightW - 150, 86);
  drawCell(page, font, rightX, educationY + 92, rightW, 13, template.page2.goal, { fill: '#e5e1f0', align: 'center', fontSize: 6.5 });
  const half = rightW / 2;
  let y = educationY + 105;
  drawCell(page, font, rightX, y, half, 13, '双语成就', { fill: '#d1d5db', align: 'center', fontSize: 6.5 });
  drawCell(page, font, rightX + half, y, half, 13, '会议流程', { fill: '#d1d5db', align: 'center', fontSize: 6.5 });
  y += 13;
  drawCell(page, font, rightX, y, half, 105, (template.page2.achievements || []).join('\n'), { align: 'center', fontSize: 5.7, lineHeight: 8 });
  drawCell(page, font, rightX + half, y, half, 105, (template.page2.meetingFlow || []).join('\n'), { align: 'center', fontSize: 5.7, lineHeight: 9 });
  y += 105;
  drawCell(page, font, rightX, y, half, 13, '我们在头马可以收获什么？', { fill: '#d1d5db', align: 'center', fontSize: 6.2 });
  drawCell(page, font, rightX + half, y, half, 13, '如何加入我们', { fill: '#d1d5db', align: 'center', fontSize: 6.2 });
  y += 13;
  drawCell(page, font, rightX, y, half, 128, (template.page2.benefits || []).join('\n'), { align: 'center', fontSize: 5.5, lineHeight: 9 });
  drawCell(page, font, rightX + half, y, half, 128, template.page2.joining, { fontSize: 5.2, lineHeight: 7.5 });
  y += 128;
  drawCell(page, font, rightX, y, rightW, 14, '2026年（上）俱乐部干事 Club Officer Team', { fill: '#9bdcf6', align: 'center', fontSize: 6.5 });
  y += 14;
  const officerWidths = [rightW * 0.47, rightW * 0.25, rightW * 0.28];
  ['干事 Officer', '电话 Phone', '微信 WeChat'].forEach((label, index) => {
    const x = rightX + officerWidths.slice(0, index).reduce((sum, value) => sum + value, 0);
    drawCell(page, font, x, y, officerWidths[index], 12, label, { fill: '#e2e8f0', align: 'center', fontSize: 5.5 });
  });
  y += 12;
  (template.page2.officers || []).forEach((officer, officerIndex) => {
    const values = [`${officer.role}  ${officer.name}`, officer.phone, officer.wechat];
    values.forEach((value, index) => {
      const x = rightX + officerWidths.slice(0, index).reduce((sum, width) => sum + width, 0);
      drawCell(page, font, x, y, officerWidths[index], 13, value, { fill: officerIndex % 2 ? '#ffffff' : '#d7ffff', fontSize: 5.1 });
    });
    y += 13;
  });
  drawText(page, font, template.page2.resources, PAGE.margin, 780, { width: PAGE.width - PAGE.margin * 2, height: 24, fontSize: 5.3, align: 'center' });
}

/**
 * 方法是什么：生成完整议程 PDF。
 * 方法作用：规范化 AgendaV2，绘制第一页、必要续页和固定俱乐部资料页。
 * 为什么添加：导出必须由当前全局模板驱动并确保任意备稿数量不会裁切。
 */
async function renderAgendaPdf(agendaValue, language, templateValue) {
  const template = Object.assign(agendaModel.createDefaultTemplate(), templateValue || {});
  template.fixedContent = Object.assign({}, agendaModel.createDefaultTemplate().fixedContent, templateValue && templateValue.fixedContent || {});
  template.page2 = Object.assign({}, agendaModel.createDefaultTemplate().page2, templateValue && templateValue.page2 || {});
  const agenda = agendaModel.normalizeAgenda(agendaValue, template);
  const pdfDoc = await PDFDocument.create();
  const font = await embedAgendaFont(pdfDoc);
  const images = await embedTemplateImages(pdfDoc, template, agenda);
  drawAgendaPages(pdfDoc, font, template, agenda, images);
  drawClubInfoPage(pdfDoc, font, template, images);
  return Buffer.from(await pdfDoc.save());
}

module.exports = {
  hexToRgb,
  resolveFontPath,
  embedAgendaFont,
  topY,
  wrapText,
  drawText,
  drawCell,
  getAssetBytes,
  embedTemplateImages,
  drawImageFit,
  getRowPersonName,
  getRowClub,
  getAgendaRowHeight,
  drawFirstPageHeader,
  drawAgendaHeader,
  drawAgendaRow,
  drawSidebar,
  drawTimerRules,
  drawAgendaPages,
  drawClubInfoPage,
  renderAgendaPdf
};
