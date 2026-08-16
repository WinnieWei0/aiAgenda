function pad(value) { return String(value).padStart(2, '0'); }
function dateText(year, month, day) { return `${year}-${pad(month)}-${pad(day)}`; }

Component({
  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: '选择日期区间' },
    start: { type: String, value: '' },
    end: { type: String, value: '' }
  },
  data: {
    year: new Date().getFullYear(), month: new Date().getMonth() + 1,
    years: [], months: Array.from({ length: 12 }, (_, index) => `${index + 1}月`),
    yearIndex: 0, monthIndex: 0, days: [], pendingStart: '', pendingEnd: ''
  },
  observers: {
    'visible,start,end': function sync(visible, start, end) {
      if (!visible) return;
      const initial = /^\d{4}-\d{2}-\d{2}$/.test(start) ? new Date(`${start}T00:00:00`) : new Date();
      const year = initial.getFullYear();
      const month = initial.getMonth() + 1;
      const years = Array.from({ length: new Date().getFullYear() - 1939 }, (_, index) => 1940 + index);
      this.setData({ years, year, month, yearIndex: Math.max(years.indexOf(year), 0), monthIndex: month - 1, pendingStart: start || '', pendingEnd: end || '' }, () => this.buildDays());
    }
  },
  methods: {
    buildDays() {
      const { year, month, pendingStart, pendingEnd } = this.data;
      const firstWeekday = new Date(year, month - 1, 1).getDay();
      const count = new Date(year, month, 0).getDate();
      const days = Array.from({ length: firstWeekday }, (_, index) => ({ key: `empty-${index}`, empty: true }));
      for (let day = 1; day <= count; day += 1) {
        const value = dateText(year, month, day);
        days.push({ key: value, value, day, selected: value === pendingStart || value === pendingEnd, inRange: Boolean(pendingStart && pendingEnd && value > pendingStart && value < pendingEnd) });
      }
      this.setData({ days });
    },
    handleYearChange(event) {
      const yearIndex = Number(event.detail.value);
      this.setData({ yearIndex, year: this.data.years[yearIndex] }, () => this.buildDays());
    },
    handleMonthChange(event) {
      const monthIndex = Number(event.detail.value);
      this.setData({ monthIndex, month: monthIndex + 1 }, () => this.buildDays());
    },
    chooseDay(event) {
      const value = event.currentTarget.dataset.value;
      if (!value) return;
      let pendingStart = this.data.pendingStart;
      let pendingEnd = this.data.pendingEnd;
      if (!pendingStart || pendingEnd || value < pendingStart) {
        pendingStart = value;
        pendingEnd = '';
      } else {
        pendingEnd = value;
      }
      this.setData({ pendingStart, pendingEnd }, () => this.buildDays());
    },
    clear() { this.setData({ pendingStart: '', pendingEnd: '' }, () => this.buildDays()); },
    cancel() { this.triggerEvent('cancel'); },
    confirm() {
      if (this.data.pendingStart && !this.data.pendingEnd) return;
      this.triggerEvent('confirm', { start: this.data.pendingStart, end: this.data.pendingEnd });
    },
    noop() {}
  }
});
