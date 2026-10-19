const environment = require('./config/environment');

App({
  globalData: {
    envId: '',
    environment: environment.environment,
    user: null,
    roles: [],
    identity: { role: 'guest', roleLabel: '宾客', name: '', membership: null },
    club: { clubId: 1, nameZh: '俱乐部名称', nameEn: 'Club Name', shortNameZh: '', shortNameEn: '' },
    clubs: [],
    defaultClubId: '',
    currentAgenda: null
  },

  /**
   * 方法是什么：小程序启动生命周期方法。
   * 方法作用：初始化云开发环境，并尝试完成用户登录。
   * 为什么添加：所有页面都依赖云函数和用户身份，启动时统一准备可以减少页面重复逻辑。
   */
  async onLaunch() {
    if (!this.initCloud()) return;
    await this.login();
    await this.refreshClubs();
  },

  /**
   * 方法是什么：初始化微信云开发。
   * 方法作用：使用当前配置的 CloudBase 环境 ID 调用 `wx.cloud.init`。
   * 为什么添加：小程序访问云函数、云数据库和云存储前必须完成云开发初始化。
   */
  initCloud() {
    if (!wx.cloud) {
      wx.showModal({
        title: '基础库版本过低',
        content: '请升级微信版本后再使用云开发能力。',
        showCancel: false
      });
      return;
    }
    let runtime;
    try {
      runtime = environment.getEnvironment();
    } catch (error) {
      wx.showModal({ title: '环境未配置', content: error.message, showCancel: false });
      return false;
    }
    this.globalData.envId = runtime.envId;
    wx.cloud.init({
      env: runtime.envId,
      traceUser: true
    });
    return true;
  },

  /**
   * 方法是什么：登录并同步当前用户角色。
   * 方法作用：调用 `login` 云函数，保存用户资料、角色和是否可领取管理员。
   * 为什么添加：页面需要根据角色决定是否展示管理入口，云函数也需要用户记录用于审计。
   */
  async login(profile) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'login',
        data: Object.assign({ profile: profile || {} }, this.getClubPayload())
      });
      if (res.result && res.result.ok) {
        this.globalData.user = res.result.data.user;
        this.globalData.roles = res.result.data.roles || [];
        this.globalData.identity = res.result.data.identity || { role: 'guest', roleLabel: '宾客', name: '', membership: null };
        this.globalData.clubs = res.result.data.clubs || [];
        const club = res.result.data.club || this.globalData.clubs[0];
        if (club) this.setClub(club);
        return true;
      }
      throw new Error((res.result && res.result.error && res.result.error.message) || '登录服务未返回数据');
    } catch (error) {
      console.warn('登录失败', error);
      wx.showToast({ title: error.message || '登录失败', icon: 'none' });
    }
    return false;
  },

  /**
   * 方法是什么：通过云函数读取俱乐部目录。
   * 方法作用：调用 lookupOptions 的 clubs 分支取得 app_clubs 的全部记录。
   * 为什么添加：客户端对 app_clubs 没有直接读权限，必须由服务端返回目录，且所有角色都可查看。
   */
  async loadClubsFromCloud() {
    const res = await wx.cloud.callFunction({
      name: 'lookupOptions',
      data: { type: 'clubs' }
    });
    if (!res.result || !res.result.ok) {
      throw new Error((res.result && res.result.error && res.result.error.message) || '俱乐部服务未返回数据');
    }
    return (res.result.data.list || []).map((club, index) => {
      const rawId = club.clubId || club.id || (club._id === 'default-club' ? 1 : club._id);
      const numericId = Number(rawId);
      return Object.assign({}, club, {
        clubId: Number.isSafeInteger(numericId) && numericId > 0 ? numericId : (rawId || index + 1),
        displayName: club.displayName || club.nameZh || club.nameEn || club.shortNameZh || club.shortNameEn || '未命名俱乐部'
      });
    }).filter((club) => club.clubId !== undefined && club.clubId !== null && String(club.clubId).trim() !== '');
  },

  /**
   * 方法是什么：刷新当前俱乐部列表。
   * 方法作用：查询 app_clubs 目录，恢复默认选择并更新页面共用的俱乐部状态。
   * 为什么添加：首页和更多页需要同一份实时俱乐部目录，且不限制系统角色类型。
   */
  async refreshClubs() {
    try {
      const clubs = await this.loadClubsFromCloud();
      this.globalData.clubs = clubs;
      const storedClubId = wx.getStorageSync('defaultClubId');
      const preferred = clubs.find((club) => String(club.clubId) === String(storedClubId));
      if (storedClubId && !preferred) wx.removeStorageSync('defaultClubId');
      const selected = preferred
        || clubs.find((club) => String(club.clubId) === String(this.globalData.currentClubId))
        || clubs[0];
      if (selected) this.setClub(selected);
      return true;
    } catch (error) {
      console.warn('读取俱乐部目录失败', error);
      const clubs = this.globalData.clubs || [];
      if (clubs.length) {
        const selected = clubs.find((club) => String(club.clubId) === String(this.globalData.currentClubId)) || clubs[0];
        this.setClub(selected);
        return true;
      }
      wx.showToast({ title: '读取俱乐部失败，请检查数据库权限', icon: 'none' });
      return false;
    }
  },

  /**
   * 方法是什么：判断当前用户是否为管理员。
   * 方法作用：检查全局角色列表中是否包含 `admin`。
   * 为什么添加：多个页面都需要根据管理员身份展示或隐藏管理能力。
   */
  isAdmin() {
    const role = this.globalData.identity && this.globalData.identity.role;
    return role === 'super_admin' || role === 'admin';
  },

  /**
   * 方法是什么：判断当前用户是否为超管。
   * 方法作用：检查全局身份角色是否为 `super_admin`。
   * 为什么添加：模板编辑和时间牌等入口只对超管开放。
   */
  isSuperAdmin() {
    const role = this.globalData.identity && this.globalData.identity.role;
    return role === 'super_admin';
  },

  /**
   * 方法是什么：判断当前用户是否为本俱乐部成员。
   * 方法作用：检查全局身份角色是否为超管、管理员或会员之一。
   * 为什么添加：会员列表、路径列表和报名会员选项需要对全部俱乐部成员开放，同时排除宾客。
   */
  isClubMember() {
    const role = this.globalData.identity && this.globalData.identity.role;
    return role === 'super_admin' || role === 'admin' || role === 'member';
  },

  setClub(club) {
    if (!club) return;
    this.globalData.club = club;
    this.globalData.currentClubId = club.clubId;
  },

  /**
   * 方法是什么：设置默认俱乐部。
   * 方法作用：持久化用户下次进入首页时要使用的俱乐部。
   * 为什么添加：多俱乐部用户需要稳定恢复常用俱乐部。
   */
  setDefaultClub(clubId) {
    wx.setStorageSync('defaultClubId', String(clubId));
    this.globalData.defaultClubId = String(clubId);
    const club = this.globalData.clubs.find((item) => String(item.clubId) === String(clubId));
    if (club) this.setClub(club);
  },

  /**
   * 方法是什么：生成当前俱乐部请求参数。
   * 方法作用：为业务云函数附加当前俱乐部上下文。
   * 为什么添加：切换俱乐部后所有数据请求必须使用同一上下文。
   */
  getClubPayload() {
    return this.globalData.currentClubId ? { clubId: this.globalData.currentClubId } : {};
  },

  /**
   * 方法是什么：保存当前正在编辑的议程到全局状态。
   * 方法作用：让首页解析结果可以传递给编辑页继续修改。
   * 为什么添加：小程序页面跳转参数不适合传输完整议程对象，需要使用全局状态临时承接。
   */
  setCurrentAgenda(agenda) {
    this.globalData.currentAgenda = agenda;
  }
});
