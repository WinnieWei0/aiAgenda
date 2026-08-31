const common = require('agenda-common');
const CURRENT_AGENDA_ID = common.CURRENT_AGENDA_ID || 'current';

const EN_ROLE_LABELS = {
  guestReception: 'SAA（Guest）', memberReception: 'SAA（Member）', photographer: 'Photographer',
  ahCounter: 'Ah-Counter', toastmaster: 'TOM', timer: 'Timer', grammarian: 'Grammarian',
  generalEvaluator: 'General Evaluator', tableTopicsMaster: 'Table Topics Master',
  tableTopicsEvaluator: 'Table Topics Evaluator', preparedSpeaker: 'Prepared Speaker',
  preparedEvaluator: 'IE', icebreaker: 'Icebreaker', workshop: 'Workshop Facilitator'
};

function displayRoleLabel(roleKey, label, language) {
  if (common.signup && typeof common.signup.displayRoleLabel === 'function') {
    return common.signup.displayRoleLabel(roleKey, label, language);
  }
  return language === 'en' ? EN_ROLE_LABELS[roleKey] || label : label;
}

function canCreateSession(record, openid, membership, admin) {
  return Boolean(record && (membership || record.ownerOpenid === openid || admin));
}

function profileFromEvent(event, member) {
  const kind = event.personType;
  if (!['member', 'club', 'guest'].includes(kind)) throw Object.assign(new Error('请选择报名身份'), { code: 'INVALID_PROFILE' });
  if (kind === 'member') {
    if (!member) throw Object.assign(new Error('请选择双语会员'), { code: 'MEMBER_NOT_FOUND' });
    return { personType: kind, memberId: member._id, name: member.nameZh || member.nameEn || member.nickName, displayNameZh: member.nameZh || member.nickName, displayNameEn: member.nameEn || member.nameZh, club: '广州双语', clubEn: 'Guangzhou Bilingual', educationAwards: member.educationAwards || '', officerTitleZh: member.officerTitleZh || '', officerTitleEn: member.officerTitleEn || '' };
  }
  const name = String(event.name || '').trim();
  const club = String(event.club || '').trim();
  if (!name || kind === 'club' && !club) throw Object.assign(new Error(kind === 'club' ? '请填写姓名和俱乐部' : '请填写姓名'), { code: 'INVALID_PROFILE' });
  return { personType: kind, memberId: '', name, club: kind === 'club' ? club : '宾客', clubEn: kind === 'club' ? club : 'Guest' };
}

async function getCurrentAgenda(db, options = {}) {
  const res = await db.collection('agendas').where({ _id: CURRENT_AGENDA_ID }).limit(1).get();
  const record = res.data && res.data[0];
  const meetingNo = record && record.agenda && record.agenda.meetingInfo && String(record.agenda.meetingInfo.meetingNo || '').trim();
  if (!record || !options.allowEmpty && !meetingNo) {
    throw Object.assign(new Error('当前会议尚未开放报名'), { code: 'SIGNUP_NOT_FOUND' });
  }
  return Object.assign({}, record, { _id: CURRENT_AGENDA_ID });
}

