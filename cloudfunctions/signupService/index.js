const common = require('agenda-common');
const crypto = require('crypto');
const CURRENT_AGENDA_ID = common.CURRENT_AGENDA_ID || 'current';

const EN_ROLE_LABELS = {
  guestReception: 'SAA（Guest）', memberReception: 'SAA（Member）', photographer: 'Photographer',
  ahCounter: 'Ah-Counter', toastmaster: 'TOM', timer: 'Timer', grammarian: 'Grammarian',
  generalEvaluator: 'General Evaluator', tableTopicsMaster: 'Table Topics Master',
  tableTopicsEvaluator: 'Table Topics Evaluator', preparedSpeaker: 'Prepared Speaker',
  preparedEvaluator: 'IE', icebreaker: 'Icebreaker', workshop: 'Workshop Facilitator',
  nextMeetingHost: 'Next Meeting Role Booking'
};

const WEEKDAY_LABELS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEKDAY_LABELS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * 方法是什么：生成会议内嵌报名记录 ID。
 * 方法作用：为角色报名和仅参会记录提供稳定引用，不再依赖独立集合文档 ID。
 * 为什么添加：报名明细改为 meetings.signups 数组后仍需支持取消和槽位关联。
 */
function createSignupId(nowValue) {
  return `signup_${Number(nowValue || Date.now())}_${crypto.randomBytes(6).toString('hex')}`;
}

/**
 * 方法是什么：规范化会议内嵌报名数组。
 * 方法作用：兼容迁移时带 `_id` 的旧报名记录，并过滤无稳定 ID 的异常条目。
 * 为什么添加：新旧数据切换期间报名页只能读取会议文档这一份业务来源。
 */
function normalizeSignups(value) {
  return (Array.isArray(value) ? value : []).map((item) => {
    const normalized = Object.assign({}, item, { id: item.id || item._id || '' });
    delete normalized._id;
    delete normalized.agendaId;
    delete normalized.meetingId;
    delete normalized.claimId;
    return normalized;
  }).filter((item) => item.id);
}

/**
 * 方法是什么：读取会议聚合中的完整报名数组。
 * 方法作用：优先使用 meetings.signups，并从旧 signupSlots 恢复尚未迁移的角色报名。
 * 为什么添加：部署新云函数和执行迁移之间不能让已有角色报名暂时消失。
 */
function getMeetingSignups(record) {
  const source = record || {};
  const signups = normalizeSignups(source.signups);
  const ids = new Set(signups.map((item) => item.id));
  (source.signupSlots || []).forEach((slot) => {
    const person = slot.person || {};
    if (!slot.occupied || !slot.signupId || ids.has(slot.signupId) || !(person.rawName || person.displayNameZh || person.displayNameEn)) return;
    signups.push({
      id: slot.signupId,
      slotId: slot.id,
      openid: slot.signupOpenid || '',
      memberId: person.memberId || '',
      personType: person.memberId ? 'member' : (person.clubZh && person.clubZh !== '宾客' ? 'club' : 'guest'),
      roleLabel: slot.label || '',
      name: person.rawName || person.displayNameZh || person.displayNameEn || '',
      displayNameZh: person.displayNameZh || person.rawName || '',
      displayNameEn: person.displayNameEn || person.rawName || '',
      club: person.clubZh || '',
      clubEn: person.clubEn || person.clubZh || '',
      createdAt: source.updatedAt || '',
      updatedAt: source.updatedAt || ''
    });
    ids.add(slot.signupId);
  });
  return signups;
}

/**
 * 方法是什么：构建会议内嵌报名记录。
 * 方法作用：把身份档案、槽位和审计字段合并成可直接写入 meetings.signups 的对象。
 * 为什么添加：所有报名入口需要共享同一套稳定字段和 ID 生成规则。
 */
