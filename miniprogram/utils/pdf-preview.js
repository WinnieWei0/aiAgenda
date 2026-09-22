function accessFile(fileSystem, filePath) {
  return new Promise((resolve, reject) => fileSystem.access({ path: filePath, success: resolve, fail: reject }));
}

function saveFile(fileSystem, tempFilePath, filePath) {
  return new Promise((resolve, reject) => fileSystem.saveFile({ tempFilePath, filePath, success: resolve, fail: reject }));
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
  const fileSystem = wxApi.getFileSystemManager();
  try {
    await accessFile(fileSystem, tempFilePath);
  } catch (error) {
    throw new Error('PDF 临时文件不存在，请重新预览');
  }
  let openPath = tempFilePath;
  const userDataPath = wxApi.env && wxApi.env.USER_DATA_PATH;
  if (userDataPath) {
    const safeName = String(fileName || 'agenda.pdf').replace(/[^a-zA-Z0-9._-]/g, '-');
    const savedPath = `${userDataPath}/${Date.now()}-${safeName}`;
    try {
      const saved = await saveFile(fileSystem, tempFilePath, savedPath);
      openPath = saved.savedFilePath || savedPath;
      await accessFile(fileSystem, openPath);
    } catch (error) {
      openPath = tempFilePath;
    }
  }
  try {
    await wxApi.openDocument({ filePath: openPath, fileType: 'pdf', showMenu: true });
  } catch (error) {
    throw new Error(`PDF 打开失败：${error && (error.errMsg || error.message) || '未知错误'}`);
  }
  return openPath;
}

module.exports = { openCloudPdf };
