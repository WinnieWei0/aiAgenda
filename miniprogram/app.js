App({
  globalData: {
    envId: 'ai-agenda-d1gxlfuz6843bbed0',
    user: null,
    roles: [],
    canClaimAdmin: false,
    isSuperAdminMode: false,
    currentAgenda: null
  },

  /**
   * 方法是什么：小程序启动生命周期方法。
   * 方法作用：初始化云开发环境，并尝试完成用户登录。
   * 为什么添加：所有页面都依赖云函数和用户身份，启动时统一准备可以减少页面重复逻辑。
   */
  async onLaunch() {
    this.initCloud();
    await this.login();
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
    wx.cloud.init({
      env: this.globalData.envId,
      traceUser: true
    });
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
        data: { profile: profile || {} }
      });
      if (res.result && res.result.ok) {
        this.globalData.user = res.result.data.user;
        this.globalData.roles = res.result.data.roles || [];
        this.globalData.canClaimAdmin = Boolean(res.result.data.canClaimAdmin);
      }
    } catch (error) {
      console.warn('登录失败', error);
    }
  },

  /**
   * 方法是什么：判断当前用户是否为管理员。
   * 方法作用：检查全局角色列表中是否包含 `admin`。
   * 为什么添加：多个页面都需要根据管理员身份展示或隐藏管理能力。
   */
  isAdmin() {
    return this.globalData.roles.indexOf('admin') >= 0;
  },

  /**
   * 方法是什么：切换模拟超管模式。
   * 方法作用：在当前小程序运行期间切换普通会员与模板超管界面。
   * 为什么添加：本期明确只需要前端模拟身份，不做角色授权或持久化。
   */
  toggleSuperAdminMode() {
    this.globalData.isSuperAdminMode = !this.globalData.isSuperAdminMode;
    return this.globalData.isSuperAdminMode;
  },

  /**
   * 方法是什么：判断是否处于模拟超管模式。
   * 方法作用：供首页、编辑器和模板页面统一控制可编辑字段。
   * 为什么添加：模拟状态不能继续复用数据库中的 admin 角色。
   */
  isSuperAdminMode() {
    return Boolean(this.globalData.isSuperAdminMode);
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
