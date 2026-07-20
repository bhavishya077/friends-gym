document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);
  const safe = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

  const renderWorkout = (row) => {
    const target = $('member-workout-plan');
    if (!target) return;
    if (!row) {
      target.innerHTML = '<div class="member-plan-empty"><strong>No workout assigned</strong><span>Your gym trainer can assign a personalised plan.</span></div>';
      return;
    }
    const exercises = Array.isArray(row.plan) ? row.plan : [];
    target.innerHTML = `<div class="member-plan-head"><div><span>ACTIVE WORKOUT</span><h3>${safe(row.title)}</h3></div><b>${exercises.length} exercises</b></div><div class="member-plan-list">${exercises.map((item, index) => `<article><i>${index + 1}</i><div><strong>${safe(item.name)}</strong><span>${safe(item.notes || 'Trainer assigned exercise')}</span></div><p><b>${Number(item.sets) || 3}</b><small>sets</small></p><p><b>${safe(item.reps || '10')}</b><small>reps</small></p><p><b>${Number(item.rest_seconds) || 0}s</b><small>rest</small></p></article>`).join('')}</div>`;
  };

  const renderDiet = (row) => {
    const target = $('member-diet-plan');
    if (!target) return;
    if (!row) {
      target.innerHTML = '<div class="member-plan-empty"><strong>No diet assigned</strong><span>Your trainer can add a daily nutrition plan.</span></div>';
      return;
    }
    const meals = Array.isArray(row.plan) ? row.plan : [];
    target.innerHTML = `<div class="member-plan-head"><div><span>ACTIVE DIET</span><h3>${safe(row.title)}</h3></div><b>${Number(row.daily_calories) || '--'} kcal</b></div><div class="member-meal-list">${meals.map((item) => `<article><span>${safe(item.meal)}</span><strong>${safe(item.items)}</strong></article>`).join('')}</div>`;
  };

  const loadPlans = async (user) => {
    const client = await window.getFriendsGymSupabaseClient?.();
    if (!client || !user) return;
    $('member-plans-status').textContent = 'Syncing trainer plans...';
    const [workoutResult, dietResult] = await Promise.all([
      client.from('workout_plans').select('id,title,plan,active,created_at').eq('member_id', user.id).eq('active', true).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      client.from('diet_plans').select('id,title,daily_calories,plan,active,created_at').eq('member_id', user.id).eq('active', true).order('created_at', { ascending: false }).limit(1).maybeSingle()
    ]);
    renderWorkout(workoutResult.error ? null : workoutResult.data);
    renderDiet(dietResult.error ? null : dietResult.data);
    $('member-plans-status').textContent = workoutResult.error || dietResult.error ? 'Plan sync unavailable. Ask the gym admin to verify setup.' : 'Plans synced securely from your trainer.';
  };

  (async () => {
    const client = await window.getFriendsGymSupabaseClient?.();
    if (!client) return;
    const { data } = await client.auth.getSession();
    if (data.session?.user) loadPlans(data.session.user);
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) setTimeout(() => loadPlans(session.user), 100);
      if (event === 'SIGNED_OUT') { renderWorkout(null); renderDiet(null); $('member-plans-status').textContent = 'Sign in to view trainer plans.'; }
    });
  })();
});