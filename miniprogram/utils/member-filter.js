function includesText(value, keyword) {
  return !keyword || String(value || '').toLowerCase().includes(String(keyword).trim().toLowerCase());
}

function inDateRange(value, start, end) {
  if (!start && !end) return true;
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  return (!start || text >= start) && (!end || text <= end);
}

function matchesChoice(value, choice) {
  if (choice === '' || choice === 'all' || choice === undefined || choice === null) return true;
  if (choice === 'true') return value === true;
  if (choice === 'false') return value === false;
  return value === choice;
}

function matchesBirthdayMonth(value, month) {
  if (!month) return true;
  const match = String(value || '').match(/^(?:\d{4}-)?(\d{2})-\d{2}$/);
  return Boolean(match && match[1] === month);
}

function filterMembers(records, keyword, filters) {
  const value = filters || {};
  return (records || []).filter((record) => includesText([record.nameZh, record.nameEn, record.nickName, record.searchText].filter(Boolean).join(' '), keyword)
    && inDateRange(record.joinedAt, value.joinedAtStart, value.joinedAtEnd)
    && matchesBirthdayMonth(record.birthday, value.birthdayMonth)
    && includesText(record.pathNameZh, value.pathNameZh)
    && includesText(record.educationProgress, value.educationProgress)
    && matchesChoice(record.competitionEligible, value.competitionEligible)
    && matchesChoice(record.isMentor, value.isMentor)
    && includesText(record.mentorName, value.mentorName)
    && includesText(record.officerTitleZh, value.officerTitleZh)
    && matchesChoice(record.role, value.role)
    && matchesChoice(record.status, value.status));
}

module.exports = { includesText, inDateRange, matchesChoice, matchesBirthdayMonth, filterMembers };
