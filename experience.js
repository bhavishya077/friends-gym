document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);
  const todayKey = () => new Date().toISOString().slice(0, 10);
  const safe = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || '') || fallback; } catch { return fallback; } };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const goalNames = { lose: 'Fat loss', maintain: 'General fitness', gain: 'Muscle gain', strength: 'Build strength', endurance: 'Improve endurance', mobility: 'Mobility & recovery' };
  const modal = $('onboarding-modal');
  const onboardingForm = $('onboarding-form');
  const closeOnboarding = $('onboarding-close');
  let client = null;
  let currentUser = null;
  let currentProfile = {};
  let nutritionLogs = [];
  let measurements = [];

  const ownerKey = (name) => `${name}:${currentUser?.id || 'guest'}`;
  const profileKey = () => ownerKey('friends-gym-profile-v2');
  const nutritionKey = () => ownerKey('friends-gym-nutrition-v1');
  const measurementKey = () => ownerKey('friends-gym-measurements-v1');

  const setText = (id, value) => { const element = $(id); if (element) element.textContent = value; };
  const dateLabel = (value) => {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  const sessionHistory = () => read(ownerKey('friends-gym-sessions-v3'), {});

  const renderMemberCode = () => {
    if (!currentUser) return;
    const compact = currentUser.id.replace(/-/g, '').slice(0, 10).toUpperCase();
    const code = `FG-${compact}`;
    setText('member-card-code', code);
    setText('member-card-name', currentProfile.full_name || currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || 'Friends Gym Member');
    const grid = $('member-code-grid');
    if (!grid) return;
    const seed = `${currentUser.id}${currentUser.email || ''}`;
    if (window.qrcode) {
      const qr = window.qrcode(0, 'M');
      qr.addData(`FGCHECKIN|${currentUser.id}|${currentProfile.checkin_token || code}`);
      qr.make();
      grid.classList.add('actual-qr');
      grid.innerHTML = qr.createSvgTag(3, 0);
      return;
    }
    const bits = Array.from({ length: 81 }, (_, index) => {
      const char = seed.charCodeAt(index % seed.length) || 1;
      const finder = (index % 9 < 3 && Math.floor(index / 9) < 3) || (index % 9 > 5 && Math.floor(index / 9) < 3) || (index % 9 < 3 && Math.floor(index / 9) > 5);
      return finder || ((char * (index + 3) + index * 17) % 5 < 2);
    });
    grid.classList.remove('actual-qr');
    grid.innerHTML = bits.map((on) => `<i class="${on ? '' : 'off'}"></i>`).join('');
  };

  const renderActivity = () => {
    const history = sessionHistory();
    const days = [];
    let streak = 0;
    let thisWeek = 0;
    let maxMinutes = 1;
    for (let offset = 6; offset >= 0; offset -= 1) {
      const date = new Date();
      date.setDate(date.getDate() - offset);
      const key = date.toISOString().slice(0, 10);
      const minutes = Number(history[key]?.minutes) || 0;
      maxMinutes = Math.max(maxMinutes, minutes);
      if (minutes > 0) thisWeek += 1;
      days.push({ label: date.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2), minutes });
    }
    for (let offset = 0; offset < 365; offset += 1) {
      const date = new Date(); date.setDate(date.getDate() - offset);
      if ((Number(history[date.toISOString().slice(0, 10)]?.minutes) || 0) <= 0) break;
      streak += 1;
    }
    setText('profile-streak', streak);
    setText('profile-week-workouts', thisWeek);
    const chart = $('profile-chart');
    if (chart) chart.innerHTML = days.map((day) => `<div class="${day.minutes ? '' : 'zero'}" style="--h:${Math.max(8, Math.round(day.minutes / maxMinutes * 100))}%" title="${day.minutes} minutes"><span>${day.label}</span></div>`).join('');
  };

  const renderProfile = () => {
    const goal = currentProfile.fitness_goal || 'maintain';
    const days = Number(currentProfile.workout_days) || 4;
    const level = currentProfile.experience_level || 'beginner';
    setText('profile-goal', goalNames[goal] || 'General fitness');
    setText('profile-goal-note', `${level.charAt(0).toUpperCase() + level.slice(1)} plan · ${days} workouts/week`);
    const recommendations = { lose: ['Fat Burn Circuit', 'Cardio + strength · 35 minutes'], maintain: ['Full Body Strength', 'Balanced training · 40 minutes'], gain: ['Muscle Builder', 'Progressive strength · 50 minutes'], strength: ['Power Strength', 'Compound lifts · 45 minutes'], endurance: ['Conditioning Session', 'Cardio intervals · 40 minutes'], mobility: ['Mobility Flow', 'Recovery and movement · 25 minutes'] };
    const recommendation = recommendations[goal] || recommendations.maintain;
    const recommendedTitle = document.querySelector('.recommended-copy h3');
    const recommendedNote = document.querySelector('.recommended-copy p');
    if (recommendedTitle) recommendedTitle.textContent = recommendation[0];
    if (recommendedNote) recommendedNote.textContent = recommendation[1];
    setText('trainer-level', level.toUpperCase());
    const fields = {
      'settings-name': currentProfile.full_name || '', 'settings-phone': currentProfile.phone || '',
      'settings-height': currentProfile.height_cm || '', 'settings-weight': currentProfile.weight_kg || '',
      'settings-goal': goal, 'settings-level': level, 'settings-days': String(days), 'settings-units': currentProfile.units || 'metric',
      'onboarding-name': currentProfile.full_name || currentUser?.user_metadata?.full_name || '',
      'onboarding-height': currentProfile.height_cm || '', 'onboarding-weight': currentProfile.weight_kg || '',
      'onboarding-goal': currentProfile.fitness_goal || '', 'onboarding-level': level, 'onboarding-days': String(days)
    };
    Object.entries(fields).forEach(([id, value]) => { if ($(id)) $(id).value = value; });
    const prefs = currentProfile.notification_preferences || { workout: true, classes: true, membership: true };
    if ($('setting-workout-reminders')) $('setting-workout-reminders').checked = prefs.workout !== false;
    if ($('setting-class-reminders')) $('setting-class-reminders').checked = prefs.classes !== false;
    if ($('setting-membership-reminders')) $('setting-membership-reminders').checked = prefs.membership !== false;
    if ($('measurement-weight') && currentProfile.weight_kg) $('measurement-weight').value = currentProfile.weight_kg;
    renderMemberCode();
    renderActivity();
  };

  const openOnboarding = (required = false) => {
    if (!modal) return;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    if (closeOnboarding) closeOnboarding.hidden = required;
  };
  const hideOnboarding = () => {
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = '';
  };

  const profilePayloadFrom = (source) => ({
    full_name: $(source === 'onboarding' ? 'onboarding-name' : 'settings-name').value.trim(),
    phone: source === 'settings' ? $('settings-phone').value.trim() || null : (currentProfile.phone || null),
    height_cm: Number($(source === 'onboarding' ? 'onboarding-height' : 'settings-height').value) || null,
    weight_kg: Number($(source === 'onboarding' ? 'onboarding-weight' : 'settings-weight').value) || null,
    fitness_goal: $(source === 'onboarding' ? 'onboarding-goal' : 'settings-goal').value,
    experience_level: $(source === 'onboarding' ? 'onboarding-level' : 'settings-level').value,
    workout_days: Number($(source === 'onboarding' ? 'onboarding-days' : 'settings-days').value) || 4,
    onboarding_complete: true,
    units: source === 'settings' ? $('settings-units').value : (currentProfile.units || 'metric'),
    notification_preferences: source === 'settings' ? {
      workout: $('setting-workout-reminders').checked,
      classes: $('setting-class-reminders').checked,
      membership: $('setting-membership-reminders').checked
    } : (currentProfile.notification_preferences || { workout: true, classes: true, membership: true })
  });

  const saveProfile = async (payload, statusId) => {
    currentProfile = { ...currentProfile, ...payload };
    write(profileKey(), currentProfile);
    renderProfile();
    setText(statusId, 'Saved on this device. Syncing securely...');
    if (client && currentUser) {
      const { error } = await client.from('profiles').update(payload).eq('id', currentUser.id);
      setText(statusId, error ? 'Saved on this device. Run member-experience.sql to enable cloud sync.' : 'Profile saved securely to your account.');
    }
    return currentProfile;
  };

  const renderMeasurements = () => {
    const list = $('measurement-list');
    if (!list) return;
    list.innerHTML = measurements.length ? measurements.slice(0, 5).map((row) => `<div class="measurement-row"><div><strong>${Number(row.weight_kg).toFixed(1)} kg${row.body_fat_percent ? ` · ${Number(row.body_fat_percent).toFixed(1)}% body fat` : ''}</strong><span>${dateLabel(row.measured_on)}${row.waist_cm ? ` · Waist ${Number(row.waist_cm).toFixed(1)} cm` : ''}</span></div><b>${row.weight_kg < (measurements[1]?.weight_kg || row.weight_kg) ? '↓' : '•'}</b></div>`).join('') : '<div class="empty-state">No measurements saved yet.</div>';
  };

  const renderNutrition = () => {
    const today = todayKey();
    const rows = nutritionLogs.filter((row) => row.logged_on === today);
    const totals = rows.reduce((sum, row) => ({ calories: sum.calories + Number(row.calories || 0), protein: sum.protein + Number(row.protein_g || 0), carbs: sum.carbs + Number(row.carbs_g || 0), fats: sum.fats + Number(row.fats_g || 0) }), { calories: 0, protein: 0, carbs: 0, fats: 0 });
    setText('nutrition-log-date', new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }));
    setText('nutrition-log-calories', Math.round(totals.calories)); setText('nutrition-log-protein', `${Math.round(totals.protein)}g`); setText('nutrition-log-carbs', `${Math.round(totals.carbs)}g`); setText('nutrition-log-fats', `${Math.round(totals.fats)}g`);
    if (rows.length) { setText('nutrition-calories', Math.round(totals.calories).toLocaleString('en-IN')); setText('nutrition-protein', `${Math.round(totals.protein)}g`); setText('nutrition-carbs', `${Math.round(totals.carbs)}g`); setText('nutrition-fats', `${Math.round(totals.fats)}g`); }
    const list = $('nutrition-log-list');
    if (list) list.innerHTML = rows.length ? rows.map((row) => `<div class="nutrition-log-row"><div><strong>${safe(row.item_name)}</strong><span>${safe(row.meal_type)} · ${Math.round(row.calories)} kcal · P ${Math.round(row.protein_g || 0)}g</span></div><button type="button" data-delete-nutrition="${safe(row.id)}" aria-label="Delete ${safe(row.item_name)}">×</button></div>`).join('') : '<div class="empty-state">Add your first meal for today.</div>';
  };

  const renderMembership = async () => {
    if (!client || !currentUser) return;
    const [membershipResult, attendanceResult, paymentResult] = await Promise.all([
      client.from('memberships').select('id,plan_name,status,starts_on,expires_on,amount_inr,created_at').eq('member_id', currentUser.id).order('created_at', { ascending: false }).limit(10),
      client.from('attendance').select('id,checked_in_at').eq('member_id', currentUser.id).order('checked_in_at', { ascending: false }).limit(100),
      client.from('payment_transactions').select('id,status,plan_name,amount_paise,created_at').eq('member_id', currentUser.id).order('created_at', { ascending: false }).limit(10)
    ]);
    const memberships = membershipResult.data || [];
    const visits = attendanceResult.data || [];
    const payments = paymentResult.data || [];
    setText('profile-attendance', visits.length); setText('membership-visits', visits.length); setText('membership-payments', payments.filter((row) => row.status === 'paid').length);
    const expiry = memberships[0]?.expires_on ? new Date(`${memberships[0].expires_on}T23:59:59`) : null;
    setText('membership-days-left', expiry ? Math.max(0, Math.ceil((expiry - new Date()) / 86400000)) : '--');
    const history = $('membership-history');
    if (history) history.innerHTML = memberships.length ? memberships.slice(0, 4).map((row) => `<div class="membership-history-row"><div><strong>${safe(row.plan_name)} · ${safe(row.status)}</strong><span>${dateLabel(row.starts_on || row.created_at.slice(0, 10))} to ${dateLabel(row.expires_on || row.created_at.slice(0, 10))}</span></div><b>Rs ${Number(row.amount_inr || 0).toLocaleString('en-IN')}</b></div>`).join('') : '<div class="empty-state">No membership history yet.</div>';
  };

  const loadExperience = async (user) => {
    currentUser = user;
    currentProfile = read(profileKey(), {});
    nutritionLogs = read(nutritionKey(), []);
    measurements = read(measurementKey(), []);
    if (client) {
      const profileResult = await client.from('profiles').select('full_name,phone,height_cm,weight_kg,fitness_goal,experience_level,workout_days,onboarding_complete,units,notification_preferences,checkin_token').eq('id', user.id).maybeSingle();
      if (!profileResult.error && profileResult.data) currentProfile = { ...currentProfile, ...profileResult.data };
      const measurementResult = await client.from('body_measurements').select('*').eq('member_id', user.id).order('measured_on', { ascending: false }).limit(20);
      if (!measurementResult.error) measurements = measurementResult.data || [];
      const nutritionResult = await client.from('nutrition_logs').select('*').eq('member_id', user.id).eq('logged_on', todayKey()).order('created_at', { ascending: false });
      if (!nutritionResult.error) nutritionLogs = nutritionResult.data || [];
    }
    write(profileKey(), currentProfile); write(measurementKey(), measurements); write(nutritionKey(), nutritionLogs);
    renderProfile(); renderMeasurements(); renderNutrition(); renderMembership();
    if (!currentProfile.onboarding_complete) openOnboarding(true);
  };

  onboardingForm?.addEventListener('submit', async (event) => { event.preventDefault(); await saveProfile(profilePayloadFrom('onboarding'), 'onboarding-status'); hideOnboarding(); window.showScreen?.('home'); });
  closeOnboarding?.addEventListener('click', hideOnboarding);
  $('edit-profile-goal')?.addEventListener('click', () => openOnboarding(false));
  $('open-settings')?.addEventListener('click', () => window.showScreen?.('settings'));
  $('settings-profile-form')?.addEventListener('submit', async (event) => { event.preventDefault(); await saveProfile(profilePayloadFrom('settings'), 'settings-profile-status'); });
  ['setting-workout-reminders', 'setting-class-reminders', 'setting-membership-reminders', 'settings-units'].forEach((id) => $(id)?.addEventListener('change', async () => {
    if (!currentUser) return;
    await saveProfile({ units: $('settings-units').value, notification_preferences: { workout: $('setting-workout-reminders').checked, classes: $('setting-class-reminders').checked, membership: $('setting-membership-reminders').checked } }, 'settings-notification-status');
  }));

  $('measurement-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!currentUser) return window.showScreen?.('auth');
    const row = { id: crypto.randomUUID(), member_id: currentUser.id, measured_on: todayKey(), weight_kg: Number($('measurement-weight').value), waist_cm: Number($('measurement-waist').value) || null, body_fat_percent: Number($('measurement-bodyfat').value) || null };
    measurements = [row, ...measurements.filter((item) => item.measured_on !== row.measured_on)]; write(measurementKey(), measurements); renderMeasurements();
    currentProfile.weight_kg = row.weight_kg; write(profileKey(), currentProfile); renderProfile();
    if (client) await client.from('body_measurements').upsert(row, { onConflict: 'member_id,measured_on' });
    event.target.reset(); if (currentProfile.weight_kg) $('measurement-weight').value = currentProfile.weight_kg;
  });

  $('nutrition-log-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!currentUser) return window.showScreen?.('auth');
    const row = { id: crypto.randomUUID(), member_id: currentUser.id, logged_on: todayKey(), meal_type: $('nutrition-meal-type').value, item_name: $('nutrition-item-name').value.trim(), calories: Number($('nutrition-item-calories').value), protein_g: Number($('nutrition-item-protein').value) || 0, carbs_g: Number($('nutrition-item-carbs').value) || 0, fats_g: Number($('nutrition-item-fats').value) || 0, created_at: new Date().toISOString() };
    nutritionLogs = [row, ...nutritionLogs]; write(nutritionKey(), nutritionLogs); renderNutrition(); event.target.reset();
    if (client) await client.from('nutrition_logs').insert(row);
  });
  $('nutrition-log-list')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-delete-nutrition]'); if (!button) return;
    const id = button.dataset.deleteNutrition; nutritionLogs = nutritionLogs.filter((row) => String(row.id) !== id); write(nutritionKey(), nutritionLogs); renderNutrition();
    if (client && currentUser) await client.from('nutrition_logs').delete().eq('id', id).eq('member_id', currentUser.id);
  });

  $('test-notification')?.addEventListener('click', async () => {
    const status = $('settings-notification-status');
    try {
      const nativeNotifications = window.Capacitor?.Plugins?.LocalNotifications;
      if (nativeNotifications) {
        let permission = await nativeNotifications.checkPermissions();
        if (permission.display !== 'granted') permission = await nativeNotifications.requestPermissions();
        if (permission.display !== 'granted') throw new Error('Notification permission is off.');
        await nativeNotifications.schedule({ notifications: [{ id: 909001, title: 'Friends Gym', body: 'Your reminders are ready. Keep training strong!', schedule: { at: new Date(Date.now() + 3000) } }] });
        status.textContent = 'Test notification scheduled in 3 seconds.';
      } else if ('Notification' in window) {
        const permission = await Notification.requestPermission(); if (permission !== 'granted') throw new Error('Notification permission is off.');
        new Notification('Friends Gym', { body: 'Your reminders are ready. Keep training strong!' }); status.textContent = 'Test notification sent.';
      } else throw new Error('Notifications are not supported on this device.');
    } catch (error) { status.textContent = error.message; }
  });

  (async () => {
    client = await window.getFriendsGymSupabaseClient?.();
    if (!client) { renderNutrition(); renderActivity(); return; }
    const { data } = await client.auth.getSession();
    if (data.session?.user) await loadExperience(data.session.user);
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) setTimeout(() => loadExperience(session.user), 50);
      if (event === 'SIGNED_OUT') { currentUser = null; currentProfile = {}; hideOnboarding(); }
    });
  })();
});
