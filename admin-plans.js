(() => {
  const config = window.FRIENDS_GYM_SUPABASE || {};
  const client = window.supabase?.createClient(config.url, config.anonKey);
  const $ = (id) => document.getElementById(id);
  const safe = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const niceDate = (value) => value ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value)) : '--';
  let selectedMemberId = '';
  let adminUserId = '';
  let currentWorkout = null;
  let currentDiet = null;

  const setStatus = (text, error = false) => {
    const status = $('member-detail-status');
    if (!status) return;
    status.textContent = text;
    status.classList.toggle('error', error);
  };

  const parseWorkout = (value) => {
    const rows = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const [name, sets = '3', reps = '10', rest = '60', notes = ''] = line.split('|').map((part) => part.trim());
      return { name, sets: Math.max(1, Number(sets) || 3), reps: reps || '10', rest_seconds: Math.max(0, Number(rest) || 0), notes };
    }).filter((row) => row.name);
    if (!rows.length) throw new Error('At least one exercise add karein.');
    return rows;
  };

  const parseDiet = (value) => {
    const rows = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const [meal, items = ''] = line.split('|').map((part) => part.trim());
      return { meal, items };
    }).filter((row) => row.meal && row.items);
    if (!rows.length) throw new Error('At least one meal add karein.');
    return rows;
  };

  const workoutToText = (plan) => (Array.isArray(plan) ? plan : []).map((row) => `${row.name || ''} | ${row.sets || 3} | ${row.reps || 10} | ${row.rest_seconds || 0} | ${row.notes || ''}`).join('\n');
  const dietToText = (plan) => (Array.isArray(plan) ? plan : []).map((row) => `${row.meal || ''} | ${row.items || ''}`).join('\n');

  const renderWorkout = (row) => {
    const target = $('admin-current-workout');
    if (!target) return;
    const exercises = Array.isArray(row?.plan) ? row.plan : [];
    target.innerHTML = row ? `<div class="assigned-plan-head"><div><span>ACTIVE WORKOUT</span><strong>${safe(row.title)}</strong></div><small>${niceDate(row.created_at)}</small></div><div class="assigned-plan-items">${exercises.map((item) => `<p><b>${safe(item.name)}</b><span>${Number(item.sets) || 3} sets · ${safe(item.reps || '10')} reps · ${Number(item.rest_seconds) || 0}s rest</span></p>`).join('')}</div>` : '<p class="empty">No workout plan assigned.</p>';
  };

  const renderDiet = (row) => {
    const target = $('admin-current-diet');
    if (!target) return;
    const meals = Array.isArray(row?.plan) ? row.plan : [];
    target.innerHTML = row ? `<div class="assigned-plan-head"><div><span>ACTIVE DIET</span><strong>${safe(row.title)}</strong></div><small>${Number(row.daily_calories) || '--'} kcal</small></div><div class="assigned-plan-items">${meals.map((item) => `<p><b>${safe(item.meal)}</b><span>${safe(item.items)}</span></p>`).join('')}</div>` : '<p class="empty">No diet plan assigned.</p>';
  };

  const openMember = async (memberId) => {
    if (!client || !memberId) return;
    selectedMemberId = memberId;
    const card = $('member-detail-card');
    card.hidden = false;
    setStatus('Loading secure member dashboard...');
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const [profileResult, membershipResult, attendanceResult, activityResult, measurementResult, workoutResult, dietResult] = await Promise.all([
      client.from('profiles').select('id,full_name,phone,role,created_at,fitness_goal,experience_level').eq('id', memberId).maybeSingle(),
      client.from('memberships').select('*').eq('member_id', memberId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      client.from('attendance').select('id,checked_in_at', { count: 'exact' }).eq('member_id', memberId).order('checked_in_at', { ascending: false }).limit(1),
      client.from('activity_days').select('steps,calories,minutes').eq('member_id', memberId),
      client.from('body_measurements').select('weight_kg,body_fat_percent,measured_on').eq('member_id', memberId).order('measured_on', { ascending: false }).limit(1).maybeSingle(),
      client.from('workout_plans').select('*').eq('member_id', memberId).eq('active', true).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      client.from('diet_plans').select('*').eq('member_id', memberId).eq('active', true).order('created_at', { ascending: false }).limit(1).maybeSingle()
    ]);
    if (profileResult.error || !profileResult.data) {
      setStatus(profileResult.error?.message || 'Member not found.', true);
      return;
    }
    const profile = profileResult.data;
    const membership = membershipResult.data;
    const activities = activityResult.data || [];
    const totals = activities.reduce((sum, item) => ({ steps: sum.steps + Number(item.steps || 0), calories: sum.calories + Number(item.calories || 0), minutes: sum.minutes + Number(item.minutes || 0) }), { steps: 0, calories: 0, minutes: 0 });
    $('detail-member-avatar').textContent = (profile.full_name || 'M').charAt(0).toUpperCase();
    $('detail-member-name').textContent = profile.full_name || 'Friends Gym Member';
    $('detail-member-meta').textContent = `${profile.phone || 'Phone not added'} · Joined ${niceDate(profile.created_at)}`;
    $('detail-member-id').textContent = `FG-${profile.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    $('detail-membership').textContent = membership?.plan_name || 'No plan';
    $('detail-membership-note').textContent = membership ? `${membership.status} · valid to ${niceDate(membership.expires_on)}` : 'Membership not assigned';
    $('detail-visits').textContent = attendanceResult.count || 0;
    $('detail-last-visit').textContent = attendanceResult.data?.[0]?.checked_in_at ? niceDate(attendanceResult.data[0].checked_in_at) : 'No visits';
    $('detail-steps').textContent = Math.round(totals.steps).toLocaleString('en-IN');
    $('detail-calories').textContent = Math.round(totals.calories).toLocaleString('en-IN');
    $('detail-minutes').textContent = Math.round(totals.minutes).toLocaleString('en-IN');
    $('detail-weight').textContent = measurementResult.data?.weight_kg ? `${Number(measurementResult.data.weight_kg).toFixed(1)} kg` : '--';
    currentWorkout = workoutResult.data || null;
    currentDiet = dietResult.data || null;
    $('workout-plan-title').value = currentWorkout?.title || '';
    $('workout-plan-lines').value = workoutToText(currentWorkout?.plan);
    $('diet-plan-title').value = currentDiet?.title || '';
    $('diet-plan-calories').value = currentDiet?.daily_calories || '';
    $('diet-plan-lines').value = dietToText(currentDiet?.plan);
    renderWorkout(currentWorkout);
    renderDiet(currentDiet);
    $('membership-member').value = memberId;
    $('attendance-member').value = memberId;
    setStatus('Member dashboard ready. Plans are protected by admin access.');
  };

  $('member-list')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-open-member]');
    if (button) openMember(button.dataset.openMember);
  });
  $('close-member-detail')?.addEventListener('click', () => { selectedMemberId = ''; $('member-detail-card').hidden = true; });
  $('detail-edit-membership')?.addEventListener('click', () => { $('membership-member').value = selectedMemberId; $('membership-form').scrollIntoView({ behavior: 'smooth', block: 'center' }); });

  $('workout-plan-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!selectedMemberId) return setStatus('Pehle member select karein.', true);
    try {
      const payload = { member_id: selectedMemberId, title: $('workout-plan-title').value.trim(), plan: parseWorkout($('workout-plan-lines').value), assigned_by: adminUserId || null, active: true };
      const result = currentWorkout ? await client.from('workout_plans').update(payload).eq('id', currentWorkout.id).select().single() : await client.from('workout_plans').insert(payload).select().single();
      if (result.error) throw result.error;
      currentWorkout = result.data;
      renderWorkout(currentWorkout);
      setStatus('Workout plan member account me securely assigned.');
    } catch (error) { setStatus(`Workout plan save nahi hua: ${error.message}`, true); }
  });

  $('diet-plan-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!selectedMemberId) return setStatus('Pehle member select karein.', true);
    try {
      const payload = { member_id: selectedMemberId, title: $('diet-plan-title').value.trim(), daily_calories: Number($('diet-plan-calories').value) || null, plan: parseDiet($('diet-plan-lines').value), assigned_by: adminUserId || null, active: true };
      const result = currentDiet ? await client.from('diet_plans').update(payload).eq('id', currentDiet.id).select().single() : await client.from('diet_plans').insert(payload).select().single();
      if (result.error) throw result.error;
      currentDiet = result.data;
      renderDiet(currentDiet);
      setStatus('Diet plan member account me securely assigned.');
    } catch (error) { setStatus(`Diet plan save nahi hua: ${error.message}`, true); }
  });

  (async () => {
    if (!client) return;
    const { data } = await client.auth.getSession();
    adminUserId = data.session?.user?.id || '';
  })();
})();