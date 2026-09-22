const COLLECTIONS = {
  clubs: 'clubs',
  users: 'users',
  memberships: 'club_members',
  pathways: 'club_pathways',
  agendas: 'meetings',
  agendaSignups: 'meeting_signups',
  agendaSignupClaims: 'meeting_signup_claims',
  agendaTemplates: 'club_templates',
  membershipInvites: 'membership_invites',
  membershipIdentityBindings: 'membership_identity_bindings',
  roles: 'roles',
  pdfExports: 'pdf_exports'
};

const ENVIRONMENT = String(process.env.APP_ENV || process.env.NODE_ENV || 'development').toLowerCase() === 'production'
  ? 'production'
  : 'development';

const DEFAULT_PREFIX = ENVIRONMENT === 'production' ? 'prod_' : 'dev_';
const COLLECTION_PREFIX = String(process.env.DB_COLLECTION_PREFIX || DEFAULT_PREFIX).trim();

/**
 * 方法是什么：读取当前部署环境配置。
 * 方法作用：集中定义开发/生产环境和新数据库的命名空间。
 * 为什么添加：旧环境必须保持只读，所有新代码需要显式写入隔离集合。
 */
function getConfig() {
  return {
    environment: ENVIRONMENT,
    collectionPrefix: COLLECTION_PREFIX,
    clubId: String(process.env.DEFAULT_CLUB_ID || 'default-club').trim()
  };
}

/**
 * 方法是什么：把逻辑集合转换为物理集合名。
 * 方法作用：为新环境集合增加 dev_/prod_ 命名空间，同时兼容显式逻辑名。
 * 为什么添加：领域服务不应散落硬编码集合名，便于未来更换环境或迁移策略。
 */
function resolveCollection(logicalName) {
  const config = getConfig();
  const value = COLLECTIONS[logicalName] || logicalName;
  return `${config.collectionPrefix}${value}`;
}

module.exports = { COLLECTIONS, getConfig, resolveCollection };
