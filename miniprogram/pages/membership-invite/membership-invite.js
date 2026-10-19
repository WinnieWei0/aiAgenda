const app = getApp();
const cloud = require('../../utils/cloud');

Page({
  data: { loading: true, token: '', invite: null, members: [], selectedMember: null, selectorVisible: false, creating: false, claiming: false, createdInvite: null },
  async onLoad(options) {
    wx.hideShareMenu();
    const token = options && options.token || '';
    this.setData({ token });
    this.loadedClubId = '';
    if (token) await this.loadInvite(token); else await this.loadAdminMode();
  },
  /**
   * 方法是什么：邀请页显示生命周期方法。
   * 方法作用：俱乐部切换后重新加载可邀请会员列表。
   * 为什么添加：候选会员按俱乐部隔离，回到本页时必须跟随当前俱乐部。
   */
  async onShow() {
    if (this.data.token || this.data.loading) return;
    const clubId = String(app.globalData.currentClubId || '');
    if (clubId && clubId !== this.loadedClubId) await this.loadAdminMode();
  },
  async loadAdminMode() {
    await app.login();
    if (!app.isAdmin()) { wx.showToast({ title: '仅管理员可创建邀请', icon: 'none' }); wx.navigateBack(); return; }
    try { const data = await cloud.callCloud('membershipInvites', { action: 'available' }); this.loadedClubId = String(app.globalData.currentClubId || ''); this.setData({ members: data.list || [], loading: false }); }
    catch (error) { this.setData({ loading: false }); cloud.showError(error); }
  },
  async loadInvite(token) {
    try { const invite = await cloud.callCloud('membershipInvites', { action: 'get', token }); this.setData({ invite, loading: false }); }
    catch (error) { this.setData({ loading: false }); cloud.showError(error); }
  },
  openSelector() { this.setData({ selectorVisible: true }); },
  closeSelector() { this.setData({ selectorVisible: false }); },
  confirmSelector(event) { this.setData({ selectedMember: event.detail.member, selectorVisible: false, createdInvite: null }); },
  async createInvite() {
    if (!this.data.selectedMember || this.data.creating) return;
    this.setData({ creating: true });
    try { const createdInvite = await cloud.callCloud('membershipInvites', { action: 'create', memberId: this.data.selectedMember._id }); this.setData({ createdInvite }); wx.showShareMenu({ menus: ['shareAppMessage'] }); cloud.showSuccess('邀请已生成'); }
    catch (error) { cloud.showError(error); }
    finally { this.setData({ creating: false }); }
  },
  async claimInvite() {
    if (this.data.claiming) return;
    this.setData({ claiming: true });
    try { await cloud.callCloud('membershipInvites', { action: 'claim', token: this.data.token }); await app.login(); cloud.showSuccess('身份绑定成功'); setTimeout(() => wx.switchTab({ url: '/pages/parse/parse' }), 500); }
    catch (error) { cloud.showError(error); }
    finally { this.setData({ claiming: false }); }
  },
  onShareAppMessage() {
    const created = this.data.createdInvite;
    const member = created && created.member || {};
    return { title: `请确认绑定会员身份：${member.nameZh || member.nameEn || ''}`, path: `/pages/membership-invite/membership-invite?token=${created && created.token || ''}` };
  }
});
