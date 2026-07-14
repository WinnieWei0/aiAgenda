const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

const PAGE = { width: 595.28, height: 841.89, margin: 28 };
const BLACK = rgb(0.07, 0.07, 0.07);
const BORDER = rgb(0.13, 0.13, 0.13);

/**
 * 方法是什么：把十六进制颜色转换为 pdf-lib 的 RGB 颜色。
 * 方法作用：让表格背景色可以继续使用网页常见的 `#RRGGBB` 写法。
 * 为什么添加：PDF 绘制层需要 rgb 对象，封装转换可以让版式配置更直观。
 */
function hexToRgb(hex) {
  const normalized = String(hex || '#ffffff').replace('#', '');
  const red = parseInt(normalized.slice(0, 2), 16) / 255;
  const green = parseInt(normalized.slice(2, 4), 16) / 255;
  const blue = parseInt(normalized.slice(4, 6), 16) / 255;
  return rgb(red, green, blue);
}

/**
 * 方法是什么：查找可用于 PDF 的中文字体路径。
 * 方法作用：优先读取环境变量，其次读取公共包内置字体和项目字体目录。
 * 为什么添加：中文 PDF 必须嵌入中文字体，不能依赖云函数系统是否自带字体。
 */
function resolveFontPath() {
  const candidates = [
    process.env.PDF_FONT_PATH,
    path.join(__dirname, 'fonts', 'NotoSansSC-Regular.ttf'),
    path.join(__dirname, '..', '..', 'assets', 'fonts', 'NotoSansSC-Regular.otf'),
    path.join(__dirname, '..', '..', 'assets', 'fonts', 'NotoSansSC-Regular.ttf')
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return '';
}

/**
 * 方法是什么：向 PDF 文档嵌入中文字体。
 * 方法作用：注册 fontkit 并把字体文件嵌入到 pdf-lib 文档中。
 * 为什么添加：pdf-lib 默认字体不支持中文，必须嵌入字体才能正确显示中文议程。
 */
async function embedAgendaFont(pdfDoc) {
  const fontPath = resolveFontPath();
  if (!fontPath) {
    throw new Error('缺少中文字体，请配置 PDF_FONT_PATH 或提供 common/fonts/NotoSansSC-Regular.ttf');
  }
  pdfDoc.registerFontkit(fontkit);
  const fontBytes = fs.readFileSync(fontPath);
  return pdfDoc.embedFont(fontBytes, { subset: true });
}

/**
 * 方法是什么：把顶部坐标转换为 PDF 坐标。
 * 方法作用：将从页面顶部向下的 y 值转换成 pdf-lib 从底部向上的 y 值。
 * 为什么添加：议程版式按常见页面坐标更容易设计，而 pdf-lib 使用 PDF 原生坐标系。
 */
function topY(y, height) {
  return PAGE.height - y - height;
}

/**
 * 方法是什么：安全获取议程人员名称。
 * 方法作用：根据导出语言选择中文或英文显示名，缺失时回退原始姓名。
 * 为什么添加：中英文 PDF 共用同一份议程数据，需要统一处理语言字段和空值。
 */
function getPersonName(person, language) {
  if (!person) {
    return '';
  }
  if (language === 'en') {
    return person.displayNameEn || person.rawName || '';
  }
  return person.displayNameZh || person.rawName || '';
}

/**
 * 方法是什么：安全获取议程人员俱乐部。
 * 方法作用：根据导出语言选择中文或英文俱乐部名称。
 * 为什么添加：PDF 表格里的俱乐部列需要与导出语言保持一致。
 */
function getPersonClub(person, language) {
  if (!person) {
    return '';
  }
  if (language === 'en') {
    return person.clubEn || person.clubZh || '';
  }
  return person.clubZh || person.clubEn || '';
}

/**
 * 方法是什么：按宽度拆分文本行。
 * 方法作用：使用字体宽度估算把长文本拆成多个可绘制行。
 * 为什么添加：PDF 单元格需要自动换行，避免项目描述和地址文本溢出边框。
 */
function wrapText(text, font, fontSize, maxWidth) {
  const value = String(text || '');
  const lines = [];
  let current = '';
  for (const char of value) {
    const next = current + char;
    if (font.widthOfTextAtSize(next, fontSize) <= maxWidth || !current) {
      current = next;
    } else {
      lines.push(current);
      current = char;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines.length ? lines : [''];
}

/**
 * 方法是什么：在页面上绘制一段文本。
 * 方法作用：支持颜色、字号、宽度、高度和居中对齐。
 * 为什么添加：页眉、表格单元和说明文字都需要统一的文本绘制方式。
 */
function drawText(page, font, text, x, y, options) {
  const opts = options || {};
  const fontSize = opts.fontSize || 8;
  const width = opts.width || 100;
  const height = opts.height || 12;
  const lines = wrapText(text, font, fontSize, width);
  const lineHeight = fontSize + 2;
  let cursorY = topY(y, height) + height - fontSize - 2;
  for (const line of lines) {
    if (cursorY < topY(y, height)) {
      break;
    }
    const textWidth = font.widthOfTextAtSize(line, fontSize);
    const offsetX = opts.align === 'center' ? Math.max((width - textWidth) / 2, 0) : 0;
    page.drawText(line, {
      x: x + offsetX,
      y: cursorY,
      size: fontSize,
      font,
      color: opts.color || BLACK
    });
    cursorY -= lineHeight;
  }
}

/**
 * 方法是什么：绘制一个带边框的文本单元格。
 * 方法作用：在 PDF 指定位置绘制边框、背景和自动换行文本。
 * 为什么添加：复刻议程 PDF 需要大量表格单元，封装后能保持线条和间距一致。
 */
function drawCell(page, font, x, y, width, height, text, options) {
  const opts = options || {};
  if (opts.fill) {
    page.drawRectangle({
      x,
      y: topY(y, height),
      width,
      height,
      color: hexToRgb(opts.fill)
    });
  }
  page.drawRectangle({
    x,
    y: topY(y, height),
    width,
    height,
    borderColor: BORDER,
    borderWidth: 0.6
  });
  drawText(page, font, text, x + 3, y + 2, {
    width: width - 6,
    height: height - 4,
    fontSize: opts.fontSize || 8,
    align: opts.align || 'left',
    color: opts.color || BLACK
  });
}

/**
 * 方法是什么：绘制 PDF 页眉。
 * 方法作用：输出俱乐部名称、口号、会议编号、日期和主题。
 * 为什么添加：页眉是现有议程表的品牌识别区域，导出 PDF 必须保持稳定呈现。
 */
function drawHeader(page, font, agenda, language) {
  const info = agenda.meetingInfo || {};
  drawText(page, font, '广州双语国际演讲俱乐部 GZ Bilingual Toastmasters Club', PAGE.margin, 42, {
    width: PAGE.width - PAGE.margin * 2,
    height: 22,
    fontSize: 16,
    align: 'center'
  });
  drawText(page, font, '专业的双语多元化成长分享平台', PAGE.margin, 66, {
    width: PAGE.width - PAGE.margin * 2,
    height: 18,
    fontSize: 14,
    align: 'center'
  });
  const noLabel = language === 'en' ? 'No.' : 'No.';
  const dateLabel = language === 'en' ? 'Date:' : '日期：';
  const themeLabel = language === 'en' ? 'Theme:' : '主题：';
  drawText(page, font, `${noLabel} ${info.meetingNo || ''}`, PAGE.margin, 102, { width: 100, height: 12, fontSize: 8 });
  drawText(page, font, `${dateLabel} ${info.date || ''}`, PAGE.margin + 130, 102, { width: 140, height: 12, fontSize: 8 });
  drawText(page, font, `${themeLabel} ${info.theme || ''}`, PAGE.margin + 280, 102, { width: 240, height: 12, fontSize: 8 });
}

/**
 * 方法是什么：绘制议程流程表。
 * 方法作用：把流程数组渲染成时间、流程、限时、演讲者和俱乐部列。
 * 为什么添加：议程主体是 PDF 的核心内容，用户编辑后的顺序和字段必须准确反映到导出文件。
 */
function drawAgendaTable(page, font, agenda, language) {
  const headers = language === 'en'
    ? ['Time', 'Agenda Item', 'Duration', 'Speaker', 'Club']
    : ['时间', '会议促进者', '限时', '演讲者', '俱乐部'];
  const colX = [PAGE.margin, PAGE.margin + 52, PAGE.margin + 292, PAGE.margin + 352, PAGE.margin + 465];
  const colW = [52, 240, 60, 113, 78];
  let y = 120;
  for (let index = 0; index < headers.length; index += 1) {
    drawCell(page, font, colX[index], y, colW[index], 14, headers[index], { fill: '#b8ecf4', align: 'center', fontSize: 8 });
  }
  y += 14;
  const sections = Array.isArray(agenda.sections) && agenda.sections.length
    ? agenda.sections
    : [{ id: '', titleZh: '', titleEn: '', items: agenda.items || [] }];
  for (const section of sections) {
    if (!section.items || !section.items.length) {
      continue;
    }
    const sectionTitle = language === 'en' ? section.titleEn || section.titleZh : section.titleZh || section.titleEn;
    drawCell(page, font, PAGE.margin, y, PAGE.width - PAGE.margin * 2, 16, sectionTitle, { fill: '#e2f4f6', fontSize: 7 });
    y += 16;
    for (const item of section.items) {
      const isSpeech = item.type === 'preparedSpeech';
      const person = isSpeech ? item.speech && item.speech.speaker : item.person;
      const title = language === 'en' ? item.titleEn || item.titleZh : item.titleZh || item.titleEn;
      const rowHeight = isSpeech ? 48 : 18;
      drawCell(page, font, colX[0], y, colW[0], rowHeight, item.startTime || '', { fontSize: 7 });
      drawCell(page, font, colX[1], y, colW[1], rowHeight, title, { fontSize: 7, fill: item.section === 'preparedSpeech' ? '#eeeeee' : '' });
      drawCell(page, font, colX[2], y, colW[2], rowHeight, item.duration ? `${item.duration}${language === 'en' ? ' min' : '分钟'}` : '', { fontSize: 7, align: 'center' });
      drawCell(page, font, colX[3], y, colW[3], rowHeight, getPersonName(person, language), { fontSize: 7 });
      drawCell(page, font, colX[4], y, colW[4], rowHeight, getPersonClub(person, language), { fontSize: 7 });
      if (isSpeech && item.speech) {
        const projectTitle = language === 'en' ? item.speech.projectTitleEn : item.speech.projectTitleZh;
        const objective = language === 'en' ? item.speech.projectObjectiveEn : item.speech.projectObjectiveZh;
        drawText(page, font, projectTitle || '', colX[1] + 4, y + 15, { width: colW[1] - 8, height: 10, fontSize: 6 });
        drawText(page, font, objective || '', colX[1] + 4, y + 27, { width: colW[1] - 8, height: 18, fontSize: 6 });
      }
      y += rowHeight;
      if (y > 735) {
        return;
      }
    }
  }
}

/**
 * 方法是什么：绘制计时规则区域。
 * 方法作用：在第一页底部输出绿卡、黄卡、红卡和鼓掌提示。
 * 为什么添加：现有议程 PDF 包含计时规则，保留该区域可以维持俱乐部使用习惯。
 */
function drawTimerRules(page, font, language) {
  const y = 760;
  const title = language === 'en' ? 'Timing Rules' : '计时规则（请有效利用你在台上有限的时间）';
  drawText(page, font, title, PAGE.margin, y - 18, { width: PAGE.width - PAGE.margin * 2, height: 14, fontSize: 9, align: 'center' });
  const cells = language === 'en'
    ? ['Signal', 'Green', 'Yellow', 'Red', 'Applause', '< 3 mins', '1 min left', '30 sec left', 'Time up', '+15 sec']
    : ['计时信号', '绿卡', '黄卡', '红卡', '鼓掌', '3分钟以内的发言', '剩余1分钟', '剩余30秒', '时间到', '超时15秒'];
  const widths = [130, 90, 90, 90, 90];
  const colors = ['#dddddd', '#ccffd4', '#fff56a', '#ff5a5a', '#999999'];
  let x = PAGE.margin + 20;
  for (let index = 0; index < 5; index += 1) {
    drawCell(page, font, x, y, widths[index], 14, cells[index], { fill: colors[index], align: 'center', fontSize: 7 });
    x += widths[index];
  }
  x = PAGE.margin + 20;
  for (let index = 0; index < 5; index += 1) {
    drawCell(page, font, x, y + 14, widths[index], 14, cells[index + 5], { align: 'center', fontSize: 7 });
    x += widths[index];
  }
}

/**
 * 方法是什么：绘制第二页俱乐部信息。
 * 方法作用：输出教育路径、双语成就、会议流程、入会说明和干事团队信息。
 * 为什么添加：样例 PDF 是两页结构，第二页承载俱乐部固定宣传与联系方式信息。
 */
function drawClubInfoPage(pdfDoc, font, language) {
  const page = pdfDoc.addPage([PAGE.width, PAGE.height]);
  const title = language === 'en' ? 'Toastmasters Education System' : '头马国际演讲会教育体系';
  drawCell(page, font, PAGE.margin, 110, 220, 28, language === 'en' ? 'Bilingual Updates' : '双语动态', { fill: '#c9fbff', align: 'center', fontSize: 9 });
  drawCell(page, font, PAGE.margin + 220, 110, 300, 28, title, { fill: '#c9fbff', align: 'center', fontSize: 9 });
  const pathways = language === 'en'
    ? ['1. Dynamic Leadership', '2. Engaging Humor', '3. Motivational Strategies', '4. Persuasive Influence', '5. Presentation Mastery', '6. Visionary Communication']
    : ['1. 动态领导', '2. 运用幽默', '3. 激励策略', '4. 有说服力的影响', '5. 精通演讲', '6. 愿景沟通'];
  drawText(page, font, pathways.join('\n'), PAGE.margin + 230, 160, { width: 160, height: 90, fontSize: 8 });
  const achievementTitle = language === 'en' ? 'Bilingual Achievements' : '双语成就';
  const procedureTitle = language === 'en' ? 'Meeting Procedure' : '会议流程';
  drawCell(page, font, PAGE.margin + 220, 310, 150, 18, achievementTitle, { fill: '#dddddd', align: 'center', fontSize: 8 });
  drawCell(page, font, PAGE.margin + 370, 310, 150, 18, procedureTitle, { fill: '#dddddd', align: 'center', fontSize: 8 });
  const achievements = language === 'en'
    ? ['First Bilingual Toastmasters Club in GZ', 'President Distinguished Club 2012-2013, 2015-2025', 'Home Club of the Area Director', 'Beat the Clock Award']
    : ['广州第一家以“双语”命名的俱乐部', '会长杰出俱乐部 2012-2013, 2015-2025', '头马大区干事的摇篮', '头马争分夺秒殊荣奖'];
  const procedures = language === 'en'
    ? ['Opening and Facilitators', 'Table Topics Session', 'Prepared Speech Session', 'Evaluation Session', 'Award and Role Booking']
    : ['开场和会议促进者介绍', '即兴演讲环节', '备稿环节', '备稿点评环节', '颁奖与角色预定'];
  drawText(page, font, achievements.join('\n'), PAGE.margin + 230, 335, { width: 130, height: 90, fontSize: 8, align: 'center' });
  drawText(page, font, procedures.join('\n'), PAGE.margin + 385, 335, { width: 120, height: 90, fontSize: 8, align: 'center' });
  drawCell(page, font, PAGE.margin + 220, 520, 300, 18, language === 'en' ? '2026 Club Officer Team' : '2026年（上）俱乐部干事 Club Officer Team', { fill: '#9ee8ff', align: 'center', fontSize: 8 });
  const officers = [
    ['会长 President', '白俊杰 Benny', 'benny-bai'],
    ['教育副会长 VPE', '韦文耐 Winnie', 'a15078646220'],
    ['会员副会长 VPM', '不懂先生 Franco', 'hgw620782'],
    ['公关副会长 VPPR', '周沫 Mo', 'Movision_design'],
    ['秘书长 Secretary', '廖凤媚 Miranda', 'M15920143399']
  ];
  let y = 538;
  for (const officer of officers) {
    drawCell(page, font, PAGE.margin + 220, y, 120, 18, officer[0], { fill: '#d8ffff', fontSize: 7 });
    drawCell(page, font, PAGE.margin + 340, y, 90, 18, officer[1], { fontSize: 7 });
    drawCell(page, font, PAGE.margin + 430, y, 90, 18, officer[2], { fontSize: 7 });
    y += 18;
  }
}

/**
 * 方法是什么：生成议程 PDF Buffer。
 * 方法作用：根据议程数据和语言选项生成两页 A4 PDF 文件内容。
 * 为什么添加：导出 PDF 是用户最终交付物，需要在服务端生成并上传云存储。
 */
async function renderAgendaPdf(agenda, language) {
  const pdfDoc = await PDFDocument.create();
  const font = await embedAgendaFont(pdfDoc);
  const firstPage = pdfDoc.addPage([PAGE.width, PAGE.height]);
  drawHeader(firstPage, font, agenda, language);
  drawAgendaTable(firstPage, font, agenda, language);
  drawTimerRules(firstPage, font, language);
  drawClubInfoPage(pdfDoc, font, language);
  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

module.exports = {
  hexToRgb,
  resolveFontPath,
  embedAgendaFont,
  topY,
  getPersonName,
  getPersonClub,
  wrapText,
  drawText,
  drawCell,
  drawHeader,
  drawAgendaTable,
  drawTimerRules,
  drawClubInfoPage,
  renderAgendaPdf
};
