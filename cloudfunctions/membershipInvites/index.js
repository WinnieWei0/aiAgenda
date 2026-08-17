const crypto = require('crypto');
const common = require('agenda-common');

const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

function publicMember(member) {
  return {
    _id: member._id,
    nameZh: member.nameZh || '',
    nameEn: member.nameEn || '',
    nickName: member.nickName || '',
    role: common.normalizeMembershipRole(member.role)
  };
}

function assertInviteUsable(invite, nowValue) {
  if (!invite) throw Object.assign(new Error('邀请不存在'), { code: 'INVITE_NOT_FOUND' });
  if (invite.status !== 'pending') throw Object.assign(new Error('邀请已使用'), { code: 'INVITE_USED' });
  if (new Date(invite.expiresAt).getTime() <= (nowValue || new Date()).getTime()) {
    throw Object.assign(new Error('邀请已过期'), { code: 'INVITE_EXPIRED' });
  }
}

async function listAvailableMembers() {
  const res = await common.getDb().collection('memberships').limit(100).get();
  return (res.data || [])
    .filter((member) => !member.openid)
    .sort((left, right) => String(left.nameZh || left.nameEn || '').localeCompare(String(right.nameZh || right.nameEn || ''), 'zh-CN'))
    .map(publicMember);
}

async function createInvite(memberId, creatorOpenid, nowValue) {
  await common.requireAdmin(creatorOpenid);
  const db = common.getDb();
  const memberRes = await db.collection('memberships').doc(memberId).get();
  const member = memberRes.data;
  if (!member) throw Object.assign(new Error('会员不存在'), { code: 'MEMBER_NOT_FOUND' });
  if (member.openid) throw Object.assign(new Error('该会员已绑定'), { code: 'MEMBER_BOUND' });
  const now = nowValue || new Date();
  const token = crypto.randomBytes(32).toString('hex');
  await (await common.ensureCollection('membership_invites')).add({
    data: {
      _id: token,
      token,
      memberId,
      creatorOpenid,
      status: 'pending',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString()
    }
  });
  return { token, expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString(), member: publicMember(member) };
}

async function getInvite(token, nowValue) {
  const res = await (await common.ensureCollection('membership_invites')).doc(token).get();
  const invite = res.data;
  assertInviteUsable(invite, nowValue);
  const memberRes = await common.getDb().collection('memberships').doc(invite.memberId).get();
  const member = memberRes.data;
  if (!member || member.openid) throw Object.assign(new Error('该会员已绑定'), { code: 'MEMBER_BOUND' });
  return { expiresAt: invite.expiresAt, member: publicMember(member) };
}

async function claimInvite(token, openid, nowValue) {
  const db = common.getDb();
  const now = nowValue || new Date();
  const existingMembership = await common.getMembershipByOpenid(openid);
  if (existingMembership) throw Object.assign(new Error('当前用户已绑定会员'), { code: 'OPENID_BOUND' });
  await common.ensureCollection('membership_identity_bindings');
  const bindingId = crypto.createHash('sha256').update(openid).digest('hex');
  const inviteCollection = db.collection('membership_invites');
  const inviteRes = await inviteCollection.doc(token).get();
  const invite = inviteRes.data;
  assertInviteUsable(invite, now);
  const claimedAt = now.toISOString();
  const reservation = await inviteCollection.where({ _id: invite._id, status: 'pending' }).update({
    data: { status: 'claiming', claimingByOpenid: openid, claimedAt }
  });
  const updated = reservation && reservation.stats ? Number(reservation.stats.updated || 0) : Number(reservation && reservation.updated || 0);
  if (!updated) {
    const latest = await inviteCollection.doc(token).get();
    assertInviteUsable(latest.data, now);
    throw Object.assign(new Error('邀请正在被领取，请稍后重试'), { code: 'INVITE_BUSY' });
  }

  let bindingCreated = false;
  let memberBound = false;
  try {
    const memberRes = await db.collection('memberships').doc(invite.memberId).get();
    const member = memberRes.data;
    if (!member) throw Object.assign(new Error('会员不存在'), { code: 'MEMBER_NOT_FOUND' });
    if (member.openid) throw Object.assign(new Error('该会员已绑定'), { code: 'MEMBER_BOUND' });

    try {
      await db.collection('membership_identity_bindings').add({ data: { _id: bindingId, openid, memberId: member._id, updatedAt: claimedAt } });
      bindingCreated = true;
    } catch (error) {
      const message = String(error && (error.errMsg || error.message) || '').toLowerCase();
      if (message.includes('duplicate') || message.includes('already exists') || message.includes('document exists')) {
        throw Object.assign(new Error('当前用户已绑定会员'), { code: 'OPENID_BOUND' });
      }
      throw error;
    }

    await db.collection('memberships').doc(member._id).update({ data: { openid, updatedAt: claimedAt } });
    memberBound = true;
    await inviteCollection.doc(invite._id).update({ data: { status: 'used', usedByOpenid: openid, usedAt: claimedAt, claimingByOpenid: db.command.remove(), claimedAt: db.command.remove() } });
    return { identity: common.membershipIdentity(Object.assign({}, member, { openid })) };
  } catch (error) {
    if (memberBound) {
      await db.collection('memberships').where({ _id: invite.memberId, openid }).update({ data: { openid: db.command.remove(), updatedAt: claimedAt } }).catch(() => {});
    }
    if (bindingCreated) {
      await db.collection('membership_identity_bindings').where({ _id: bindingId, openid, memberId: invite.memberId }).remove().catch(() => {});
    }
    await inviteCollection.where({ _id: invite._id, status: 'claiming', claimingByOpenid: openid }).update({ data: { status: 'pending', claimingByOpenid: db.command.remove(), claimedAt: db.command.remove() } }).catch(() => {});
    throw error;
  }
}

async function main(event) {
  try {
    common.initCloud();
    const action = event && event.action || 'get';
    const openid = common.getOpenid();
    if (action === 'available') {
      await common.requireAdmin(openid);
      return common.ok({ list: await listAvailableMembers() });
    }
    if (action === 'create') return common.ok(await createInvite(event.memberId, openid));
    if (action === 'get') return common.ok(await getInvite(event.token));
    if (action === 'claim') return common.ok(await claimInvite(event.token, openid));
    return common.fail('UNKNOWN_ACTION', '不支持的邀请操作');
  } catch (error) {
    return common.handleError(error);
  }
}

module.exports = { INVITE_TTL_MS, publicMember, assertInviteUsable, listAvailableMembers, createInvite, getInvite, claimInvite, main };
exports.main = main;
