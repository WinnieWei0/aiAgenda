const cloud = require('./cloud');

/**
 * 方法是什么：等待用户选择 Excel 文件。
 * 方法作用：打开微信文件选择器并返回用户选中的单个工作簿。
 * 为什么添加：小程序不能直接读取电脑或手机文件，必须通过微信文件选择器获取临时路径。
 */
function chooseWorkbookFile() {
  return new Promise(function chooseFilePromise(resolve, reject) {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      success(result) {
        const file = result && result.tempFiles && result.tempFiles[0];
        if (!file) {
          const error = new Error('没有选择文件');
          error.code = 'NO_FILE';
          reject(error);
          return;
        }
        resolve(file);
      },
      fail(error) {
        if (error && error.errMsg && error.errMsg.includes('cancel')) {
          const cancelError = new Error('已取消文件选择');
          cancelError.code = 'CANCELLED';
          reject(cancelError);
          return;
        }
        reject(error || new Error('文件选择失败'));
      }
    });
  });
}

/**
 * 方法是什么：上传 Excel 并调用导入云函数。
 * 方法作用：把本地工作簿临时上传到云存储，解析后写入 Membership 和 Pathways 集合。
 * 为什么添加：数据导入必须以用户选中的 Excel 为唯一来源，并且不应让前端直接操作数据库。
 */
async function importWorkbook() {
  const file = await chooseWorkbookFile();
  const filePath = file.path || file.tempFilePath;
  const fileName = file.name || filePath || '';
  if (!filePath || !/\.(xlsx|xls)$/i.test(fileName)) {
    const error = new Error('请选择 .xlsx 或 .xls 格式的 Excel 文件');
    error.code = 'INVALID_FILE_TYPE';
    throw error;
  }
  wx.showLoading({ title: '正在导入' });
  let fileID = '';
  try {
    const extension = fileName.toLowerCase().endsWith('.xls') ? 'xls' : 'xlsx';
    const upload = await wx.cloud.uploadFile({
      cloudPath: `workbooks/import-${Date.now()}.${extension}`,
      filePath
    });
    fileID = upload.fileID;
    return await cloud.callCloud('seedWorkbookData', { fileID });
  } finally {
    wx.hideLoading();
    if (fileID) {
      try {
        await wx.cloud.deleteFile({ fileList: [fileID] });
      } catch (error) {
        // 临时文件清理失败不影响已经完成的数据导入。
      }
    }
  }
}

module.exports = {
  importWorkbook
};
