const app = getApp();

Page({
  data: { clubs: [], currentClub: {}, clubIndex: 0 },

  /**
   * 方法是什么：更多页面显示生命周期方法。
   * 方法作用：同步身份、俱乐部列表和当前默认选择。
   * 为什么添加：默认俱乐部设置必须反映首页最近一次选择。
   */
  async onShow() {
    await app.refreshClubs();
    const clubs = app.globalData.clubs || [];
    const clubIndex = Math.max(0, clubs.findIndex((club) => String(club.clubId) === String(app.globalData.currentClubId)));
    this.setData({ clubs, clubIndex, currentClub: clubs[clubIndex] || app.globalData.club || {} });
  },

  /**
   * 方法是什么：设置默认俱乐部。
   * 方法作用：响应下拉框选择，保存本地默认俱乐部、切换上下文并按新俱乐部刷新身份。
   * 为什么添加：用户下次进入首页时需要恢复常用俱乐部，切换后各页面数据立即跟随新俱乐部。
   */
  async chooseDefaultClub(event) {
    const index = Number(event.detail.value);
    const club = this.data.clubs[index];
    if (!club) return;
    app.setDefaultClub(club.clubId);
    app.setCurrentAgenda(null);
    await app.login();
    this.setData({ clubIndex: index, currentClub: club });
    wx.showToast({ title: '默认俱乐部已保存', icon: 'success' });
  }
});
