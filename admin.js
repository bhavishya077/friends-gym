(() => {
  const config = window.FRIENDS_GYM_SUPABASE || {};
  const client = window.supabase?.createClient(config.url, config.anonKey);
  const locked = document.getElementById('admin-locked');
  const panel = document.getElementById('admin-panel');
  const message = document.getElementById('message');
  let members = [];
  let memberships = [];
  let attendance = [];
  let classes = [];
  let selectedRosterClass = null;

  const say = (text, error = false) => {
    message.textContent = text;
    message.classList.toggle('error', error);
  };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
  const memberName = (member) => member.full_name || member.phone || `Member ${member.id.slice(0, 6)}`;
  const niceDate = (value) => value ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value)) : 'Not set';
  const niceDateTime = (value) => value ? new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : 'Not set';
  const toLocalInput = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Date(date.getTime() - (date.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
  };
  const isFuture = (item) => new Date(item.starts_at).getTime() >= Date.now();

  const renderMembers = () => {
    const q = document.getElementById('member-search').value.trim().toLowerCase();
    const filtered = members.filter((member) => `${member.full_name || ''} ${member.phone || ''}`.toLowerCase().includes(q));
    document.getElementById('member-list').innerHTML = filtered.length ? filtered.map((member) => {
      const plan = memberships.find((item) => item.member_id === member.id);
      return `<article class="record"><div class="avatar">${escapeHtml(memberName(member).charAt(0).toUpperCase())}</div><div><strong>${escapeHtml(memberName(member))}</strong><span>${escapeHtml(member.phone || 'Phone not added')}</span></div><div class="state ${escapeHtml(plan?.status || '')}"><b>${escapeHtml(plan?.plan_name || 'No plan')}</b><span>${plan ? niceDate(plan.expires_on) : 'Not active'}</span></div></article>`;
    }).join('') : '<p class="empty">No matching members.</p>';
    const options = members.map((member) => `<option value="${escapeHtml(member.id)}">${escapeHtml(memberName(member))}</option>`).join('');
    ['membership-member', 'attendance-member'].forEach((id) => {
      document.getElementById(id).innerHTML = `<option value="">Select member</option>${options}`;
    });
    document.getElementById('attendance-list').innerHTML = attendance.slice(0, 5).map((entry) => {
      const member = members.find((item) => item.id === entry.member_id);
      return `<article class="record"><div class="avatar">OK</div><div><strong>${escapeHtml(member ? memberName(member) : 'Member')}</strong><span>${escapeHtml(niceDateTime(entry.checked_in_at))}</span></div><div class="state active"><b>Checked in</b><span>${escapeHtml(entry.check_in_method)}</span></div></article>`;
    }).join('') || '<p class="empty">No attendance yet.</p>';
  };

  const filteredClasses = () => {
    const filter = document.getElementById('class-filter').value;
    if (filter === 'upcoming') return classes.filter((item) => item.active && isFuture(item)).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    if (filter === 'past') return classes.filter((item) => new Date(item.starts_at) < new Date()).sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at));
    if (filter === 'cancelled') return classes.filter((item) => !item.active);
    return classes;
  };

  const renderClasses = () => {
    const list = filteredClasses();
    document.getElementById('admin-class-list').innerHTML = list.length ? list.map((item) => {
      const booked = Number(item.booked_count || 0);
      const capacity = Number(item.capacity || 0);
      const state = !item.active ? 'cancelled' : (isFuture(item) ? 'upcoming' : 'finished');
      return `<article class="admin-class ${state}">
        <div class="class-main"><div class="class-heading"><span>${escapeHtml(item.category || 'Fitness')}</span><b>${escapeHtml(item.title)}</b></div><small>${escapeHtml(niceDateTime(item.starts_at))} · ${Number(item.duration_minutes)} min</small><small>${escapeHtml(item.trainer_name || 'Coach')} · ${escapeHtml(item.level || 'All levels')}</small></div>
        <div class="class-stats"><strong>${booked}/${capacity}</strong><span>confirmed</span></div>
        <div class="class-actions"><button type="button" data-class-command="roster" data-class-id="${escapeHtml(item.id)}">Roster</button><button type="button" data-class-command="edit" data-class-id="${escapeHtml(item.id)}">Edit</button>${item.active ? `<button class="danger" type="button" data-class-command="cancel" data-class-id="${escapeHtml(item.id)}">Cancel</button>` : '<span class="cancelled-label">Cancelled</span>'}</div>
      </article>`;
    }).join('') : '<p class="empty">Is filter mein koi class nahi hai.</p>';
  };

  const renderSummary = () => {
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('member-total').textContent = members.length;
    document.getElementById('active-total').textContent = memberships.filter((item) => item.status === 'active').length;
    document.getElementById('today-total').textContent = attendance.filter((item) => item.checked_in_at?.slice(0, 10) === today).length;
    document.getElementById('class-total').textContent = classes.filter((item) => item.active && isFuture(item)).length;
  };

  const render = () => {
    renderMembers();
    renderClasses();
    renderSummary();
  };

  const load = async () => {
    say('Refreshing gym records...');
    const [memberResult, membershipResult, attendanceResult, classResult] = await Promise.all([
      client.from('profiles').select('id,full_name,phone,role,created_at').order('created_at', { ascending: false }),
      client.from('memberships').select('*').order('created_at', { ascending: false }),
      client.from('attendance').select('*').order('checked_in_at', { ascending: false }).limit(50),
      client.rpc('admin_get_class_sessions')
    ]);
    const coreError = memberResult.error || membershipResult.error || attendanceResult.error;
    if (coreError) {
      say(`Records load nahi hue: ${coreError.message}`, true);
      return;
    }
    members = memberResult.data || [];
    memberships = membershipResult.data || [];
    attendance = attendanceResult.data || [];
    classes = classResult.data || [];
    render();
    if (classResult.error) say('Members load ho gaye. Dynamic classes ke liye admin-classes.sql run karein.', true);
    else say('Dashboard live data ke saath up to date hai.');
  };

  const resetClassForm = () => {
    document.getElementById('class-form').reset();
    document.getElementById('class-id').value = '';
    document.getElementById('class-duration').value = '45';
    document.getElementById('class-capacity').value = '20';
    document.getElementById('class-active').checked = true;
    document.getElementById('class-form-heading').textContent = 'Create class';
    document.getElementById('save-class').textContent = 'Publish class';
  };

  const editClass = (classId) => {
    const item = classes.find((entry) => entry.id === classId);
    if (!item) return;
    document.getElementById('class-id').value = item.id;
    document.getElementById('class-title').value = item.title || '';
    document.getElementById('class-trainer').value = item.trainer_name || '';
    document.getElementById('class-category').value = item.category || 'Fitness';
    document.getElementById('class-level').value = item.level || 'All levels';
    document.getElementById('class-start').value = toLocalInput(item.starts_at);
    document.getElementById('class-duration').value = item.duration_minutes || 45;
    document.getElementById('class-capacity').value = item.capacity || 20;
    document.getElementById('class-description').value = item.description || '';
    document.getElementById('class-active').checked = Boolean(item.active);
    document.getElementById('class-form-heading').textContent = 'Edit class';
    document.getElementById('save-class').textContent = 'Save changes';
    document.querySelector('.class-manager').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const openRoster = async (classId) => {
    const item = classes.find((entry) => entry.id === classId);
    selectedRosterClass = item || null;
    const card = document.getElementById('roster-card');
    card.hidden = false;
    document.getElementById('roster-title').textContent = item?.title || 'Class bookings';
    document.getElementById('class-roster').innerHTML = '<p class="empty">Loading roster...</p>';
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const { data, error } = await client.rpc('admin_get_class_roster', { p_class_id: classId });
    if (error) {
      document.getElementById('class-roster').innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
      return;
    }
    document.getElementById('class-roster').innerHTML = data?.length ? data.map((booking) => `<article class="roster-row"><div class="avatar">${escapeHtml(booking.member_name.charAt(0).toUpperCase())}</div><div><strong>${escapeHtml(booking.member_name)}</strong><span>${escapeHtml(booking.member_phone || 'Phone not added')}</span></div><select data-booking-status="${escapeHtml(booking.booking_id)}" aria-label="Attendance status for ${escapeHtml(booking.member_name)}"><option value="booked" ${booking.status === 'booked' ? 'selected' : ''}>Booked</option><option value="attended" ${booking.status === 'attended' ? 'selected' : ''}>Present</option><option value="absent" ${booking.status === 'absent' ? 'selected' : ''}>Absent</option><option value="cancelled" ${booking.status === 'cancelled' ? 'selected' : ''}>Cancelled</option></select></article>`).join('') : '<p class="empty">Abhi kisi member ne is class ko book nahi kiya.</p>';
  };

  document.getElementById('member-search').addEventListener('input', renderMembers);
  document.getElementById('class-filter').addEventListener('change', renderClasses);
  document.getElementById('refresh').addEventListener('click', load);
  document.getElementById('refresh-classes').addEventListener('click', load);
  document.getElementById('reset-class').addEventListener('click', resetClassForm);
  document.getElementById('close-roster').addEventListener('click', () => {
    selectedRosterClass = null;
    document.getElementById('roster-card').hidden = true;
  });

  document.getElementById('class-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.getElementById('save-class');
    button.disabled = true;
    say('Class save ho rahi hai...');
    const payload = {
      p_class_id: document.getElementById('class-id').value || null,
      p_title: document.getElementById('class-title').value.trim(),
      p_category: document.getElementById('class-category').value,
      p_level: document.getElementById('class-level').value,
      p_description: document.getElementById('class-description').value.trim(),
      p_trainer_name: document.getElementById('class-trainer').value.trim(),
      p_starts_at: new Date(document.getElementById('class-start').value).toISOString(),
      p_duration_minutes: Number(document.getElementById('class-duration').value),
      p_capacity: Number(document.getElementById('class-capacity').value),
      p_active: document.getElementById('class-active').checked
    };
    const { error } = await client.rpc('admin_upsert_class', payload);
    button.disabled = false;
    if (error) {
      say(`Class save nahi hui: ${error.message}`, true);
      return;
    }
    resetClassForm();
    say('Class successfully published.');
    await load();
  });

  document.getElementById('admin-class-list').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-class-command]');
    if (!button) return;
    const classId = button.dataset.classId;
    if (button.dataset.classCommand === 'edit') return editClass(classId);
    if (button.dataset.classCommand === 'roster') return openRoster(classId);
    if (button.dataset.classCommand === 'cancel') {
      const item = classes.find((entry) => entry.id === classId);
      if (!window.confirm(`Cancel ${item?.title || 'this class'} and its active bookings?`)) return;
      button.disabled = true;
      const { error } = await client.rpc('admin_cancel_class', { p_class_id: classId });
      if (error) say(`Class cancel nahi hui: ${error.message}`, true);
      else {
        say('Class aur active bookings cancel ho gaye.');
        await load();
      }
      button.disabled = false;
    }
  });

  document.getElementById('class-roster').addEventListener('change', async (event) => {
    const select = event.target.closest('[data-booking-status]');
    if (!select) return;
    select.disabled = true;
    const { error } = await client.rpc('admin_set_class_attendance', { p_booking_id: select.dataset.bookingStatus, p_status: select.value });
    select.disabled = false;
    if (error) say(`Attendance update nahi hui: ${error.message}`, true);
    else {
      say('Class attendance updated.');
      await load();
      if (selectedRosterClass) await openRoster(selectedRosterClass.id);
    }
  });

  document.getElementById('membership-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const memberId = document.getElementById('membership-member').value;
    const existing = memberships.find((item) => item.member_id === memberId);
    const payload = { member_id: memberId, plan_name: document.getElementById('plan').value, status: document.getElementById('status').value, starts_on: document.getElementById('starts').value, expires_on: document.getElementById('expires').value, amount_inr: Number(document.getElementById('amount').value) };
    const result = existing ? await client.from('memberships').update(payload).eq('id', existing.id) : await client.from('memberships').insert(payload);
    if (result.error) {
      say(`Membership save nahi hui: ${result.error.message}`, true);
      return;
    }
    event.target.reset();
    say('Membership saved successfully.');
    await load();
  });

  document.getElementById('attendance-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const memberId = document.getElementById('attendance-member').value;
    const { error } = await client.from('attendance').insert({ member_id: memberId, check_in_method: 'manual' });
    if (error) {
      say(`Check-in save nahi hua: ${error.message}`, true);
      return;
    }
    event.target.reset();
    say('Member checked in successfully.');
    await load();
  });

  (async () => {
    if (!client) {
      locked.querySelector('p').textContent = 'Supabase connection missing.';
      return;
    }
    const { data: { session } } = await client.auth.getSession();
    if (!session?.user) return;
    const { data, error } = await client.from('profiles').select('role').eq('id', session.user.id).maybeSingle();
    if (error) {
      locked.querySelector('h2').textContent = 'Account verification failed';
      locked.querySelector('p').textContent = error.message || 'Please return to the app and try again.';
      return;
    }
    if (data?.role !== 'admin') {
      locked.querySelector('h2').textContent = 'Admin access required';
      locked.querySelector('p').textContent = `You are signed in as ${session.user.email || 'a member'}, but this account does not have the admin role.`;
      const action = locked.querySelector('a.primary');
      action.textContent = 'Back to app';
      action.href = '/';
      return;
    }
    locked.hidden = true;
    panel.hidden = false;
    await load();
  })();
})();