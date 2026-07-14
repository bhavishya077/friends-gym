(() => {
  const config = window.FRIENDS_GYM_SUPABASE || {};
  const client = window.supabase?.createClient(config.url, config.anonKey);
  const locked = document.getElementById('admin-locked');
  const panel = document.getElementById('admin-panel');
  const message = document.getElementById('message');
  let members = [], memberships = [], attendance = [];
  const say = (text, error = false) => { message.textContent = text; message.classList.toggle('error', error); };
  const memberName = (m) => m.full_name || m.phone || `Member ${m.id.slice(0, 6)}`;
  const niceDate = (v) => v ? new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(v)) : 'Not set';
  const render = () => {
    const q = document.getElementById('member-search').value.trim().toLowerCase();
    const filtered = members.filter(m => `${m.full_name || ''} ${m.phone || ''}`.toLowerCase().includes(q));
    document.getElementById('member-list').innerHTML = filtered.length ? filtered.map(m => {
      const plan = memberships.find(p => p.member_id === m.id);
      return `<article class="record"><div class="avatar">${memberName(m).charAt(0).toUpperCase()}</div><div><strong>${memberName(m)}</strong><span>${m.phone || 'Phone not added'}</span></div><div class="state ${plan?.status || ''}"><b>${plan?.plan_name || 'No plan'}</b><span>${plan ? niceDate(plan.expires_on) : 'Not active'}</span></div></article>`;
    }).join('') : '<p class="empty">No matching members.</p>';
    const options = members.map(m => `<option value="${m.id}">${memberName(m)}</option>`).join('');
    ['membership-member','attendance-member'].forEach(id => document.getElementById(id).innerHTML = `<option value="">Select member</option>${options}`);
    document.getElementById('attendance-list').innerHTML = attendance.slice(0,5).map(a => {
      const m = members.find(x => x.id === a.member_id);
      return `<article class="record"><div class="avatar">✓</div><div><strong>${m ? memberName(m) : 'Member'}</strong><span>${new Date(a.checked_in_at).toLocaleString('en-IN')}</span></div><div class="state active"><b>Checked in</b><span>${a.check_in_method}</span></div></article>`;
    }).join('') || '<p class="empty">No attendance yet.</p>';
    const today = new Date().toISOString().slice(0,10);
    document.getElementById('member-total').textContent = members.length;
    document.getElementById('active-total').textContent = memberships.filter(x => x.status === 'active').length;
    document.getElementById('today-total').textContent = attendance.filter(x => x.checked_in_at?.slice(0,10) === today).length;
  };
  const load = async () => {
    say('Refreshing gym records...');
    const [m,p,a] = await Promise.all([
      client.from('profiles').select('id,full_name,phone,role,created_at').order('created_at',{ascending:false}),
      client.from('memberships').select('*').order('created_at',{ascending:false}),
      client.from('attendance').select('*').order('checked_in_at',{ascending:false}).limit(50)
    ]);
    const error = m.error || p.error || a.error;
    if(error){ say(`Records load nahi hue: ${error.message}`,true); return; }
    members=m.data||[]; memberships=p.data||[]; attendance=a.data||[]; render(); say('Gym records are up to date.');
  };
  document.getElementById('member-search').addEventListener('input',render);
  document.getElementById('refresh').addEventListener('click',load);
  document.getElementById('membership-form').addEventListener('submit',async e=>{
    e.preventDefault(); const memberId=document.getElementById('membership-member').value; const existing=memberships.find(x=>x.member_id===memberId);
    const payload={member_id:memberId,plan_name:document.getElementById('plan').value,status:document.getElementById('status').value,starts_on:document.getElementById('starts').value,expires_on:document.getElementById('expires').value,amount_inr:Number(document.getElementById('amount').value)};
    const result=existing?await client.from('memberships').update(payload).eq('id',existing.id):await client.from('memberships').insert(payload);
    if(result.error){say(`Membership save nahi hui: ${result.error.message}`,true);return;} e.target.reset(); say('Membership saved successfully.'); await load();
  });
  document.getElementById('attendance-form').addEventListener('submit',async e=>{
    e.preventDefault(); const memberId=document.getElementById('attendance-member').value; const {error}=await client.from('attendance').insert({member_id:memberId,check_in_method:'manual'});
    if(error){say(`Check-in save nahi hua: ${error.message}`,true);return;} e.target.reset(); say('Member checked in successfully.'); await load();
  });
  (async()=>{
    if(!client){locked.querySelector('p').textContent='Supabase connection missing.';return;}
    const {data:{session}}=await client.auth.getSession(); if(!session?.user)return;
    const {data,error}=await client.from('profiles').select('role').eq('id',session.user.id).maybeSingle();
    if(error||data?.role!=='admin')return; locked.hidden=true; panel.hidden=false; await load();
  })();
})();
