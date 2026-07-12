const app = getApp();
const cloud = require('../../utils/cloud');

const SAMPLE_TEXT = `#接龙
广州双语国际演讲俱乐部第760期中文会议，欢迎大家报名角色[庆祝][庆祝][庆祝]

📆时间：2026年7月8日周三19:30-21:30
🏠地址：广州市天河区珠江新城华穗路172号星辰大厦西塔1904-A房（5号线珠江新城B1出口）

—开放给宾客和会员报名—
[庆祝]礼宾官（宾客） ：维奇
[庆祝]礼宾官（会员）：[Sun]
📹摄影师（宾客）：俊州
[烟花]哼哈师（宾客）：蔡蔡

—开放给会员报名—
🎬会议经理：马威
🎙总主持人：文烨彬
⏲时间官：谢仁
🧙‍♂语法师：[太阳]
⚖总体点评：不懂

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
2. 俊杰
3. 桂竹
4. 周沫`;

Page({
  data: {
    rawText: '',
    parsing: false,
    agenda: null,
    aiUsed: false,
    unresolvedText: '',
    isAdmin: false,
    canClaimAdmin: false
  },

  /**
   * 方法是什么：首页加载生命周期方法。
   * 方法作用：同步全局登录状态，用于展示管理员入口和领取按钮。
   * 为什么添加：用户进入首页时需要立即知道当前权限状态。
   */
  onLoad() {
    this.syncAuthState();
  },

  /**
   * 方法是什么：首页显示生命周期方法。
   * 方法作用：从全局状态重新同步角色，处理用户从管理页返回后的状态变化。
   * 为什么添加：管理员领取或角色变更后，首页按钮需要及时刷新。
   */
  onShow() {
    this.syncAuthState();
  },

  /**
   * 方法是什么：同步当前用户权限状态到页面。
   * 方法作用：读取全局 roles 和 canClaimAdmin 并设置页面数据。
   * 为什么添加：首页按钮可见性依赖权限，集中同步可以避免多个地方重复判断。
   */
  syncAuthState() {
    this.setData({
      isAdmin: app.isAdmin(),
      canClaimAdmin: app.globalData.canClaimAdmin
    });
  },

  /**
   * 方法是什么：处理接龙文本输入。
   * 方法作用：把 textarea 的值写入页面数据。
   * 为什么添加：解析云函数需要读取用户最新粘贴的接龙原文。
   */
  handleRawTextInput(event) {
    this.setData({ rawText: event.detail.value });
  },

  /**
   * 方法是什么：填入内置示例接龙。
   * 方法作用：把第 760 期样例文本放入输入框。
   * 为什么添加：开发和演示阶段可以快速验证解析、编辑和导出链路。
   */
  useSampleText() {
    this.setData({ rawText: SAMPLE_TEXT });
  },

  /**
   * 方法是什么：为首页预览补充展示字段。
   * 方法作用：把不同类型流程的人员姓名统一写到 `previewPerson`。
   * 为什么添加：首页只做摘要预览，不适合在 WXML 中写复杂的类型判断表达式。
   */
  decorateAgendaForPreview(agenda) {
    const cloned = JSON.parse(JSON.stringify(agenda));
    for (const item of cloned.items || []) {
      if (item.person) {
        item.previewPerson = item.person.displayNameZh || item.person.rawName || '';
      } else if (item.speech && item.speech.speaker) {
        item.previewPerson = item.speech.speaker.displayNameZh || item.speech.speaker.rawName || '';
      } else {
        item.previewPerson = '';
      }
    }
    return cloned;
  },

  /**
   * 方法是什么：调用云函数解析接龙。
   * 方法作用：把用户粘贴的文本发送到 `parseAgenda`，并保存返回的议程结构。
   * 为什么添加：这是从非结构化接龙生成可编辑议程表单的主入口。
   */
  async parseAgenda() {
    if (!this.data.rawText.trim()) {
      wx.showToast({ title: '请先粘贴接龙文本', icon: 'none' });
      return;
    }
    this.setData({ parsing: true });
    try {
      const data = await cloud.callCloud('parseAgenda', { rawText: this.data.rawText });
      const agenda = this.decorateAgendaForPreview(data.agenda);
      app.setCurrentAgenda(data.agenda);
      this.setData({
        agenda,
        aiUsed: data.aiUsed,
        unresolvedText: (data.agenda.unresolvedNames || []).join('、')
      });
      cloud.showSuccess('解析完成');
    } catch (error) {
      cloud.showError(error);
    } finally {
      this.setData({ parsing: false });
    }
  },

  /**
   * 方法是什么：跳转到议程编辑页。
   * 方法作用：把当前解析结果放入全局状态后打开编辑页面。
   * 为什么添加：解析后用户需要继续编辑流程、顺序、姓名和项目描述。
   */
  goEditor() {
    if (!this.data.agenda) {
      wx.showToast({ title: '请先解析接龙', icon: 'none' });
      return;
    }
    app.setCurrentAgenda(this.data.agenda);
    wx.navigateTo({ url: '/pages/editor/editor' });
  },

  /**
   * 方法是什么：领取系统首个管理员。
   * 方法作用：调用 `claimInitialAdmin` 云函数并刷新登录状态。
   * 为什么添加：空系统需要一个产品化的管理员初始化入口，避免手工改数据库。
   */
  async claimAdmin() {
    try {
      await cloud.callCloud('claimInitialAdmin', {});
      await app.login();
      this.syncAuthState();
      cloud.showSuccess('已成为管理员');
    } catch (error) {
      cloud.showError(error);
    }
  },

  /**
   * 方法是什么：打开历史议程页面。
   * 方法作用：跳转到用户已保存议程列表。
   * 为什么添加：用户需要查看、继续编辑和重新导出过往议程。
   */
  openHistory() {
    wx.navigateTo({ url: '/pages/history/history' });
  },

  /**
   * 方法是什么：打开管理中心页面。
   * 方法作用：管理员进入 Membership、Pathways 和角色维护界面。
   * 为什么添加：基础数据需要在当前系统中维护，不能长期依赖 Excel 手工更新。
   */
  openAdmin() {
    wx.navigateTo({ url: '/pages/admin/admin' });
  }
});
