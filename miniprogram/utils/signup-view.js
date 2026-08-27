const GUEST_ROLE_KEYS = ['guestReception', 'photographer', 'ahCounter'];
const TABLE_TOPICS_ROLE_KEYS = ['tableTopicsMaster', 'tableTopicsEvaluator'];
const PREPARED_ROLE_KEYS = ['preparedSpeaker', 'preparedEvaluator'];

/**
 * 方法是什么：按议程模块整理报名槽位。
 * 方法作用：把即兴主持人与点评师放在同一模块，并把每组备稿演讲者与 IE 成对编号。
 * 为什么添加：报名页需要呈现议程结构，而服务端槽位仍需保持扁平格式供报名接口使用。
 */
function buildSlotGroups(slotsValue, languageValue) {
  const language = languageValue === 'en' ? 'en' : 'zh';
  const groups = [];
  const groupMap = new Map();
  let preparedIndex = 0;

  (slotsValue || []).forEach((slotValue) => {
    const slot = Object.assign({}, slotValue);
    slot.isGuestRole = GUEST_ROLE_KEYS.includes(slot.roleKey);
    let groupId = `single:${slot.id}`;
    let groupTitle = '';
    let grouped = false;
    let sequence = 0;

    if (TABLE_TOPICS_ROLE_KEYS.includes(slot.roleKey)) {
      groupId = 'module:table-topics';
      groupTitle = language === 'en' ? 'Table Topics' : '即兴演讲';
      grouped = true;
    } else if (PREPARED_ROLE_KEYS.includes(slot.roleKey) && slot.blockId) {
      groupId = `module:prepared:${slot.blockId}`;
      grouped = true;
      if (!groupMap.has(groupId)) {
        preparedIndex += 1;
        sequence = preparedIndex;
      } else {
        sequence = groupMap.get(groupId).sequence;
      }
      groupTitle = language === 'en' ? `Prepared Speech ${sequence}` : `备稿演讲 ${sequence}`;
      slot.displayLabel = slot.roleKey === 'preparedSpeaker'
        ? (language === 'en' ? `Prepared Speaker ${sequence}` : `备稿演讲者 ${sequence}`)
        : (language === 'en' ? `IE ${sequence}` : `备稿点评师 ${sequence}`);
    }

    let group = groupMap.get(groupId);
    if (!group) {
      group = { id: groupId, title: groupTitle, grouped, sequence, slots: [] };
      groupMap.set(groupId, group);
      groups.push(group);
    }
    group.slots.push(slot);
  });

  return groups;
}

/**
 * 方法是什么：装饰报名页响应数据。
 * 方法作用：附加模块数组并让原始槽位同步使用编号后的显示名称。
 * 为什么添加：报名、取消和弹窗仍读取 slots，页面循环则读取 slotGroups。
 */
function decorateSignupData(dataValue) {
  if (!dataValue) return dataValue;
  const data = Object.assign({}, dataValue);
  data.slotGroups = buildSlotGroups(data.slots, data.language);
  data.slots = data.slotGroups.reduce((all, group) => all.concat(group.slots), []);
  return data;
}

module.exports = { GUEST_ROLE_KEYS, buildSlotGroups, decorateSignupData };
