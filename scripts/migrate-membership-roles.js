const cloud = require('../cloudfunctions/seedWorkbookData/node_modules/wx-server-sdk');

/**
 * 方法是什么：规范化会员角色。
 * 方法作用：只使用数据库已有角色，不再通过姓名白名单推断权限。
 * 为什么添加：权限属于数据配置，代码不应包含真实身份信息。
 */
function roleForName(role) {
  return ['super_admin', 'admin', 'member'].includes(role) ? role : 'member';
}

async function run(superAdminOpenid) {
  if (!superAdminOpenid) throw new Error('请传入管理员 openid：npm run migrate:membership-roles -- <openid>');
  const envId = process.env.TARGET_CLOUDBASE_ENV_ID || process.env.CLOUDBASE_ENV_ID || '';
  if (!envId) throw new Error('请设置 TARGET_CLOUDBASE_ENV_ID');
  const secretId = process.env.TENCENTCLOUD_SECRETID || process.env.TCB_SECRET_ID;
  const secretKey = process.env.TENCENTCLOUD_SECRETKEY || process.env.TCB_SECRET_KEY;
  if (!secretId || !secretKey) throw new Error('缺少 CloudBase 凭据');
  cloud.init({ env: envId, secretId, secretKey });
  const db = cloud.database();
  const collection = db.collection(`${process.env.DB_COLLECTION_PREFIX || 'app_'}club_members`);
  const result = await collection.limit(1000).get();
  let updated = 0;
  for (const member of result.data || []) {
    const role = roleForName(member.role);
    const data = { role, updatedAt: new Date().toISOString() };
    if (role === 'super_admin') data.openid = superAdminOpenid;
    await collection.doc(member._id).update({ data });
    updated += 1;
  }
  if (!(result.data || []).some((member) => roleForName(member.role) === 'super_admin')) throw new Error('未找到超管角色记录');
  return { updated };
}

if (require.main === module) {
  run(process.argv[2]).then((result) => console.log(`角色迁移完成：${result.updated} 条`)).catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { roleForName, run };
