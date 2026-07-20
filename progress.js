document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);
  const number = (value) => Number(value || 0);
  const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const shiftDate = (date, days) => { const copy = new Date(date); copy.setDate(copy.getDate() + days); return copy; };
  const parseDate = (key) => { const [year, month, day] = String(key).split('-').map(Number); return new Date(year, month - 1, day); };
  const formatCompact = (value) => new Intl.NumberFormat('en-IN', { notation: value >= 100000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(Math.round(value));
  const niceDay = (key, options = { weekday: 'short' }) => parseDate(key).toLocaleDateString('en-IN', options);
  let activityRows = [];
  let measurementRows = [];
  let attendanceRows = [];
  let selectedRange = 'week';

  const setText = (id, value) => { if ($(id)) $(id).textContent = value; };
  const activeDay = (row) => number(row.steps) > 0 || number(row.minutes) > 0 || number(row.calories) > 0 || (Array.isArray(row.completed_items) && row.completed_items.length > 0);
  const activityMap = () => new Map(activityRows.map((row) => [row.activity_date, row]));

  const calculateStreak = () => {
    const active = new Set(activityRows.filter(activeDay).map((row) => row.activity_date));
    let cursor = new Date();
    if (!active.has(dateKey(cursor))) cursor = shiftDate(cursor, -1);
    let streak = 0;
    while (active.has(dateKey(cursor)) && streak < 366) { streak += 1; cursor = shiftDate(cursor, -1); }
    return streak;
  };

  const periodRows = (days, offset = 0) => {
    const end = shiftDate(new Date(), -offset);
    const start = shiftDate(end, -(days - 1));
    const startKey = dateKey(start);
    const endKey = dateKey(end);
    return activityRows.filter((row) => row.activity_date >= startKey && row.activity_date <= endKey);
  };

  const totals = (rows) => rows.reduce((sum, row) => ({ steps: sum.steps + number(row.steps), calories: sum.calories + number(row.calories), minutes: sum.minutes + number(row.minutes), workouts: sum.workouts + (activeDay(row) ? 1 : 0) }), { steps: 0, calories: 0, minutes: 0, workouts: 0 });

  const comparison = (current, previous) => {
    if (!previous) return current ? { text: 'New activity', className: 'up' } : { text: 'No change', className: 'neutral' };
    const percent = ((current - previous) / previous) * 100;
    return { text: `${percent >= 0 ? '+' : ''}${Math.round(percent)}%`, className: percent > 0 ? 'up' : percent < 0 ? 'down' : 'neutral' };
  };

  const renderComparison = (id, current, previous) => {
    const value = comparison(current, previous);
    const element = $(id);
    if (!element) return;
    element.textContent = value.text;
    element.className = `progress-change ${value.className}`;
  };

  const buildBuckets = () => {
    const map = activityMap();
    if (selectedRange === 'week') {
      return Array.from({ length: 7 }, (_, index) => {
        const date = shiftDate(new Date(), index - 6);
        const key = dateKey(date);
        const row = map.get(key) || {};
        return { label: niceDay(key), detail: niceDay(key, { day: '2-digit', month: 'short' }), steps: number(row.steps), calories: number(row.calories), minutes: number(row.minutes) };
      });
    }
    return Array.from({ length: 5 }, (_, bucketIndex) => {
      const firstOffset = -29 + (bucketIndex * 6);
      const dates = Array.from({ length: 6 }, (_, index) => shiftDate(new Date(), firstOffset + index));
      const rows = dates.map((date) => map.get(dateKey(date)) || {});
      return { label: `${dates[0].getDate()}-${dates[5].getDate()}`, detail: `${dates[0].toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} to ${dates[5].toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`, steps: rows.reduce((sum, row) => sum + number(row.steps), 0), calories: rows.reduce((sum, row) => sum + number(row.calories), 0), minutes: rows.reduce((sum, row) => sum + number(row.minutes), 0) };
    });
  };

  const renderStepsChart = () => {
    const buckets = buildBuckets();
    const max = Math.max(1, ...buckets.map((item) => item.steps));
    const target = $('progress-steps-chart');
    
    target.classList.toggle('monthly', selectedRange === 'month');
    target.innerHTML = buckets.map((item) => `<div class="progress-bar-column" title="${item.detail}: ${Math.round(item.steps).toLocaleString('en-IN')} steps"><b>${formatCompact(item.steps)}</b><i style="--bar:${Math.max(item.steps ? 8 : 2, Math.round(item.steps / max * 100))}%"></i><span>${item.label}</span></div>`).join('');
    setText('progress-chart-caption', selectedRange === 'week' ? 'Last 7 days · exact daily steps' : 'Last 30 days · grouped into 5 equal periods');
  };

  const renderWeight = () => {
    const target = $('progress-weight-chart');
    const rows = measurementRows.filter((row) => number(row.weight_kg) > 0).slice(0, 8).reverse();
    if (!rows.length) {
      target.innerHTML = '<div class="progress-empty">No weight records yet. Add a measurement from Profile.</div>';
      setText('progress-weight-change', '--'); setText('progress-latest-weight', '--');
      return;
    }
    const values = rows.map((row) => number(row.weight_kg));
    const min = Math.min(...values); const max = Math.max(...values); const spread = Math.max(1, max - min);
    const points = rows.map((row, index) => ({ x: rows.length === 1 ? 150 : 15 + (index * 270 / (rows.length - 1)), y: 95 - ((number(row.weight_kg) - min) / spread * 70), row }));
    const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
    target.innerHTML = `<svg viewBox="0 0 300 120" role="img" aria-label="Weight trend from ${values[0]} to ${values[values.length - 1]} kilograms"><path class="weight-area" d="${path} L ${points.at(-1).x} 105 L ${points[0].x} 105 Z"></path><path class="weight-line" d="${path}"></path>${points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="4"><title>${niceDay(point.row.measured_on, { day: '2-digit', month: 'short' })}: ${number(point.row.weight_kg).toFixed(1)} kg</title></circle>`).join('')}</svg><div class="weight-labels"><span>${niceDay(rows[0].measured_on, { day: '2-digit', month: 'short' })}</span><span>${niceDay(rows.at(-1).measured_on, { day: '2-digit', month: 'short' })}</span></div>`;
    const change = values.at(-1) - values[0];
    setText('progress-latest-weight', `${values.at(-1).toFixed(1)} kg`);
    setText('progress-weight-change', `${change > 0 ? '+' : ''}${change.toFixed(1)} kg`);
  };

  const attendanceCount = (days, offset = 0) => {
    const end = shiftDate(new Date(), -offset);
    const start = shiftDate(end, -(days - 1));
    return attendanceRows.filter((row) => { const date = new Date(row.checked_in_at); return date >= new Date(start.getFullYear(), start.getMonth(), start.getDate()) && date < shiftDate(new Date(end.getFullYear(), end.getMonth(), end.getDate()), 1); }).length;
  };

  const renderAll = () => {
    const days = selectedRange === 'week' ? 7 : 30;
    const current = totals(periodRows(days));
    const previous = totals(periodRows(days, days));
    const currentAttendance = attendanceCount(days);
    const previousAttendance = attendanceCount(days, days);
    setText('progress-total-steps', Math.round(current.steps).toLocaleString('en-IN'));
    setText('progress-total-calories', Math.round(current.calories).toLocaleString('en-IN'));
    setText('progress-total-minutes', Math.round(current.minutes).toLocaleString('en-IN'));
    setText('progress-total-workouts', current.workouts);
    setText('progress-streak', calculateStreak());
    setText('progress-attendance-current', currentAttendance);
    setText('progress-attendance-previous', previousAttendance);
    renderComparison('progress-steps-change', current.steps, previous.steps);
    renderComparison('progress-calories-change', current.calories, previous.calories);
    renderComparison('progress-attendance-change', currentAttendance, previousAttendance);
    renderStepsChart(); renderWeight();
    document.querySelectorAll('[data-progress-range]').forEach((button) => { const active = button.dataset.progressRange === selectedRange; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
    setText('progress-period-label', selectedRange === 'week' ? 'Last 7 days' : 'Last 30 days');
  };

  const loadProgress = async (user) => {
    const client = await window.getFriendsGymSupabaseClient?.();
    if (!client || !user) return;
    setText('progress-sync-status', 'Syncing secure cloud records...');
    const start366 = dateKey(shiftDate(new Date(), -366));
    const start90 = dateKey(shiftDate(new Date(), -90));
    const start180 = dateKey(shiftDate(new Date(), -180));
    const [activityResult, measurementResult, attendanceResult] = await Promise.all([
      client.from('activity_days').select('activity_date,steps,minutes,calories,completed_items,updated_at').eq('member_id', user.id).gte('activity_date', start366).order('activity_date', { ascending: true }),
      client.from('body_measurements').select('measured_on,weight_kg,body_fat_percent').eq('member_id', user.id).gte('measured_on', start180).order('measured_on', { ascending: false }),
      client.from('attendance').select('checked_in_at').eq('member_id', user.id).gte('checked_in_at', `${start90}T00:00:00`).order('checked_in_at', { ascending: false })
    ]);
    const error = activityResult.error || measurementResult.error || attendanceResult.error;
    if (error) {
      setText('progress-sync-status', `Progress sync failed: ${error.message}`);
      return;
    }
    activityRows = activityResult.data || [];
    measurementRows = measurementResult.data || [];
    attendanceRows = attendanceResult.data || [];
    renderAll();
    const latest = activityRows.map((row) => row.updated_at).filter(Boolean).sort().at(-1);
    setText('progress-sync-status', latest ? `Cloud synced · activity updated ${new Date(latest).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Cloud synced · start a workout to add progress');
  };

  document.querySelectorAll('[data-progress-range]').forEach((button) => button.addEventListener('click', () => { selectedRange = button.dataset.progressRange; renderAll(); }));
  document.querySelectorAll('[data-refresh-progress]').forEach((button) => button.addEventListener('click', async () => { const client = await window.getFriendsGymSupabaseClient?.(); if (!client) return; const { data } = await client.auth.getSession(); if (data.session?.user) loadProgress(data.session.user); }));

  (async () => {
    const client = await window.getFriendsGymSupabaseClient?.();
    if (!client) return;
    const { data } = await client.auth.getSession();
    if (data.session?.user) loadProgress(data.session.user);
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) setTimeout(() => loadProgress(session.user), 120);
      if (event === 'SIGNED_OUT') { activityRows = []; measurementRows = []; attendanceRows = []; setText('progress-sync-status', 'Sign in to view progress.'); }
    });
  })();
});