/**
 * 方法是什么：调用 CloudBase 云函数并解析标准响应。
 * 方法作用：统一处理 `{ ok, data, error }` 返回结构，失败时抛出错误。
 * 为什么添加：所有页面都会调用云函数，封装后可以保持错误处理一致。
 */
async function callCloud(name, data) {
  let res;
  try {
    res = await wx.cloud.callFunction({
      name,
      data: data || {}
    });
  } catch (error) {
    const code = error && (error.errCode || error.code) ? ` (${error.errCode || error.code})` : '';
    const detail = error && (error.errMsg || error.message) ? `：${error.errMsg || error.message}` : '';
    throw new Error(`${name} 云函数调用失败${code}${detail}`);
  }
  if (!res.result || !res.result.ok) {
    const message = res.result && res.result.error ? res.result.error.message : '云函数调用失败';
    throw new Error(`${name}：${message}`);
  }
  return res.result.data;
}

/**
 * 方法是什么：展示页面错误提示。
 * 方法作用：把异常对象转换成微信 Toast。
 * 为什么添加：用户操作失败时需要得到明确反馈，而不是只在控制台报错。
 */
function showError(error) {
  const rawMessage = error && error.message ? error.message : '操作失败';
  const isDeploymentError = /-504002|FUNCTIONS_EXECUTE_FAIL|SyntaxError: Invalid or unexpected token/i.test(rawMessage);
  wx.showToast({
    title: isDeploymentError ? '云函数部署异常，请重新部署' : rawMessage,
    icon: 'none',
    duration: 2600
  });
  if (typeof console !== 'undefined' && console.error) {
    console.error(error);
  }
}

/**
 * 方法是什么：展示普通成功提示。
 * 方法作用：用统一样式提示保存、导出、初始化等操作完成。
 * 为什么添加：不同页面的成功反馈保持一致，会让小程序体验更稳定。
 */
function showSuccess(title) {
  wx.showToast({
    title: title || '操作成功',
    icon: 'success'
  });
}

module.exports = {
  callCloud,
  showError,
  showSuccess
};
