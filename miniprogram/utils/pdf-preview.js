function saveFile(fileSystem, tempFilePath, filePath) {
  return new Promise((resolve, reject) => fileSystem.saveFile({ tempFilePath, ...(filePath ? { filePath } : {}), success: resolve, fail: reject }));
}

function downloadUrl(wxApi, url) {
  return new Promise((resolve, reject) => wxApi.downloadFile({ url, success: resolve, fail: reject }));
}

async function persistentPath(wxApi, tempFilePath, fileName) {
  const fileSystem = wxApi.getFileSystemManager && wxApi.getFileSystemManager();
  if (!fileSystem || !fileSystem.saveFile) return tempFilePath;
  const userDataPath = wxApi.env && wxApi.env.USER_DATA_PATH;
  const safeName = String(fileName || 'agenda.pdf').replace(/[^a-zA-Z0-9._-]/g, '-');
  const filePath = userDataPath ? `${userDataPath}/${Date.now()}-${safeName}` : undefined;
  try {
    const saved = await saveFile(fileSystem, tempFilePath, filePath);
    return saved.savedFilePath || filePath || tempFilePath;
  } catch (error) {
    return tempFilePath;
  }
}

async function openCloudPdf(wxApi, fileID, fileName) {
  if (!fileID) throw new Error('PDF 云文件标识为空，请重新生成预览');
  let download;
  try {
    download = await wxApi.cloud.downloadFile({ fileID });
  } catch (error) {
    throw new Error(`PDF 下载失败：${error && (error.errMsg || error.message) || '未知错误'}`);
  }
  const tempFilePath = download && download.tempFilePath;
  if (!tempFilePath) throw new Error('PDF 下载未返回本地文件路径');
  const openPath = await persistentPath(wxApi, tempFilePath, fileName);
  try {
    await wxApi.openDocument({ filePath: openPath, fileType: 'pdf', showMenu: true });
  } catch (error) {
    try {
      const urls = await wxApi.cloud.getTempFileURL({ fileList: [fileID] });
      const file = urls.fileList && urls.fileList[0];
      if (!file || !file.tempFileURL || file.status && file.status !== 0) throw new Error('云文件地址获取失败');
      const retry = await downloadUrl(wxApi, file.tempFileURL);
      if (!retry || retry.statusCode && retry.statusCode !== 200 || !retry.tempFilePath) throw new Error('PDF 重新下载失败');
      const retryPath = await persistentPath(wxApi, retry.tempFilePath, fileName);
      await wxApi.openDocument({ filePath: retryPath, fileType: 'pdf', showMenu: true });
      return retryPath;
    } catch (retryError) {
      throw new Error(`PDF 打开失败：${retryError && (retryError.errMsg || retryError.message) || error && (error.errMsg || error.message) || '未知错误'}`);
    }
  }
  return openPath;
}

module.exports = { openCloudPdf };
