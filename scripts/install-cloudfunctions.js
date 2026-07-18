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
  const requested = new Set(process.argv.slice(2));
  const entries = fs.readdirSync(CLOUD_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dir = path.join(CLOUD_DIR, entry.name);
    if (fs.existsSync(path.join(dir, 'package.json')) && (!requested.size || requested.has(entry.name))) {
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
  if (path.basename(dir) !== 'common' && path.basename(dir) !== 'exportAgendaPdf') {
    const obsoletePdfPackages = ['pdf-lib', '@pdf-lib', 'pako'];
    for (const packageName of obsoletePdfPackages) {
      fs.rmSync(path.join(dir, 'node_modules', packageName), { recursive: true, force: true });
    }
  }
  refreshLocalDependencies(dir);
}

/**
 * 方法是什么：刷新云函数的本地公共包副本。
 * 方法作用：把 `file:` 依赖从当前源码目录复制到云函数的 node_modules 中。
 * 为什么添加：npm 在版本号不变时可能保留旧副本，导致公共解析或 DeepSeek 修复没有进入部署包。
 */
function refreshLocalDependencies(dir) {
  const packageJsonPath = path.join(dir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const dependencies = Object.assign({}, packageJson.dependencies, packageJson.devDependencies);
  for (const [name, spec] of Object.entries(dependencies)) {
    if (typeof spec !== 'string' || !spec.startsWith('file:')) {
      continue;
    }
    const source = path.resolve(dir, spec.slice('file:'.length));
    const target = path.join(dir, 'node_modules', name);
    if (!fs.existsSync(source)) {
      throw new Error(`本地依赖不存在：${source}`);
    }
    fs.rmSync(target, { recursive: true, force: true });
    const includePdfFiles = path.basename(dir) === 'exportAgendaPdf';
    const entries = ['index.js', 'parser.js', 'deepseek.js', 'agenda-model.js', 'package.json'];
    if (includePdfFiles) {
      entries.push('pdf-renderer.js', 'fonts', 'assets');
    }
    fs.mkdirSync(target, { recursive: true });
    for (const entry of entries) {
      const entrySource = path.join(source, entry);
      if (fs.existsSync(entrySource)) {
        fs.cpSync(entrySource, path.join(target, entry), { recursive: true, dereference: true });
      }
    }
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
