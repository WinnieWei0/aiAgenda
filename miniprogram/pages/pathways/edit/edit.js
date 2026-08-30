const cloud = require('../../../utils/cloud');

/**
 * 方法是什么：格式化路径记录时间。
 * 方法作用：把数据库 ISO 时间转换为本地年月日时分秒。
 * 为什么添加：管理页面不应直接显示难以阅读的 ISO 时间字符串。
 */
function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * 方法是什么：从项目代码推导等级。
 * 方法作用：在隐藏等级输入项后，为新项目补齐可搜索的等级字段。
 * 为什么添加：Pathways 代码本身包含等级，新增项目不能因为隐藏字段而丢失等级信息。
 */
function levelFromCode(code) {
  const match = String(code || '').trim().match(/^L(\d+)/i);
  return match ? `Level ${match[1]}` : '';
}

Page({
  data: {
    id: '',
    isEdit: false,
    saving: false,
    formattedCreatedAt: '',
    formattedUpdatedAt: '',
    pathway: {
      code: '',
      createdAt: '',
      fullLabelEn: '',
      fullLabelZh: '',
      level: '',
      objectiveEn: '',
      objectiveZh: '',
      searchText: '',
      updatedAt: ''
    }
  },

  /**
   * 方法是什么：加载路径编辑页。
   * 方法作用：根据 ID 判断新增或编辑模式。
   * 为什么添加：同一表单需要支持路径数据 CRUD。
   */
  async onLoad(options) {
    const id = options && options.id ? options.id : '';
    this.setData({ id, isEdit: Boolean(id) });
    if (id) {
      await this.loadPathway(id);
    }
  },

  /**
   * 方法是什么：加载路径详情。
   * 方法作用：读取数据库中的完整路径字段。
   * 为什么添加：编辑页必须展示用户要求的全部字段。
   */
  async loadPathway(id) {
    try {
      const data = await cloud.callCloud('adminPathways', { action: 'get', id });
      if (data.record) {
        this.setData({
          pathway: Object.assign({}, this.data.pathway, data.record),
          formattedCreatedAt: formatDateTime(data.record.createdAt),
          formattedUpdatedAt: formatDateTime(data.record.updatedAt)
        });
      }
    } catch (error) {
      cloud.showError(error);
    }
  },

  /**
   * 方法是什么：处理路径输入。
   * 方法作用：更新路径字段草稿。
   * 为什么添加：表单需要持续保存用户正在编辑的值。
   */
  handleInput(event) {
    const field = event.currentTarget.dataset.field;
    const pathway = Object.assign({}, this.data.pathway, { [field]: event.detail.value });
    this.setData({ pathway });
  },

  /**
   * 方法是什么：保存路径。
   * 方法作用：调用白名单保存接口并返回列表页。
   * 为什么添加：编辑结果必须写回 Pathways 集合。
   */
  async savePathway() {
    this.setData({ saving: true });
    try {
      const pathway = Object.assign({}, this.data.pathway);
      if (!String(pathway.level || '').trim()) {
        pathway.level = levelFromCode(pathway.code);
      }
      await cloud.callCloud('adminPathways', { action: 'save', pathway });
      cloud.showSuccess('已保存');
      wx.navigateBack();
    } catch (error) {
      cloud.showError(error);
    } finally {
      this.setData({ saving: false });
    }
  },

  /**
   * 方法是什么：取消路径编辑。
   * 方法作用：放弃当前草稿并返回路径列表。
   * 为什么添加：新增和编辑都需要明确的取消入口。
   */
  cancelEdit() {
    wx.navigateBack();
  }
});