async function response(db, record, openid) {
  const signups = await db.collection('agenda_signups').where({ agendaId: record._id }).get();
  const list = signups.data || [];
  const signupBySlot = new Map(list.filter((item) => item.slotId).map((item) => [item.slotId, item]));
  const claimResult = await db.collection('agenda_signup_claims').where({ agendaId: record._id }).get();
  for (const claim of claimResult.data || []) {
    const hasSignup = list.some((item) => item.claimId === claim._id || item.slotId === claim.slotId);
    const age = claim.createdAt ? Date.now() - new Date(claim.createdAt).getTime() : Infinity;
    if (!hasSignup && age > 30000 && (typeof claim._id === 'string' || typeof claim._id === 'number')) {
      await db.collection('agenda_signup_claims').doc(claim._id).remove();
    }
  }
  const language = record.agenda.meetingInfo && record.agenda.meetingInfo.language === 'en' ? 'en' : 'zh';
  const people = new Map();
  list.forEach((item) => {
    const key = common.signup.signupPersonKey(item);
    const current = people.get(key) || { key, name: language === 'en' ? item.displayNameEn || item.name : item.name, memberId: item.memberId || '', personType: item.personType, club: language === 'en' ? item.clubEn || item.club : item.club, roles: [], attendanceOnly: false, mine: item.openid === openid };
    if (item.slotId) {
      const slot = (record.signupSlots || []).find((value) => value.id === item.slotId);
      current.roles.push({ signupId: item._id, slotId: item.slotId, label: displayRoleLabel(slot && slot.roleKey, item.roleLabel, language), mine: current.mine });
    }
    else { current.attendanceOnly = true; current.attendanceSignupId = item._id; }
    people.set(key, current);
  });
  const slots = (record.signupSlots || []).map((slot) => {
    const signupItem = signupBySlot.get(slot.id);
    const occupied = Boolean(slot.preset && slot.occupied || signupItem);
    return Object.assign({}, slot, {
      occupied,
      signupId: signupItem && signupItem._id || slot.signupId || '',
      signupOpenid: signupItem && signupItem.openid || slot.signupOpenid || '',
      mine: Boolean(signupItem && signupItem.openid === openid),
      person: signupItem ? common.signup.personFromProfile(signupItem) : slot.person,
      displayLabel: displayRoleLabel(slot.roleKey, slot.label, language),
      allowedPersonTypes: common.signup.allowedPersonTypes(slot.roleKey),
      accessLabel: language === 'en'
        ? (common.signup.allowedPersonTypes(slot.roleKey).includes('guest') ? 'Member/Guest' : 'Member')
        : (common.signup.allowedPersonTypes(slot.roleKey).includes('guest') ? '会员/宾客' : '会员')
    });
  });
  slots.filter((slot) => slot.preset && slot.occupied && slot.person).forEach((slot) => {
    const name = language === 'en' ? slot.person.displayNameEn || slot.person.rawName || 'Organizer preset' : slot.person.displayNameZh || slot.person.rawName || '组织者预设';
    const key = `preset:${name}`;
    const current = people.get(key) || { key, name, personType: 'preset', club: language === 'en' ? slot.person.clubEn || '' : slot.person.clubZh || '', roles: [], attendanceOnly: false, mine: false };
    current.roles.push({ slotId: slot.id, label: displayRoleLabel(slot.roleKey, slot.label, language), mine: false });
    people.set(key, current);
  });
  const preparation = (record.agenda.sections || []).find((section) => section.id === 'preparation');
  const manager = preparation && preparation.row && preparation.row.person || {};
  const template = await common.getAgendaTemplate();
  const locales = template.locales || {};
  const locale = locales[language] || {};
  const localizedVenue = locale.fixedContent && locale.fixedContent.venue || '';
  const zhVenue = locales.zh && locales.zh.fixedContent && locales.zh.fixedContent.venue || '';
  const templateVenue = language === 'en'
    ?zhVenue: localizedVenue;
  return { publicId: CURRENT_AGENDA_ID, agendaId: CURRENT_AGENDA_ID, meetingInfo: record.agenda.meetingInfo, language, templateVenue, meetingManagerName: language === 'en' ? manager.displayNameEn || manager.rawName || 'To be filled' : manager.displayNameZh || manager.rawName || '待填写', slots, remainingRoles: slots.filter((s) => !s.occupied).length, attendeeCount: people.size, people: Array.from(people.values()), myOpenid: openid };
}

async function createSession(db, openid) {
  const record = await getCurrentAgenda(db);
  const membership = await common.getMembershipByOpenid(openid);
  if (!canCreateSession(record, openid, membership, await common.isAdmin(openid))) throw Object.assign(new Error('无权创建报名页'), { code: 'FORBIDDEN' });
  const slots = common.signup.mergeSlots(record.signupSlots, record.agenda);
  await db.collection('agendas').doc(CURRENT_AGENDA_ID).update({ data: { signupPublicId: CURRENT_AGENDA_ID, signupSlots: slots, signupVersion: Number(record.signupVersion || 0) + 1, updatedAt: new Date().toISOString() } });
  return response(db, Object.assign({}, record, { _id: CURRENT_AGENDA_ID, signupPublicId: CURRENT_AGENDA_ID, signupSlots: slots }), openid);
}

async function signup(db, openid, event) {
  const record = await getCurrentAgenda(db);
  let member = null;
  if (event.personType === 'member') { const res = await db.collection('memberships').doc(event.memberId).get(); member = res.data; }
  const profile = profileFromEvent(event, member);
  const now = new Date().toISOString();
  if (!event.slotId) {
    const existing = await db.collection('agenda_signups').where({ agendaId: record._id, openid, slotId: '' }).limit(1).get();
    if (!existing.data.length) await db.collection('agenda_signups').add({ data: Object.assign({ agendaId: record._id, openid, slotId: '', roleLabel: '', createdAt: now, updatedAt: now }, profile) });
    return response(db, record, openid);
  }
  const template = await common.getAgendaTemplate();
  const transactionResult = await db.runTransaction(async (transaction) => {
    const agendaRef = transaction.collection('agendas').doc(record._id);
    const latestResult = await agendaRef.get();
    const latest = latestResult.data;
    const slot = (latest.signupSlots || []).find((item) => item.id === event.slotId);
    if (!slot || slot.occupied) throw Object.assign(new Error('该角色已被报名'), { code: 'SLOT_TAKEN' });
    if (!common.signup.canSignupAs(slot.roleKey, event.personType)) throw Object.assign(new Error('该身份不能报名此角色'), { code: 'ROLE_IDENTITY_FORBIDDEN' });
    const result = await transaction.collection('agenda_signups').add({ data: Object.assign({ agendaId: latest._id, openid, slotId: slot.id, roleLabel: slot.label, createdAt: now, updatedAt: now }, profile) });
    slot.occupied = true;
    slot.preset = false;
    slot.signupId = result._id;
    slot.signupOpenid = openid;
    slot.person = common.signup.personFromProfile(profile);
    const agenda = common.agendaModel.normalizeAgenda(common.signup.writeSlotPerson(latest.agenda, slot, profile), template);
    await agendaRef.update({ data: { agenda, signupSlots: latest.signupSlots, signupVersion: Number(latest.signupVersion || 0) + 1, updatedAt: now } });
    return { agenda, signupSlots: latest.signupSlots };
  });
  return response(db, Object.assign({}, record, transactionResult), openid);
}