function buildSignupRecord(profile, context) {
  const options = context || {};
  const now = options.now || new Date().toISOString();
  return Object.assign({
    id: options.id || createSignupId(),
    slotId: options.slotId || '',
    openid: options.openid || '',
    roleLabel: options.roleLabel || '',
    createdAt: now,
    updatedAt: now
  }, profile || {});
}

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
    return { personType: kind, memberId: member._id, name: member.nameZh || member.nameEn || member.nickName, displayNameZh: member.nameZh || member.nickName, displayNameEn: member.nameEn || member.nameZh, club: member.clubZh || member.club || '', clubEn: member.clubEn || member.club || '', educationAwards: member.educationAwards || '', officerTitleZh: member.officerTitleZh || '', officerTitleEn: member.officerTitleEn || '' };
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
  return Object.assign({}, record, { _id: CURRENT_AGENDA_ID, signups: getMeetingSignups(record) });
}

/**
 * 方法是什么：构建报名页快照。
 * 方法作用：合并会议槽位、报名明细和权限状态。
 * 为什么添加：报名页不应自行拼接数据库多表数据。
 */
function resolveSignupFee(template, language) {
  return template.attendanceFee || '';
}

async function response(db, record, openid) {
  const template = await common.getAgendaTemplate();
  const agenda = common.agendaModel.normalizeAgenda(record.agenda, template);
  const list = getMeetingSignups(record);
  const signupBySlot = new Map(list.filter((item) => item.slotId).map((item) => [item.slotId, item]));
  const currentSlots = common.signup.mergeSlots(record.signupSlots, agenda);
  const language = agenda.meetingInfo && agenda.meetingInfo.language === 'en' ? 'en' : 'zh';
  const isAdmin = await common.isAdmin(openid);
  const people = new Map();
  list.forEach((item) => {
    const key = common.signup.signupPersonKey(item);
    const current = people.get(key) || { key, name: language === 'en' ? item.displayNameEn || item.name : item.name, memberId: item.memberId || '', personType: item.personType, club: language === 'en' ? item.clubEn || item.club : item.club, roles: [], attendanceOnly: false, mine: item.openid === openid };
    current.mine = current.mine || item.openid === openid;
    if (item.slotId) {
      const slot = (record.signupSlots || []).find((value) => value.id === item.slotId);
      const role = { signupId: item.id, slotId: item.slotId, label: displayRoleLabel(slot && slot.roleKey, item.roleLabel, language), mine: item.openid === openid, canCancel: isAdmin || item.openid === openid };
      if (!current.roles.some((value) => value.slotId === role.slotId || value.label === role.label)) current.roles.push(role);
    }
    else { current.attendanceOnly = true; current.attendanceSignupId = item.id; }
    people.set(key, current);
  });
  const slots = currentSlots.map((slot) => {
    const signupItem = signupBySlot.get(slot.id);
    const occupied = Boolean(slot.preset && slot.occupied || signupItem);
    return Object.assign({}, slot, {
      occupied,
      signupId: signupItem && signupItem.id || '',
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
    const current = people.get(key) || { key, name, memberId: slot.person.memberId || '', personType: 'preset', club: language === 'en' ? slot.person.clubEn || '' : slot.person.clubZh || '', roles: [], attendanceOnly: false, mine: false };
    const role = { slotId: slot.id, label: displayRoleLabel(slot.roleKey, slot.label, language), mine: false, canCancel: isAdmin };
    if (!current.roles.some((value) => value.slotId === role.slotId || value.label === role.label)) current.roles.push(role);
    people.set(key, current);
  });
  people.forEach((person) => { person.rolesText = person.roles.map((role) => role.label).join('&'); });
  const preparation = (agenda.sections || []).find((section) => section.id === 'preparation');
  const manager = preparation && preparation.row && preparation.row.person || {};
  const club = await common.getClubContext();
  const clubZh = club.shortNameZh || club.nameZh || '';
  const clubEn = club.shortNameEn || club.nameEn || '';
  people.forEach((person) => { if (person.memberId) person.club = language === 'en' ? clubEn : clubZh; });
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
    agenda: Object.assign({}, agenda, {
      _id: CURRENT_AGENDA_ID,
      signupPublicId: CURRENT_AGENDA_ID,
      signupSlots: slots,
      signupVersion: Number(record.signupVersion || 0)
    }),
    meetingInfo: agenda.meetingInfo,
    club: { nameZh: club.nameZh || '', nameEn: club.nameEn || '' },
    language,
    templateVenue,
    signupDisplay: {
      weekdayLabel: resolveWeekdayLabel(agenda.meetingInfo, language),
      venueSuffix: locale.signupVenueSuffix || '',
      guestFee: resolveSignupFee(template, language)
    },
    meetingManagerName: language === 'en' ? manager.displayNameEn || manager.rawName || 'To be filled' : manager.displayNameZh || manager.rawName || '待填写',
    slots,
    remainingRoles: slots.filter((s) => !s.occupied).length,
    attendeeCount: people.size,
    people: Array.from(people.values()),
    signupVersion: Number(record.signupVersion || 0),
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
  const slotIds = new Set(slots.map((slot) => slot.id));
  const signups = getMeetingSignups(record).filter((item) => !item.slotId || slotIds.has(item.slotId));
  const signupVersion = Number(record.signupVersion || 0) + 1;
  await common.getCollection('agendas').doc(CURRENT_AGENDA_ID).update({ data: { signupPublicId: CURRENT_AGENDA_ID, signupSlots: slots, signups, signupVersion, updatedAt: new Date().toISOString() } });
  return response(db, Object.assign({}, record, { _id: CURRENT_AGENDA_ID, signupPublicId: CURRENT_AGENDA_ID, signupSlots: slots, signups, signupVersion }), openid);
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
  const template = await common.getAgendaTemplate();
  const transactionResult = await db.runTransaction(async (transaction) => {
    const agendaRef = transaction.collection(common.collectionName('agendas')).doc(record._id);
    const latestResult = await agendaRef.get();
    const latest = latestResult.data;
    common.meetingService.assertVersion(event.signupVersion, latest.signupVersion || 0);
    const signups = getMeetingSignups(latest);
    if (!event.slotId) {
      const existing = signups.find((item) => item.openid === openid && !item.slotId);
      if (!existing) signups.push(buildSignupRecord(profile, { openid, now }));
      const signupVersion = Number(latest.signupVersion || 0) + (existing ? 0 : 1);
      if (!existing) await agendaRef.update({ data: { signups, signupVersion, updatedAt: now } });
      return { agenda: latest.agenda, signupSlots: latest.signupSlots || [], signups, signupVersion };
    }
    const slot = (latest.signupSlots || []).find((item) => item.id === event.slotId);
    if (!slot || slot.occupied) throw Object.assign(new Error('该角色已被报名'), { code: 'SLOT_TAKEN' });
    if (!common.signup.canSignupAs(slot.roleKey, event.personType)) throw Object.assign(new Error('该身份不能报名此角色'), { code: 'ROLE_IDENTITY_FORBIDDEN' });
    const signupItem = buildSignupRecord(profile, { openid, slotId: slot.id, roleLabel: slot.label, now });
    signups.push(signupItem);
    slot.occupied = true;
    slot.preset = false;
    slot.signupId = signupItem.id;
    slot.signupOpenid = openid;
    slot.person = common.signup.personFromProfile(profile);
    const agenda = common.agendaModel.normalizeAgenda(common.signup.writeSlotPerson(latest.agenda, slot, profile), template);
    const signupVersion = Number(latest.signupVersion || 0) + 1;
    await agendaRef.update({ data: { agenda, signupSlots: latest.signupSlots, signups, signupVersion, updatedAt: now } });
    return { agenda, signupSlots: latest.signupSlots, signups, signupVersion };
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
  const manage = record.ownerOpenid === openid || await common.isAdmin(openid);
  const template = await common.getAgendaTemplate();
  const now = new Date().toISOString();
  const transactionResult = await db.runTransaction(async (transaction) => {
    const agendaRef = transaction.collection(common.collectionName('agendas')).doc(record._id);
    const latestResult = await agendaRef.get();
    const latest = latestResult.data;
    const signups = getMeetingSignups(latest);
    const item = signups.find((signupItem) => signupItem.id === event.signupId);
    const slotId = item && item.slotId || event.slotId || '';
    const slot = (latest.signupSlots || []).find((value) => value.id === slotId || value.signupId === event.signupId);
    if (item && item.openid !== openid && !manage) throw Object.assign(new Error('只能取消自己的报名'), { code: 'FORBIDDEN' });
    if (!item && slot && slot.signupOpenid !== openid && !manage) throw Object.assign(new Error('只能取消自己的报名'), { code: 'FORBIDDEN' });
    if (!item && !slot) {
      return { agenda: latest.agenda, signupSlots: latest.signupSlots || [], signups, signupVersion: Number(latest.signupVersion || 0) };
    }
    const remainingSignups = signups.filter((signupItem) => signupItem.id !== event.signupId && (!slotId || signupItem.slotId !== slotId));
    let agenda = latest.agenda;
    if (slot) {
      slot.occupied = false;
      slot.preset = false;
      slot.person = null;
      delete slot.signupId;
      delete slot.signupOpenid;
      agenda = common.agendaModel.normalizeAgenda(common.signup.writeSlotPerson(agenda, slot, null), template);
    }
    const signupVersion = Number(latest.signupVersion || 0) + 1;
    await agendaRef.update({ data: { agenda, signupSlots: latest.signupSlots || [], signups: remainingSignups, signupVersion, updatedAt: now } });
    return { agenda, signupSlots: latest.signupSlots || [], signups: remainingSignups, signupVersion };
  });
  return response(db, Object.assign({}, record, transactionResult), openid);
}

/**
 * 方法是什么：管理员清空角色。
 * 方法作用：释放指定槽位并删除关联报名。
 * 为什么添加：编辑页的角色管理需要与报名页保持一致。
 */
async function cancelSlot(db, openid, event) {
  const record = await getCurrentAgenda(db);
  if (record.ownerOpenid !== openid && !(await common.isAdmin(openid))) throw Object.assign(new Error('无权取消该角色'), { code: 'FORBIDDEN' });
  const template = await common.getAgendaTemplate();
  const now = new Date().toISOString();
  const transactionResult = await db.runTransaction(async (transaction) => {
    const agendaRef = transaction.collection(common.collectionName('agendas')).doc(record._id);
    const latestResult = await agendaRef.get();
    const latest = latestResult.data;
    const slot = (latest.signupSlots || []).find((item) => item.id === event.slotId);
    const signups = getMeetingSignups(latest);
    if (!slot) return { agenda: latest.agenda, signupSlots: latest.signupSlots || [], signups, signupVersion: Number(latest.signupVersion || 0) };
    const remainingSignups = signups.filter((item) => item.id !== slot.signupId && item.slotId !== slot.id);
    slot.occupied = false;
    slot.preset = false;
    slot.person = null;
    delete slot.signupId;
    delete slot.signupOpenid;
    const agenda = common.agendaModel.normalizeAgenda(common.signup.writeSlotPerson(latest.agenda, slot, null), template);
    const signupVersion = Number(latest.signupVersion || 0) + 1;
    await agendaRef.update({ data: { agenda, signupSlots: latest.signupSlots || [], signups: remainingSignups, signupVersion, updatedAt: now } });
    return { agenda, signupSlots: latest.signupSlots || [], signups: remainingSignups, signupVersion };
  });
  return response(db, Object.assign({}, record, transactionResult), openid);
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
  const agenda = common.agendaModel.createAgendaFromFacts({}, await common.getAgendaTemplate());
  const info = agenda.meetingInfo || {};
  const meetingSummary = { meetingNo: info.meetingNo || '', date: info.date || '', startTime: info.startTime || '', endTime: info.endTime || '' };
  await common.getCollection('agendas').doc(agendaId).update({ data: { agenda, meetingSummary, expiresAt: db.command.remove(), signupPublicId: CURRENT_AGENDA_ID, signupSlots: [], signups: [], signupVersion: Number(record.signupVersion || 0) + 1, updatedAt: new Date().toISOString() } });
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
    if (typeof common.setRequestContext === 'function') common.setRequestContext(event);
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

module.exports = { profileFromEvent, canCreateSession, getCurrentAgenda, response, resolveSignupFee, resolveWeekdayLabel, createSignupId, normalizeSignups, getMeetingSignups, buildSignupRecord, main };
exports.main = main;
