const app = getApp();
const cloud = require('../../utils/cloud');
const agendaUtil = require('../../utils/agenda');

Page({
  data: { agenda: null, loading: true, creatingSignup: false },
  async onShow() { await this.loadAgenda(); },
  async loadAgenda() {
    this.setData({ loading: true });
    try {
      const data = await cloud.callCloud('agendaQuery', { action: 'current' });
      const agenda = data.agenda || null;
      app.setCurrentAgenda(agenda);
      this.setData({ agenda });
    } catch (error) { cloud.showError(error); }
    finally { this.setData({ loading: false }); }
  },
  async ensureAgenda() {
    if (this.data.agenda) return this.data.agenda;
    const data = await cloud.callCloud('saveAgenda', { agenda: agendaUtil.createEmptyAgenda() });
    app.setCurrentAgenda(data.agenda); this.setData({ agenda: data.agenda }); return data.agenda;
  },
  async goEditor() {
    try { const agenda = await this.ensureAgenda(); wx.navigateTo({ url: `/pages/editor/editor?id=${agenda._id}` }); }
    catch (error) { cloud.showError(error); }
  },
  async goSignup() {
    this.setData({ creatingSignup: true });
    try {
      const agenda = await this.ensureAgenda();
      const data = await cloud.callCloud('signupService', { action: 'create', agendaId: agenda._id });
      wx.navigateTo({ url: `/pages/signup/signup?publicId=${data.publicId}` });
    } catch (error) { cloud.showError(error); }
    finally { this.setData({ creatingSignup: false }); }
  },
  goTemplate() { wx.navigateTo({ url: '/pages/template-editor/template-editor' }); }
});