async function cancel(db, openid, event) {
  const record = await getCurrentAgenda(db);
  const signupResult = await db.collection('agenda_signups').doc(event.signupId).get();
  const item = signupResult.data;
  const manage = record.ownerOpenid === openid || await common.isAdmin(openid);
  if (!item || item.agendaId !== record._id || item.openid !== openid && !manage) throw Object.assign(new Error('只能取消自己的报名'), { code: 'FORBIDDEN' });
  await db.collection('agenda_signups').doc(event.signupId).remove();
  if (item.claimId) await db.collection('agenda_signup_claims').doc(item.claimId).remove();
  if (item.slotId) {
    const slot = (record.signupSlots || []).find((value) => value.id === item.slotId);
    if (slot) { slot.occupied = false; slot.preset = false; delete slot.signupId; delete slot.signupOpenid; slot.person = null; record.agenda = common.signup.writeSlotPerson(record.agenda, slot, null); }
    const agenda = common.agendaModel.normalizeAgenda(record.agenda, await common.getAgendaTemplate());
    await db.collection('agendas').doc(record._id).update({ data: { agenda, signupSlots: record.signupSlots, signupVersion: Number(record.signupVersion || 0) + 1, updatedAt: new Date().toISOString() } });
  }
  return response(db, record, openid);
}

async function cancelSlot(db, openid, event) {
  const record = await getCurrentAgenda(db);
  if (record.ownerOpenid !== openid && !(await common.isAdmin(openid))) throw Object.assign(new Error('无权取消该角色'), { code: 'FORBIDDEN' });
  const slot = (record.signupSlots || []).find((item) => item.id === event.slotId);
  if (!slot) return response(db, record, openid);
  if (slot.signupId) {
    const signupResult = await db.collection('agenda_signups').doc(slot.signupId).get();
    if (signupResult.data && signupResult.data.claimId) await db.collection('agenda_signup_claims').doc(signupResult.data.claimId).remove();
    await db.collection('agenda_signups').doc(slot.signupId).remove();
  }
  slot.occupied = false; slot.preset = false; slot.person = null; delete slot.signupId; delete slot.signupOpenid;
  const agenda = common.agendaModel.normalizeAgenda(common.signup.writeSlotPerson(record.agenda, slot, null), await common.getAgendaTemplate());
  await db.collection('agendas').doc(record._id).update({ data: { agenda, signupSlots: record.signupSlots, signupVersion: Number(record.signupVersion || 0) + 1, updatedAt: new Date().toISOString() } });
  return response(db, Object.assign({}, record, { agenda }), openid);
}

async function reset(db, openid) {
  await common.requireAdmin(openid);
  const record = await getCurrentAgenda(db, { allowEmpty: true });
  const agendaId = CURRENT_AGENDA_ID;
  await db.collection('agenda_signups').where({ agendaId }).remove();
  await db.collection('agenda_signup_claims').where({ agendaId }).remove();
  const agenda = common.agendaModel.createAgendaFromFacts({}, await common.getAgendaTemplate());
  const info = agenda.meetingInfo || {};
  const meetingSummary = { meetingNo: info.meetingNo || '', date: info.date || '', startTime: info.startTime || '', endTime: info.endTime || '' };
  await db.collection('agendas').doc(agendaId).update({ data: { agenda, meetingSummary, expiresAt: db.command.remove(), signupPublicId: CURRENT_AGENDA_ID, signupSlots: [], signupVersion: Number(record.signupVersion || 0) + 1, updatedAt: new Date().toISOString() } });
  return { agenda: Object.assign({}, agenda, { _id: agendaId, signupPublicId: CURRENT_AGENDA_ID, signupSlots: [] }) };
}

async function main(event) {
  try {
    common.initCloud();
    await common.ensureCollection('agenda_signups');
    await common.ensureCollection('agenda_signup_claims');
    const db = common.getDb(); const openid = common.getOpenid(); const action = event.action;
    if (action === 'create') return common.ok(await createSession(db, openid));
    if (action === 'get') return common.ok(await response(db, await getCurrentAgenda(db), openid));
    if (action === 'signup') return common.ok(await signup(db, openid, event));
    if (action === 'cancel') return common.ok(await cancel(db, openid, event));
    if (action === 'cancelSlot') return common.ok(await cancelSlot(db, openid, event));
    if (action === 'reset') return common.ok(await reset(db, openid));
    return common.fail('UNKNOWN_ACTION', '不支持的报名操作');
  } catch (error) { return common.handleError(error); }
}

module.exports = { profileFromEvent, canCreateSession, getCurrentAgenda, response, main };
exports.main = main;
