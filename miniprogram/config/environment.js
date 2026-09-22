const environments = {
  development: {
    envId: 'ai-agenda-prod-d0g7cdazf8d1e1695',
    label: 'development'
  },
  production: {
    envId: 'ai-agenda-prod-d0g7cdazf8d1e1695',
    label: 'production'
  }
};


const accountInfo = typeof wx !== 'undefined' && wx.getAccountInfoSync ? wx.getAccountInfoSync() : {};
const active = String(accountInfo.miniProgram && accountInfo.miniProgram.envVersion || 'develop').toLowerCase();
const environment = active === 'release' ? 'production' : 'development';

/**
 * 方法是什么：获取小程序运行环境配置。
 * 方法作用：按开发者工具/体验版/正式版选择隔离的 CloudBase 环境。
 * 为什么添加：新数据库必须与当前用户使用的旧环境完全分离。
 */
function getEnvironment() {
  const config = environments[environment];
  if (!config.envId) {
    throw new Error(`请在 miniprogram/config/environment.js 配置 ${environment} CloudBase 环境 ID`);
  }
  return config;
}

module.exports = { environments, environment, getEnvironment };
