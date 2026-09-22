const common = require('agenda-common');
const CURRENT_AGENDA_ID = common.CURRENT_AGENDA_ID || 'current';

const EN_ROLE_LABELS = {
  guestReception: 'SAA（Guest）', memberReception: 'SAA（Member）', photographer: 'Photographer',
  ahCounter: 'Ah-Counter', toastmaster: 'TOM', timer: 'Timer', grammarian: 'Grammarian',
  generalEvaluator: 'General Evaluator', tableTopicsMaster: 'Table Topics Master',
  tableTopicsEvaluator: 'Table Topics Evaluator', preparedSpeaker: 'Prepared Speaker',
  preparedEvaluator: 'IE', icebreaker: 'Icebreaker', workshop: 'Workshop Facilitator'
};

const WEEKDAY_LABELS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEKDAY_LABELS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * 方法是什么：生成报名页展示用的星期文案。
 * 方法作用：优先使用会议已解析的星期，缺失时从日期补算。
 * 为什么添加：报名页需要显示星期，但不能修改议程原始会议字段。
 */
function resolveWeekdayLabel(meetingInfo, language) {
  const source = meetingInfo || {};
  if (source.weekday) {
    if (language !== 'en') return String(source.weekday);
    const index = WEEKDAY_LABELS_ZH.indexOf(String(source.weekday));
    return index >= 0 ? WEEKDAY_LABELS_EN[index] : String(source.weekday);
  }
  const date = new Date(`${String(source.date || '').slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? '' : language === 'en' ? WEEKDAY_LABELS_EN[date.getDay()] : WEEKDAY_LABELS_ZH[date.getDay()];
}

/**
 * 方法是什么：显示报名角色名称。
 * 方法作用：按语言和角色编码返回统一标题。
 * 为什么添加：编辑页和报名页必须显示相同角色文案。
 */
function displayRoleLabel(roleKey, label, language) {
  if (common.signup && typeof common.signup.displayRoleLabel === 'function') {
    return common.signup.displayRoleLabel(roleKey, label, language);
  }
  return language === 'en' ? EN_ROLE_LABELS[roleKey] || label : label;
}

/**
 * 方法是什么：判断是否可以创建报名会话。
 * 方法作用：允许会员、会议所有者或管理员开启报名。
 * 为什么添加：报名入口权限必须在服务端统一校验。
 */
function canCreateSession(record, openid, membership, admin) {
  return Boolean(record && (membership || record.ownerOpenid === openid || admin));
}

/**
 * 方法是什么：构建报名人档案。
 * 方法作用：校验身份类型并转换会员、俱乐部或宾客资料。
 * 为什么添加：数据库写入前需要统一的人员结构和输入校验。
 */
function profileFromEvent(event, member) {
  const kind = event.personType;
  if (!['member', 'club', 'guest'].includes(kind)) throw Object.assign(new Error('请选择报名身份'), { code: 'INVALID_PROFILE' });
  if (kind === 'member') {
    if (!member) throw Object.assign(new Error('请选择双语会员'), { code: 'MEMBER_NOT_FOUND' });
    return { personType: kind, memberId: member._id, name: member.nameZh || member.nameEn || member.nickName, displayNameZh: member.nameZh || member.nickName, displayNameEn: member.nameEn || member.nameZh, club: member.clubZh || '', clubEn: member.clubEn || '', educationAwards: member.educationAwards || '', officerTitleZh: member.officerTitleZh || '', officerTitleEn: member.officerTitleEn || '' };
  }
  const name = String(event.name || '').trim();
  const club = String(event.club || '').trim();
  if (!name || kind === 'club' && !club) throw Object.assign(new Error(kind === 'club' ? '请填写姓名和俱乐部' : '请填写姓名'), { code: 'INVALID_PROFILE' });
  return { personType: kind, memberId: '', name, club: kind === 'club' ? club : '宾客', clubEn: kind === 'club' ? club : 'Guest' };
}

/**
 * 方法是什么：读取当前会议聚合。
 * 方法作用：返回编辑页和报名页共享的当前会议快照。
 * 为什么添加：所有会议入口必须使用同一个数据源。
 */
async function getCurrentAgenda(db, options = {}) {
  const res = await common.getCollection('agendas').where({ _id: CURRENT_AGENDA_ID, clubId: common.config.getConfig().clubId }).limit(1).get();
  const record = res.data && res.data[0];
  const meetingNo = record && record.agenda && record.agenda.meetingInfo && String(record.agenda.meetingInfo.meetingNo || '').trim();
  if (!record || !options.allowEmpty && !meetingNo) {
    throw Object.assign(new Error('当前会议尚未开放报名'), { code: 'SIGNUP_NOT_FOUND' });
  }
  return Object.assign({}, record, { _id: CURRENT_AGENDA_ID });
}

/**
 * 方法是什么：构建报名页快照。
 * 方法作用：合并会议槽位、报名明细和权限状态。
 * 为什么添加：报名页不应自行拼接数据库多表数据。
 */
async function response(db, record, openid) {
  const signups = await common.getCollection('agendaSignups').where({ agendaId: record._id }).get();
  const list = signups.data || [];
  const signupBySlot = new Map(list.filter((item) => item.slotId).map((item) => [item.slotId, item]));
  const claimResult = await common.getCollection('agendaSignupClaims').where({ agendaId: record._id }).get();
  for (const claim of claimResult.data || []) {
    const hasSignup = list.some((item) => item.claimId === claim._id || item.slotId === claim.slotId);
    const age = claim.createdAt ? Date.now() - new Date(claim.createdAt).getTime() : Infinity;
    if (!hasSignup && age > 30000 && (typeof claim._id === 'string' || typeof claim._id === 'number')) {
      await common.getCollection('agendaSignupClaims').doc(claim._id).remove();
    }
  }
  const language = record.agenda.meetingInfo && record.agenda.meetingInfo.language === 'en' ? 'en' : 'zh';
  const isAdmin = await common.isAdmin(openid);
  const people = new Map();
  list.forEach((item) => {
    const key = common.signup.signupPersonKey(item);
    const current = people.get(key) || { key, name: language === 'en' ? item.displayNameEn || item.name : item.name, memberId: item.memberId || '', personType: item.personType, club: language === 'en' ? item.clubEn || item.club : item.club, roles: [], attendanceOnly: false, mine: item.openid === openid };
    current.mine = current.mine || item.openid === openid;
    if (item.slotId) {
      const slot = (record.signupSlots || []).find((value) => value.id === item.slotId);
      const role = { signupId: item._id, slotId: item.slotId, label: displayRoleLabel(slot && slot.roleKey, item.roleLabel, language), mine: item.openid === openid, canCancel: isAdmin || item.openid === openid };
      if (!current.roles.some((value) => value.slotId === role.slotId || value.label === role.label)) current.roles.push(role);
    }
    else { current.attendanceOnly = true; current.attendanceSignupId = item._id; }
    people.set(key, current);
  });
  const slots = (record.signupSlots || []).map((slot) => {
    const signupItem = signupBySlot.get(slot.id);
    const occupied = Boolean(slot.preset && slot.occupied || signupItem);
    return Object.assign({}, slot, {
      occupied,
      signupId: signupItem && signupItem._id || '',
      signupOpenid: signupItem && signupItem.openid || '',
      mine: Boolean(signupItem && signupItem.openid === openid),
      canCancel: Boolean(signupItem && (isAdmin || signupItem.openid === openid)),
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
    const key = common.signup.signupPersonKey(Object.assign({ personType: 'preset', name }, slot.person));
    const current = people.get(key) || { key, name, personType: 'preset', club: language === 'en' ? slot.person.clubEn || '' : slot.person.clubZh || '', roles: [], attendanceOnly: false, mine: false };
    const role = { slotId: slot.id, label: displayRoleLabel(slot.roleKey, slot.label, language), mine: false, canCancel: isAdmin };
    if (!current.roles.some((value) => value.slotId === role.slotId || value.label === role.label)) current.roles.push(role);
    people.set(key, current);
  });
  people.forEach((person) => { person.rolesText = person.roles.map((role) => role.label).join('&'); });
  const preparation = (record.agenda.sections || []).find((section) => section.id === 'preparation');
  const manager = preparation && preparation.row && preparation.row.person || {};
  const template = await common.getAgendaTemplate();
  const club = await common.getClubContext();
  const locales = template.locales || {};
  const locale = locales[language] || {};
  const localizedVenue = locale.fixedContent && locale.fixedContent.venue || '';
  const zhVenue = locales.zh && locales.zh.fixedContent && locales.zh.fixedContent.venue || '';
  const templateVenue = language === 'en'
    ? localizedVenue
    : zhVenue;
  return {
    publicId: CURRENT_AGENDA_ID,
    agendaId: CURRENT_AGENDA_ID,
    meetingInfo: record.agenda.meetingInfo,
    club: { nameZh: club.nameZh || '', nameEn: club.nameEn || '' },
    language,
    templateVenue,
    signupDisplay: {
      weekdayLabel: resolveWeekdayLabel(record.agenda.meetingInfo, language),
      venueSuffix: locale.signupVenueSuffix || '',
      guestFee: locale.guestFee || ''
    },
    meetingManagerName: language === 'en' ? manager.displayNameEn || manager.rawName || 'To be filled' : manager.displayNameZh || manager.rawName || '待填写',
    slots,
    remainingRoles: slots.filter((s) => !s.occupied).length,
    attendeeCount: people.size,
    people: Array.from(people.values()),
    myOpenid: openid,
    isAdmin
  };
}

/**
 * 方法是什么：创建报名会话。
 * 方法作用：从当前议程生成可报名槽位并提升版本号。
 * 为什么添加：编辑完成后必须显式开启报名流程。
 */
async function createSession(db, openid) {
  const record = await getCurrentAgenda(db);
  const membership = await common.getMembershipByOpenid(openid);
  if (!canCreateSession(record, openid, membership, await common.isAdmin(openid))) throw Object.assign(new Error('无权创建报名页'), { code: 'FORBIDDEN' });
  const slots = common.signup.mergeSlots(record.signupSlots, record.agenda);
  await common.getCollection('agendas').doc(CURRENT_AGENDA_ID).update({ data: { signupPublicId: CURRENT_AGENDA_ID, signupSlots: slots, signupVersion: Number(record.signupVersion || 0) + 1, updatedAt: new Date().toISOString() } });
  return response(db, Object.assign({}, record, { _id: CURRENT_AGENDA_ID, signupPublicId: CURRENT_AGENDA_ID, signupSlots: slots }), openid);
}

/**
 * 方法是什么：提交角色报名。
 * 方法作用：通过事务占用槽位并回写会议聚合。
 * 为什么添加：并发报名不能覆盖编辑或其他报名结果。
 */
async function signup(db, openid, event) {
  const record = await getCurrentAgenda(db);
  let member = null;
  if (event.personType === 'member') { const res = await common.getCollection('memberships').doc(event.memberId).get(); member = res.data; }
  const profile = profileFromEvent(event, member);
  const now = new Date().toISOString();
  if (!event.slotId) {
    const existing = await common.getCollection('agendaSignups').where({ agendaId: record._id, openid, slotId: '' }).limit(1).get();
    if (!existing.data.length) await common.getCollection('agendaSignups').add({ data: Object.assign({ agendaId: record._id, openid, slotId: '', roleLabel: '', createdAt: now, updatedAt: now }, profile) });
    return response(db, record, openid);
  }
  const template = await common.getAgendaTemplate();
  const transactionResult = await db.runTransaction(async (transaction) => {
    const agendaRef = transaction.collection(common.collectionName('agendas')).doc(record._id);
    const latestResult = await agendaRef.get();
    const latest = latestResult.data;
    common.meetingService.assertVersion(event.signupVersion, latest.signupVersion || 0);
    const slot = (latest.signupSlots || []).find((item) => item.id === event.slotId);
    if (!slot || slot.occupied) throw Object.assign(new Error('该角色已被报名'), { code: 'SLOT_TAKEN' });
    if (!common.signup.canSignupAs(slot.roleKey, event.personType)) throw Object.assign(new Error('该身份不能报名此角色'), { code: 'ROLE_IDENTITY_FORBIDDEN' });
    const result = await transaction.collection(common.collectionName('agendaSignups')).add({ data: Object.assign({ agendaId: latest._id, openid, slotId: slot.id, roleLabel: slot.label, createdAt: now, updatedAt: now }, profile) });
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

/**
 * 方法是什么：取消报名。
 * 方法作用：删除报名明细、释放槽位并同步议程人员。
 * 为什么添加：取消操作必须同时更新两个页面共享的会议状态。
 */
async function cancel(db, openid, event) {
  const record = await getCurrentAgenda(db);
  const signupResult = await common.getCollection('agendaSignups').doc(event.signupId).get();
  const item = signupResult.data;
  const manage = record.ownerOpenid === openid || await common.isAdmin(openid);
  if (!item) {
    const staleSlot = (record.signupSlots || []).find((slot) => slot.signupId === event.signupId);
    const staleOwner = staleSlot && staleSlot.signupOpenid === openid;
    if (!staleSlot || !manage && !staleOwner) throw Object.assign(new Error('只能取消自己的报名'), { code: 'FORBIDDEN' });
    staleSlot.occupied = false;
    staleSlot.preset = false;
    staleSlot.person = null;
    delete staleSlot.signupId;
    delete staleSlot.signupOpenid;
    const agenda = common.agendaModel.normalizeAgenda(common.signup.writeSlotPerson(record.agenda, staleSlot, null), await common.getAgendaTemplate());
    await common.getCollection('agendas').doc(record._id).update({ data: { agenda, signupSlots: record.signupSlots, signupVersion: Number(record.signupVersion || 0) + 1, updatedAt: new Date().toISOString() } });
    return response(db, Object.assign({}, record, { agenda }), openid);
  }
  if (item.agendaId !== record._id || item.openid !== openid && !manage) throw Object.assign(new Error('只能取消自己的报名'), { code: 'FORBIDDEN' });
  await common.getCollection('agendaSignups').doc(event.signupId).remove();
  if (item.claimId) await common.getCollection('agendaSignupClaims').doc(item.claimId).remove();
  if (item.slotId) {
    const slot = (record.signupSlots || []).find((value) => value.id === item.slotId);
    if (slot) { slot.occupied = false; slot.preset = false; delete slot.signupId; delete slot.signupOpenid; slot.person = null; record.agenda = common.signup.writeSlotPerson(record.agenda, slot, null); }
    const agenda = common.agendaModel.normalizeAgenda(record.agenda, await common.getAgendaTemplate());
    await common.getCollection('agendas').doc(record._id).update({ data: { agenda, signupSlots: record.signupSlots, signupVersion: Number(record.signupVersion || 0) + 1, updatedAt: new Date().toISOString() } });
  }
  return response(db, record, openid);
}

/**
 * 方法是什么：管理员清空角色。
 * 方法作用：释放指定槽位并删除关联报名。
 * 为什么添加：编辑页的角色管理需要与报名页保持一致。
 */
async function cancelSlot(db, openid, event) {
  const record = await getCurrentAgenda(db);
  if (record.ownerOpenid !== openid && !(await common.isAdmin(openid))) throw Object.assign(new Error('无权取消该角色'), { code: 'FORBIDDEN' });
  const slot = (record.signupSlots || []).find((item) => item.id === event.slotId);
  if (!slot) return response(db, record, openid);
  if (slot.signupId) {
    const signupResult = await common.getCollection('agendaSignups').doc(slot.signupId).get();
    if (signupResult.data && signupResult.data.claimId) await common.getCollection('agendaSignupClaims').doc(signupResult.data.claimId).remove();
    await common.getCollection('agendaSignups').doc(slot.signupId).remove();
  }
  slot.occupied = false; slot.preset = false; slot.person = null; delete slot.signupId; delete slot.signupOpenid;
  const agenda = common.agendaModel.normalizeAgenda(common.signup.writeSlotPerson(record.agenda, slot, null), await common.getAgendaTemplate());
  await common.getCollection('agendas').doc(record._id).update({ data: { agenda, signupSlots: record.signupSlots, signupVersion: Number(record.signupVersion || 0) + 1, updatedAt: new Date().toISOString() } });
  return response(db, Object.assign({}, record, { agenda }), openid);
}

/**
 * 方法是什么：重置当前会议。
 * 方法作用：清理报名并创建空的 AgendaV2 会议。
 * 为什么添加：管理员需要可控地开始下一场会议。
 */
async function reset(db, openid) {
  await common.requireAdmin(openid);
  const record = await getCurrentAgenda(db, { allowEmpty: true });
  const agendaId = CURRENT_AGENDA_ID;
  await common.getCollection('agendaSignups').where({ agendaId }).remove();
  await common.getCollection('agendaSignupClaims').where({ agendaId }).remove();
  const agenda = common.agendaModel.createAgendaFromFacts({}, await common.getAgendaTemplate());
  const info = agenda.meetingInfo || {};
  const meetingSummary = { meetingNo: info.meetingNo || '', date: info.date || '', startTime: info.startTime || '', endTime: info.endTime || '' };
  await common.getCollection('agendas').doc(agendaId).update({ data: { agenda, meetingSummary, expiresAt: db.command.remove(), signupPublicId: CURRENT_AGENDA_ID, signupSlots: [], signupVersion: Number(record.signupVersion || 0) + 1, updatedAt: new Date().toISOString() } });
  return { agenda: Object.assign({}, agenda, { _id: agendaId, signupPublicId: CURRENT_AGENDA_ID, signupSlots: [] }) };
}

/**
 * 方法是什么：处理报名云函数请求。
 * 方法作用：统一初始化集合、分发动作并转换错误响应。
 * 为什么添加：所有报名入口必须使用同一权限和响应协议。
 */
async function main(event) {
  try {
    common.initCloud();
    await common.ensureCollection('agendaSignups');
    await common.ensureCollection('agendaSignupClaims');
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

module.exports = { profileFromEvent, canCreateSession, getCurrentAgenda, response, resolveWeekdayLabel, main };
exports.main = main;
