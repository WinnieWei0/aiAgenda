const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CLOUD_DIR = path.join(ROOT, 'cloudfunctions');

/**
 * 方法是什么：查找所有包含 package.json 的云函数目录。
 * 方法作用：遍历 `cloudfunctions` 下的一级目录并返回需要安装依赖的路径。
 * 为什么添加：每个云函数独立部署时都需要自己的依赖，自动发现可以避免漏装。
 */
function findCloudFunctionDirs() {
  const dirs = [];
  const entries = fs.readdirSync(CLOUD_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dir = path.join(CLOUD_DIR, entry.name);
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      dirs.push(dir);
    }
  }
  return dirs;
}

/**
 * 方法是什么：在指定目录执行 npm install。
 * 方法作用：为单个云函数安装 package.json 中声明的依赖，并把本地 file 依赖复制为真实目录。
 * 为什么添加：CloudBase 部署前需要确保本地依赖完整，`--install-links` 可以避免 Windows junction 在上传时被打包坏。
 */
function installInDir(dir) {
  console.log(`安装依赖：${path.relative(ROOT, dir)}`);
  const result = spawnSync('npm', ['install', '--install-links'], {
    cwd: dir,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (result.status !== 0) {
    throw new Error(`依赖安装失败：${dir}`);
  }
}

/**
 * 方法是什么：安装所有云函数依赖。
 * 方法作用：依次进入每个云函数目录执行 npm install。
 * 为什么添加：部署前一条命令准备所有依赖，减少手动操作错误。
 */
function main() {
  const dirs = findCloudFunctionDirs();
  for (const dir of dirs) {
    installInDir(dir);
  }
  console.log(`已处理 ${dirs.length} 个云函数目录。`);
}

main();
