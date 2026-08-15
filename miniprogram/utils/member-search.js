function unwrapMember(item) {
  return item && item.member ? item.member : item;
}

function filterMembers(items, keyword) {
  const value = String(keyword || '').trim().toLowerCase();
  return (items || []).map(unwrapMember).filter((member) => {
    if (!member) return false;
    return !value || [member.nameZh, member.nameEn, member.nickName]
      .filter(Boolean).join(' ').toLowerCase().includes(value);
  });
}

module.exports = { unwrapMember, filterMembers };
