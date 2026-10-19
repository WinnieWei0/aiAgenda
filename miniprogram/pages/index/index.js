Page({
  data: {
      isAdmin: false,
      isSuperAdmin: false,
      isClubMember: false,
    clubs: [],
    clubIndex: 0,
    welcomeName: '宾客',
    clubNameEn: 'Club Name'
  },

  /**
   * 方法是什么：首页显示生命周期方法。
   * 方法作用：每次返回首页时同步当前真实管理员身份。
   * 为什么添加：管理入口必须随会员绑定状态更新。
   */
  async onShow() {
    wx.showShareMenu({
      menus: ['shareAppMessage', 'shareTimeline']
    });
    const app = getApp();
    await app.login();
    await app.refreshClubs();
    const identity = app.globalData.identity || {};
    const user = app.globalData.user || {};
    const club = app.globalData.club || {};
    const clubs = app.globalData.clubs || [];
    const clubIndex = Math.max(0, clubs.findIndex((club) => String(club.clubId) === String(app.globalData.currentClubId)));
    this.setData({
      isAdmin: app.isAdmin(),
      isSuperAdmin: app.isSuperAdmin(),
      isClubMember: app.isClubMember(),
      welcomeName: identity.name || user.nickName || '宾客',
      clubName: club.nameZh || '俱乐部名称',
      clubNameEn: club.shortNameEn || club.nameEn || 'Club Name',
      clubs,
      clubIndex
    });
  },

  /**
   * 方法是什么：首页切换俱乐部。
   * 方法作用：响应下拉框选择，持久化默认俱乐部、按新俱乐部重新登录刷新身份和首页显示。
   * 为什么添加：会员列表、路径列表、邀请绑定和议程数据都必须跟随当前俱乐部切换。
   */
  async switchClub(event) {
    const index = Number(event.detail.value);
    const club = this.data.clubs[index];
    if (!club) return;
    const app = getApp();
    app.setDefaultClub(club.clubId);
    app.setCurrentAgenda(null);
    await app.login();
    const identity = app.globalData.identity || {};
    const user = app.globalData.user || {};
    this.setData({
      clubIndex: index,
      clubName: club.shortNameZh || club.nameZh || '俱乐部名称',
      clubNameEn: club.shortNameEn || club.nameEn || 'Club Name',
      isAdmin: app.isAdmin(),
      isSuperAdmin: app.isSuperAdmin(),
      isClubMember: app.isClubMember(),
      welcomeName: identity.name || user.nickName || '宾客'
    });
  },

  /**
   * 方法是什么：首页好友转发配置方法。
   * 方法作用：设置俱乐部首页的转发标题、落地页和品牌缩略图。
   * 为什么添加：让用户可以把公开俱乐部首页直接分享给微信好友。
   */
  onShareAppMessage() {
    return {
      title: '俱乐部名称',
      path: '/pages/index/index',
      imageUrl: '/images/template/role-signup-share.png'
    };
  },

  /**
   * 方法是什么：首页朋友圈分享配置方法。
   * 方法作用：设置分享到朋友圈时展示的俱乐部标题和品牌缩略图。
   * 为什么添加：补充朋友圈分享入口并确保分享后直接进入公开首页。
   */
  onShareTimeline() {
    return {
      title: '俱乐部名称',
      query: '',
      imageUrl: '/images/template/role-signup-share.png'
    };
  },

  /**
   * 方法是什么：打开会员列表。
   * 方法作用：进入会员数据管理页面。
   * 为什么添加：首页需要直接访问会员数据。
   */
  openMembersList() {
    wx.navigateTo({ url: '/pages/members/list/list' });
  },

  /**
   * 方法是什么：打开路径列表。
   * 方法作用：进入路径数据管理页面。
   * 为什么添加：首页需要直接访问路径数据。
   */
  openPathwaysList() {
    wx.navigateTo({ url: '/pages/pathways/list/list' });
  },

  openMembershipInvite() {
    if (this.data.isAdmin) {
      wx.navigateTo({ url: '/pages/membership-invite/membership-invite' });
    }
  }
});
