const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REQUIRED_PHRASES = ['方法是什么：', '方法作用：', '为什么添加：'];
const IGNORE_DIRS = new Set(['node_modules', 'miniprogram_npm', '.git']);
const RESERVED_WORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function']);

/**
 * 方法是什么：判断目录是否应该跳过扫描。
 * 方法作用：过滤依赖目录、微信构建产物和 Git 元数据。
 * 为什么添加：注释检查只应覆盖项目源码，扫描依赖会产生大量无意义报错。
 */
function shouldIgnoreDir(name) {
  return IGNORE_DIRS.has(name);
}

/**
 * 方法是什么：递归收集项目里的 JavaScript 文件。
 * 方法作用：遍历源码目录并返回所有需要检查注释的 `.js` 文件路径。
 * 为什么添加：提交前必须自动发现新增文件，不能依赖人工维护检查列表。
 */
function collectJsFiles(dir) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!shouldIgnoreDir(entry.name)) {
        files.push(...collectJsFiles(fullPath));
      }
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * 方法是什么：判断指定行之前是否存在三段式中文注释。
 * 方法作用：向上查找最近的块注释，并检查三个必需短语是否齐全。
 * 为什么添加：只检查有无注释不够，必须确保注释写清楚是什么、作用和添加原因。
 */
function hasRequiredComment(lines, lineIndex) {
  const start = Math.max(0, lineIndex - 10);
  const context = lines.slice(start, lineIndex).join('\n');
  const blockStart = context.lastIndexOf('/**');
  const blockEnd = context.lastIndexOf('*/');
  if (blockStart < 0 || blockEnd < blockStart) {
    return false;
  }
  const block = context.slice(blockStart, blockEnd + 2);
  for (const phrase of REQUIRED_PHRASES) {
    if (!block.includes(phrase)) {
      return false;
    }
  }
  return true;
}

/**
 * 方法是什么：查找文件中的方法定义行。
 * 方法作用：识别顶层函数声明和 Page/App 对象中的方法写法。
 * 为什么添加：小程序项目既有普通工具函数，也有页面生命周期和事件方法，需要同时覆盖。
 */
function findMethodLines(content) {
  const lines = content.split(/\r?\n/);
  const methods = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const topLevelFunction = /^(async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.test(line);
    const pageMatch = line.match(/^\s{2}(async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/);
    const pageMethod = Boolean(pageMatch && !RESERVED_WORDS.has(pageMatch[2]));
    if (topLevelFunction || pageMethod) {
      methods.push({ line: index + 1, text: line.trim() });
    }
  }
  return methods;
}

/**
 * 方法是什么：检查单个文件的方法注释。
 * 方法作用：返回缺少三段式中文注释的方法位置。
 * 为什么添加：错误信息需要定位到具体文件和行号，方便开发者快速修复。
 */
function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const methods = findMethodLines(content);
  const failures = [];
  for (const method of methods) {
    if (!hasRequiredComment(lines, method.line - 1)) {
      failures.push({ filePath, line: method.line, text: method.text });
    }
  }
  return failures;
}

/**
 * 方法是什么：运行全项目注释检查。
 * 方法作用：扫描所有 JS 文件并在发现缺失注释时退出失败。
 * 为什么添加：用户要求每个方法都写清楚中文注释，自动检查可以防止后续遗漏。
 */
function main() {
  const files = collectJsFiles(ROOT);
  const failures = [];
  for (const file of files) {
    failures.push(...checkFile(file));
  }
  if (failures.length) {
    console.error('以下方法缺少三段式中文注释：');
    for (const failure of failures) {
      console.error(`${path.relative(ROOT, failure.filePath)}:${failure.line} ${failure.text}`);
    }
    process.exit(1);
  }
  console.log(`注释检查通过，共扫描 ${files.length} 个 JS 文件。`);
}

main();
