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
    unresolvedText: ''
  },

  /**
   * 方法是什么：解析页加载生命周期方法。
   * 方法作用：进入页面时恢复当前正在编辑的议程摘要。
   * 为什么添加：用户从编辑页返回解析页时，可以继续看到最近一次解析结果。
   */
  onLoad() {
    this.restoreCurrentAgenda();
  },

  /**
   * 方法是什么：解析页显示生命周期方法。
   * 方法作用：页面重新显示时同步全局当前议程。
   * 为什么添加：编辑页可能修改了全局议程，返回解析页后预览需要保持一致。
   */
  onShow() {
    this.restoreCurrentAgenda();
  },

  /**
   * 方法是什么：恢复全局当前议程到解析页。
   * 方法作用：读取 `app.globalData.currentAgenda` 并生成页面预览字段。
   * 为什么添加：跨页面跳转不能依赖页面私有状态，恢复逻辑能减少解析结果丢失。
   */
  restoreCurrentAgenda() {
    const currentAgenda = app.globalData.currentAgenda;
    if (!currentAgenda) {
      return;
    }
    this.setData({
      agenda: this.decorateAgendaForPreview(currentAgenda),
      unresolvedText: (currentAgenda.unresolvedNames || []).join('、')
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
   * 方法是什么：为解析结果预览补充展示字段。
   * 方法作用：把不同类型流程的人员姓名统一写到 `previewPerson`。
   * 为什么添加：预览列表只需要摘要展示，提前整理字段能让 WXML 保持简单。
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
   * 方法是什么：打开历史议程页面。
   * 方法作用：跳转到用户已保存议程列表。
   * 为什么添加：用户需要查看、继续编辑和重新导出过往议程。
   */
  openHistory() {
    wx.navigateTo({ url: '/pages/history/history' });
  }
});
