const app = getApp();

Page({
  data: { clubs: [], currentClub: {}, clubIndex: 0 },

  /**
   * 方法是什么：更多页面显示生命周期方法。
   * 方法作用：同步身份、俱乐部列表和当前默认选择。
   * 为什么添加：默认俱乐部设置必须反映首页最近一次选择。
   */
  onShow() {
    const clubs = app.globalData.clubs || [];
    const clubIndex = Math.max(0, clubs.findIndex((club) => String(club.clubId) === String(app.globalData.currentClubId)));
    this.setData({ clubs, clubIndex, currentClub: clubs[clubIndex] || app.globalData.club || {} });
  },

  /**
   * 方法是什么：设置默认俱乐部。
   * 方法作用：保存本地默认俱乐部并立即切换当前上下文。
   * 为什么添加：用户下次进入首页时需要恢复常用俱乐部。
   */
  chooseDefaultClub(event) {
    const index = Number(event.detail.value);
    const club = this.data.clubs[index];
    if (!club) return;
    app.setDefaultClub(club.clubId);
    this.setData({ clubIndex: index, currentClub: club });
    wx.showToast({ title: '默认俱乐部已保存', icon: 'success' });
  }
});
