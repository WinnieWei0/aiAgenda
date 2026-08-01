const cloud = require('../../utils/cloud');

Page({
  data: {
    agendaId: '',
    fileID: '',
    tempFilePath: '',
    loading: true,
    opening: false,
    exporting: false,
    loadFailed: false
  },

  /**
   * 方法是什么：创建并打开 PDF 预览快照。
   * 方法作用：进入页面时只生成一次 PDF，并直接使用系统文档查看器显示该文件。
   * 为什么添加：预览必须查看最终导出文件本身，不能再由 WXML 近似模拟 PDF 版式。
   */
  async onLoad(options) {
    const agendaId = options && options.id ? options.id : '';
    this.setData({ agendaId });
    if (!agendaId) {
      this.setData({ loading: false, loadFailed: true });
      wx.showToast({ title: '请先保存议程', icon: 'none' });
      return;
    }
    await this.createSnapshot(true);
  },

  /**
   * 方法是什么：生成当前议程的不可变 PDF 快照。
   * 方法作用：调用一次 PDF 云函数并缓存云文件 ID 与本地临时路径，供预览和导出共同使用。
   * 为什么添加：如果预览和导出分别生成文件，期间的数据或模板变化会造成内容不一致。
   */
  async createSnapshot(openAfterCreate) {
    if (this.data.loading && this.data.fileID) {
      return;
    }
    this.setData({ loading: true, loadFailed: false });
    try {
      const data = await cloud.callCloud('exportAgendaPdf', { agendaId: this.data.agendaId });
      const download = await wx.cloud.downloadFile({ fileID: data.fileID });
      this.setData({
        fileID: data.fileID,
        tempFilePath: download.tempFilePath,
        loading: false
      });
      if (openAfterCreate) {
        await this.openSnapshot(false);
      }
    } catch (error) {
      this.setData({ loading: false, loadFailed: true });
      cloud.showError(error);
    }
  },

  /**
   * 方法是什么：取得快照的本地文件路径。
   * 方法作用：优先复用已下载文件，临时文件失效时只重新下载同一个云文件而不重新生成 PDF。
   * 为什么添加：页面停留较久后临时路径可能失效，但导出仍必须对应最初预览的快照。
   */
  async getSnapshotPath() {
    if (this.data.tempFilePath) {
      return this.data.tempFilePath;
    }
    if (!this.data.fileID) {
      return '';
    }
    const download = await wx.cloud.downloadFile({ fileID: this.data.fileID });
    this.setData({ tempFilePath: download.tempFilePath });
    return download.tempFilePath;
  },

  /**
   * 方法是什么：打开已生成的 PDF 快照。
   * 方法作用：预览时隐藏系统导出菜单，正式导出时对同一文件开启菜单。
   * 为什么添加：两种操作复用完全相同的文件内容，仅开放的系统操作不同。
   */
  async openSnapshot(showMenu) {
    if (this.data.opening || this.data.exporting) {
      return;
    }
    const stateField = showMenu ? 'exporting' : 'opening';
    this.setData({ [stateField]: true });
    try {
      const filePath = await this.getSnapshotPath();
      if (!filePath) {
        wx.showToast({ title: 'PDF 快照尚未生成', icon: 'none' });
        return;
      }
      await wx.openDocument({ filePath, fileType: 'pdf', showMenu });
    } catch (error) {
      cloud.showError(error);
    } finally {
      this.setData({ [stateField]: false });
    }
  },

  /**
   * 方法是什么：重新预览 PDF 快照。
   * 方法作用：打开首次进入页面时生成的同一文件，不请求新的 PDF。
   * 为什么添加：用户关闭系统查看器后需要能够再次核对快照内容。
   */
  previewPdf() {
    return this.openSnapshot(false);
  },

  /**
   * 方法是什么：导出当前 PDF 快照。
   * 方法作用：为已经预览的同一文件打开系统菜单，以便保存、转发或用其他应用打开。
   * 为什么添加：复用快照才能严格保证导出内容与用户确认的预览一致。
   */
  exportPdf() {
    return this.openSnapshot(true);
  }
});
