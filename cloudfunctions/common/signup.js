const ROLE_DEFINITIONS = {
  guestReception: '宾客 SAA',
  memberReception: '会员 SAA',
  photographer: '摄影师',
  ahCounter: '哼哈师',
  toastmaster: '总主持人',
  timer: '时间官',
  grammarian: '语法师',
  generalEvaluator: '总点评',
  tableTopicsMaster: '即兴主持人',
  tableTopicsEvaluator: '即兴点评师'
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasPerson(person) {
  return Boolean(person && (person.rawName || person.displayNameZh || person.displayNameEn));
}

function personFromProfile(profile) {
  const source = profile || {};
  return {
    memberId: source.memberId || '',
    rawName: source.name || '',
    displayNameZh: source.displayNameZh || source.name || '',
    displayNameEn: source.displayNameEn || source.name || '',
    clubZh: source.club || '',
    clubEn: source.clubEn || source.club || '',
    educationAwards: source.educationAwards || '',
    officerTitleZh: source.officerTitleZh || '',
    officerTitleEn: source.officerTitleEn || '',
    inputMode: source.memberId ? 'select' : 'manual'
  };
}

function visitRows(agenda, visitor) {
  (agenda.sections || []).forEach((section) => {
    if (section.row) visitor(section.row, section);
    (section.children || []).forEach((row) => visitor(row, section));
  });
}

function buildRoleSlots(agendaValue) {
  const agenda = agendaValue || {};
  const slots = [];
  const add = (id, roleKey, label, target, person, meta) => {
    slots.push(Object.assign({
      id, roleKey, label, target, occupied: hasPerson(person), preset: hasPerson(person),
      person: hasPerson(person) ? clone(person) : null
    }, meta || {}));
  };
  const signIn = (agenda.sections || []).find((section) => section.id === 'signIn');
  if (signIn && signIn.row) {
    add('role:guestReception', 'guestReception', ROLE_DEFINITIONS.guestReception, { kind: 'multi', sectionId: 'signIn', index: 0 }, signIn.row.persons && signIn.row.persons[0]);
    add('role:memberReception', 'memberReception', ROLE_DEFINITIONS.memberReception, { kind: 'multi', sectionId: 'signIn', index: 1 }, signIn.row.persons && signIn.row.persons[1]);
  }
  Object.keys(ROLE_DEFINITIONS).filter((key) => !['guestReception', 'memberReception'].includes(key)).forEach((roleKey) => {
    let found = null;
    visitRows(agenda, (row, section) => {
      if (!found && row.roleKey === roleKey) found = { row, section };
    });
    if (found) add(`role:${roleKey}`, roleKey, ROLE_DEFINITIONS[roleKey], { kind: 'roleKey', roleKey }, found.row.person);
  });
  const prepared = (agenda.sections || []).find((section) => section.id === 'preparedSpeech');
  (prepared && prepared.children || []).forEach((block, index) => {
    add(`prepared:${block.id}:speaker`, 'preparedSpeaker', `备稿演讲者 ${index + 1}`, { kind: 'prepared', blockId: block.id, field: 'speaker' }, block.speaker, { blockId: block.id });
    add(`prepared:${block.id}:evaluator`, 'preparedEvaluator', `备稿点评师 ${index + 1}`, { kind: 'prepared', blockId: block.id, field: 'evaluator' }, block.evaluator, { blockId: block.id });
  });
  visitRows(agenda, (row) => {
    if (row.dynamic && (row.moduleKind === 'icebreaker' || row.moduleKind === 'workshop')) {
      const label = row.moduleKind === 'icebreaker' ? '破冰师' : '工作坊主持人';
      add(`dynamic:${row.id}`, row.moduleKind, label, { kind: 'row', rowId: row.id }, row.person);
    }
  });
  return slots;
}

function writeSlotPerson(agendaValue, slot, personValue) {
  const agenda = clone(agendaValue);
  const person = personValue ? personFromProfile(personValue) : personFromProfile({});
  const target = slot.target || {};
  if (target.kind === 'multi') {
    const section = agenda.sections.find((item) => item.id === target.sectionId);
    if (section && section.row) {
      section.row.persons = section.row.persons || [];
      section.row.persons[target.index] = person;
    }
  } else if (target.kind === 'roleKey') {
    visitRows(agenda, (row) => { if (row.roleKey === target.roleKey) row.person = clone(person); });
  } else if (target.kind === 'prepared') {
    const section = agenda.sections.find((item) => item.id === 'preparedSpeech');
    const block = section && (section.children || []).find((item) => item.id === target.blockId);
    if (block) block[target.field] = person;
  } else if (target.kind === 'row') {
    visitRows(agenda, (row) => { if (row.id === target.rowId) row.person = clone(person); });
  }
  return agenda;
}

function mergeSlots(existing, agenda) {
  const previous = new Map((existing || []).map((slot) => [slot.id, slot]));
  return buildRoleSlots(agenda).map((slot) => {
    const old = previous.get(slot.id);
    return Object.assign({}, slot, old && old.signupId ? { occupied: true, person: old.person, signupId: old.signupId, signupOpenid: old.signupOpenid, preset: false } : {});
  });
}

module.exports = { ROLE_DEFINITIONS, buildRoleSlots, writeSlotPerson, mergeSlots, personFromProfile, hasPerson };
