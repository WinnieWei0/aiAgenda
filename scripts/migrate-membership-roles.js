const cloud = require('../cloudfunctions/seedWorkbookData/node_modules/wx-server-sdk');

const SUPER_ADMIN_NAME = '韦文耐';
const ADMIN_NAMES = new Set(['冉桂竹', '徐欢欢', '张蝶花', '郭聪聪', '黎建安', '陈程']);

function roleForName(name) {
  if (name === SUPER_ADMIN_NAME) return 'super_admin';
  return ADMIN_NAMES.has(name) ? 'admin' : 'member';
}

async function run(superAdminOpenid) {
  if (!superAdminOpenid) throw new Error('请传入韦文耐的 openid：npm run migrate:membership-roles -- <openid>');
  const envId = process.env.CLOUDBASE_ENV_ID || 'ai-agenda-d1gxlfuz6843bbed0';
  const secretId = process.env.TENCENTCLOUD_SECRETID || process.env.TCB_SECRET_ID;
  const secretKey = process.env.TENCENTCLOUD_SECRETKEY || process.env.TCB_SECRET_KEY;
  if (!secretId || !secretKey) throw new Error('缺少 CloudBase 凭据');
  cloud.init({ env: envId, secretId, secretKey });
  const db = cloud.database();
  const collection = db.collection('memberships');
  const result = await collection.limit(1000).get();
  let updated = 0;
  for (const member of result.data || []) {
    const role = roleForName(member.nameZh || '');
    const data = { role, updatedAt: new Date().toISOString() };
    if (role === 'super_admin') data.openid = superAdminOpenid;
    await collection.doc(member._id).update({ data });
    updated += 1;
  }
  if (!(result.data || []).some((member) => member.nameZh === SUPER_ADMIN_NAME)) throw new Error('未找到韦文耐的会员记录');
  return { updated };
}

if (require.main === module) {
  run(process.argv[2]).then((result) => console.log(`角色迁移完成：${result.updated} 条`)).catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { SUPER_ADMIN_NAME, ADMIN_NAMES, roleForName, run };
