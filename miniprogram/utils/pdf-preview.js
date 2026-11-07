function saveFile(fileSystem, tempFilePath, filePath) {
  return new Promise((resolve, reject) => fileSystem.saveFile({ tempFilePath, ...(filePath ? { filePath } : {}), success: resolve, fail: reject }));
}

function downloadUrl(wxApi, url) {
  return new Promise((resolve, reject) => wxApi.downloadFile({ url, success: resolve, fail: reject }));
}

function requestBytes(wxApi, url) {
  return new Promise((resolve, reject) => wxApi.request({ url, responseType: 'arraybuffer', success: resolve, fail: reject }));
}

function writeFile(fileSystem, filePath, data) {
  return new Promise((resolve, reject) => fileSystem.writeFile({ filePath, data, success: resolve, fail: reject }));
}

function isRemotePath(filePath) {
  return /^https?:\/\//i.test(String(filePath || ''));
}

function localFileName(fileName) {
  return String(fileName || 'agenda.pdf').replace(/[^a-zA-Z0-9._-]/g, '-');
}

async function persistentPath(wxApi, tempFilePath, fileName) {
  const fileSystem = wxApi.getFileSystemManager && wxApi.getFileSystemManager();
  if (!fileSystem || !fileSystem.saveFile) return tempFilePath;
  const userDataPath = wxApi.env && wxApi.env.USER_DATA_PATH;
  const filePath = userDataPath ? `${userDataPath}/${Date.now()}-${localFileName(fileName)}` : undefined;
  try {
    const saved = await saveFile(fileSystem, tempFilePath, filePath);
    return saved.savedFilePath || filePath || tempFilePath;
  } catch (error) {
    return tempFilePath;
  }
}

async function downloadFromCloudUrl(wxApi, fileID, fileName) {
  let url;
  try {
    const urls = await wxApi.cloud.getTempFileURL({ fileList: [fileID] });
    const file = urls.fileList && urls.fileList[0];
    if (!file || !file.tempFileURL || file.status && file.status !== 0) throw new Error('云文件地址获取失败');
    url = file.tempFileURL;
  } catch (error) {
    throw new Error(`PDF 云文件地址获取失败：${error && (error.errMsg || error.message) || '未知错误'}`);
  }
  if (wxApi.downloadFile) {
    try {
      const download = await downloadUrl(wxApi, url);
      if (download && download.statusCode && download.statusCode !== 200) throw new Error(`HTTP ${download.statusCode}`);
      if (download && download.tempFilePath && !isRemotePath(download.tempFilePath)) {
        return persistentPath(wxApi, download.tempFilePath, fileName);
      }
    } catch (error) {
      if (!wxApi.request) throw new Error(`PDF 下载失败：${error && (error.errMsg || error.message) || '未知错误'}`);
    }
  }
  const fileSystem = wxApi.getFileSystemManager && wxApi.getFileSystemManager();
  const userDataPath = wxApi.env && wxApi.env.USER_DATA_PATH;
  if (!wxApi.request || !fileSystem || !fileSystem.writeFile || !userDataPath) {
    throw new Error('PDF 下载返回了网页地址，当前环境无法保存为本地文件');
  }
  try {
    const response = await requestBytes(wxApi, url);
    if (response.statusCode && response.statusCode !== 200) throw new Error(`HTTP ${response.statusCode}`);
    const data = response.data;
    if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) throw new Error('下载内容不是 PDF 文件数据');
    const bytes = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    if (!bytes.byteLength) throw new Error('下载内容为空');
    const filePath = `${userDataPath}/${Date.now()}-${localFileName(fileName)}`;
    await writeFile(fileSystem, filePath, bytes);
    return filePath;
  } catch (error) {
    throw new Error(`PDF 本地保存失败：${error && (error.errMsg || error.message) || '未知错误'}`);
  }
}

async function getCloudPdfPath(wxApi, fileID, fileName) {
  if (!fileID) throw new Error('PDF 云文件标识为空，请重新生成预览');
  let download;
  try {
    download = await wxApi.cloud.downloadFile({ fileID });
  } catch (error) {
    throw new Error(`PDF 下载失败：${error && (error.errMsg || error.message) || '未知错误'}`);
  }
  const tempFilePath = download && download.tempFilePath;
  if (!tempFilePath) throw new Error('PDF 下载未返回本地文件路径');
  return isRemotePath(tempFilePath)
    ? downloadFromCloudUrl(wxApi, fileID, fileName)
    : persistentPath(wxApi, tempFilePath, fileName);
}

async function openCloudPdf(wxApi, fileID, fileName, options) {
  const openPath = await getCloudPdfPath(wxApi, fileID, fileName);
  try {
    await wxApi.openDocument({ filePath: openPath, fileType: 'pdf', showMenu: !options || options.showMenu !== false });
  } catch (error) {
    try {
      const retryPath = await downloadFromCloudUrl(wxApi, fileID, fileName);
      await wxApi.openDocument({ filePath: retryPath, fileType: 'pdf', showMenu: !options || options.showMenu !== false });
      return retryPath;
    } catch (retryError) {
      throw new Error(`PDF 打开失败：${retryError && (retryError.errMsg || retryError.message) || error && (error.errMsg || error.message) || '未知错误'}`);
    }
  }
  return openPath;
}

module.exports = { getCloudPdfPath, openCloudPdf };
