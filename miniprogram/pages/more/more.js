Page({
  data: { contactWechat: 'a15078646220' },

  /**
   * 方法是什么：复制俱乐部合作微信号。
   * 方法作用：将联系人微信写入剪贴板，并提示用户复制结果。
   * 为什么添加：方便用户直接联系俱乐部合作联系人。
   */
  copyWechat() {
    wx.setClipboardData({
      data: this.data.contactWechat,
      success: () => wx.showToast({ title: '微信号已复制', icon: 'success' })
    });
  }
});
