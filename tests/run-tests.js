const assert = require('assert');
const parser = require('../cloudfunctions/common/parser');
const pdfRenderer = require('../cloudfunctions/common/pdf-renderer');
const memberships = require('../cloudfunctions/seedWorkbookData/data/memberships.json');
const pathways = require('../cloudfunctions/seedWorkbookData/data/pathways.json');

const SAMPLE_TEXT = `#接龙
广州双语国际演讲俱乐部第760期中文会议，欢迎大家报名角色

📆时间：2026年7月8日周三19:30-21:30
🏠地址：广州市天河区珠江新城华穗路172号星辰大厦西塔1904-A房（5号线珠江新城B1出口）

礼宾官（宾客） ：维奇
会议经理：马威
总主持人：文烨彬
时间官：谢仁
语法师：[太阳]
总体点评：不懂

即兴主持人：文耐
即兴点评：建安

备稿演讲者1：周沫
项目级别：L4P3
点评者1：张国聪

备稿演讲者2：文耐
项目级别：L2P2
点评者2：佩欣

参与者请接龙报名：
1. 文耐
2. Brittany.蔡
3. 张国聪(省直中文)`;

/**
 * 方法是什么：断言姓名可以匹配到指定会员中文名。
 * 方法作用：复用姓名匹配逻辑验证简称、混合名和括号说明。
 * 为什么添加：姓名匹配是接龙解析质量的关键，测试可以防止后续改动破坏匹配。
 */
function assertMember(rawName, expectedNameZh) {
  const match = parser.matchMemberByName(rawName, memberships);
  assert.strictEqual(match.matched, true, `${rawName} 应该匹配成功`);
  assert.strictEqual(match.member.nameZh, expectedNameZh, `${rawName} 应匹配 ${expectedNameZh}`);
}

/**
 * 方法是什么：测试 Excel 种子数据。
 * 方法作用：确认 Membership 和 Pathways JSON 已从样例 Excel 正确生成。
 * 为什么添加：基础数据缺失会导致接龙解析和 PDF 项目描述无法正常工作。
 */
function testSeedData() {
  assert.ok(memberships.length >= 60, 'Membership 种子数据数量不足');
  assert.ok(pathways.length >= 30, 'Pathways 种子数据数量不足');
  assert.ok(memberships.some(function findMo(member) {
    return member.nameZh === '周沫';
  }), '应包含周沫');
  assert.ok(pathways.some(function findL2P2(item) {
    return item.code === 'L2P2';
  }), '应包含 L2P2 项目');
}

/**
 * 方法是什么：测试姓名匹配能力。
 * 方法作用：覆盖中文简称、英文加中文姓、括号俱乐部说明等常见接龙写法。
 * 为什么添加：接龙里姓名写法非常自由，需要确保关键样例能匹配 Membership。
 */
function testNameMatching() {
  assertMember('文耐', '韦文耐');
  assertMember('不懂', '不懂先生');
  assertMember('佩欣', '陈佩欣');
  assertMember('Brittany.蔡', '蔡艳灵');
  assert.strictEqual(parser.matchMemberByName('张国聪(省直中文)', memberships).matched, false, '外部人员应保留待确认');
}

/**
 * 方法是什么：测试规则解析议程。
 * 方法作用：用第 760 期样例接龙验证会议字段、角色、备稿和参与者。
 * 为什么添加：DeepSeek 不可用时规则解析必须能支撑开发调试和基础使用。
 */
function testRuleParser() {
  const agenda = parser.validateAgenda(parser.parseAgendaByRules(SAMPLE_TEXT, memberships, pathways));
  assert.strictEqual(agenda.meetingInfo.meetingNo, '760');
  assert.strictEqual(agenda.meetingInfo.date, '2026-07-08');
  assert.strictEqual(agenda.roles.meetingManager.rawName, '马威');
  assert.strictEqual(agenda.preparedSpeeches.length, 2);
  assert.ok(agenda.items.length >= 10, '应生成基础流程项目');
  assert.strictEqual(agenda.participants.length, 3);
  return agenda;
}

/**
 * 方法是什么：测试 PDF 生成能力。
 * 方法作用：用规则解析出的议程生成中文 PDF，并确认返回内容是 PDF 文件。
 * 为什么添加：导出 PDF 是核心交付物，测试可以提前发现字体、依赖或渲染器异常。
 */
async function testPdfRenderer(agenda) {
  const buffer = await pdfRenderer.renderAgendaPdf(agenda, 'zh');
  assert.ok(buffer.length > 10000, 'PDF 文件大小异常');
  assert.strictEqual(buffer.slice(0, 4).toString(), '%PDF', '应生成 PDF 文件');
}

/**
 * 方法是什么：运行全部测试。
 * 方法作用：依次执行种子数据、姓名匹配和规则解析测试。
 * 为什么添加：提供一个不依赖微信开发者工具的本地验证入口。
 */
async function main() {
  testSeedData();
  testNameMatching();
  const agenda = testRuleParser();
  await testPdfRenderer(agenda);
  console.log('核心测试通过。');
}

/**
 * 方法是什么：处理测试运行中的异常。
 * 方法作用：打印错误并以非零状态码结束进程。
 * 为什么添加：异步 PDF 测试失败时需要让 CI 或本地命令明确失败。
 */
function handleTestError(error) {
  console.error(error);
  process.exit(1);
}

main().catch(handleTestError);
