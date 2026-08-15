const app = getApp();
const cloud = require('../../utils/cloud');
const agendaUtil = require('../../utils/agenda');

function summarizeAgenda(agenda) {
  const info = agenda && agenda.meetingInfo;
  if (!info) return null;
  return {
    meetingNo: info.meetingNo || '',
    date: info.date || '',
    startTime: info.startTime || '',
    endTime: info.endTime || ''
  };
}

Page({
  data: {
    summary: null,
    openingEditor: false,
    creatingSignup: false
  },

  /**
   * 方法是什么：议程表入口页显示回调。
   * 方法作用：先显示内存摘要，再仅向云端读取期数和时间字段。
   * 为什么添加：避免进入页面时下载完整议程导致白屏和闪烁。
   */
  onShow() {
    const localSummary = summarizeAgenda(app.globalData.currentAgenda);
    if (localSummary) this.setData({ summary: localSummary });
    this.loadSummary();
  },

  async loadSummary() {
    try {
      const data = await cloud.callCloud('agendaQuery', { action: 'summary' });
      this.setData({ summary: data.summary || null });
    } catch (error) {
      console.warn('load agenda summary failed', error);
    }
  },

  async loadAgenda() {
    const data = await cloud.callCloud('agendaQuery', { action: 'current' });
    const agenda = data.agenda || null;
    app.setCurrentAgenda(agenda);
    this.setData({ summary: summarizeAgenda(agenda) });
    return agenda;
  },

  async ensureAgenda() {
    const current = await this.loadAgenda();
    if (current) return current;
    const data = await cloud.callCloud('saveAgenda', { agenda: agendaUtil.createEmptyAgenda() });
    app.setCurrentAgenda(data.agenda);
    this.setData({ summary: summarizeAgenda(data.agenda) });
    return data.agenda;
  },

  async goEditor() {
    if (this.data.openingEditor || this.data.creatingSignup) return;
    this.setData({ openingEditor: true });
    try {
      const agenda = await this.ensureAgenda();
      wx.navigateTo({ url: `/pages/editor/editor?id=${agenda._id}` });
    } catch (error) {
      cloud.showError(error);
    } finally {
      this.setData({ openingEditor: false });
    }
  },

  async goSignup() {
    if (this.data.openingEditor || this.data.creatingSignup) return;
    this.setData({ creatingSignup: true });
    try {
      const agenda = await this.ensureAgenda();
      const data = await cloud.callCloud('signupService', { action: 'create', agendaId: agenda._id });
      wx.navigateTo({ url: `/pages/signup/signup?publicId=${data.publicId}` });
    } catch (error) {
      cloud.showError(error);
    } finally {
      this.setData({ creatingSignup: false });
    }
  },

  goTemplate() {
    if (this.data.openingEditor || this.data.creatingSignup) return;
    wx.navigateTo({ url: '/pages/template-editor/template-editor' });
  }
});
