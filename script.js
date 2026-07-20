document.addEventListener('DOMContentLoaded', () => {
  const root = document.documentElement;
  const isNativeApp = Boolean(window.Capacitor?.isNativePlatform?.());
  const liveApiBase = 'https://friends-gym.onrender.com';
  const apiBase = isNativeApp ? liveApiBase : (window.location.protocol === 'file:' ? liveApiBase : '');
  const nativeAuthRedirect = 'com.friendsgym.app://auth';
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.nav-links');
  const themeToggle = document.getElementById('theme-toggle');
  const installButton = document.getElementById('install-app');
  const appMenuButton = document.getElementById('app-menu-button');
  const appDrawer = document.getElementById('app-drawer');
  const appDrawerBackdrop = document.getElementById('app-drawer-backdrop');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = window.matchMedia('(max-width: 860px)').matches;
  let installPrompt = null;
  let verifiedSessionUser = null;
  let refreshClassSchedule = () => {};

  const routeToScreen = {
    '/': 'home',
    '/workout': 'workout',
    '/nutrition': 'nutrition',
    '/classes': 'classes',
    '/membership': 'membership',
    '/tools': 'tools',
    '/auth': 'auth',
    '/profile': 'profile',
    '/progress': 'progress',
    '/settings': 'settings',
    '/contact': 'contact'
  };
  const screenToRoute = Object.fromEntries(Object.entries(routeToScreen).map(([route, screen]) => [screen, route]));
  const navMap = {
    home: 'nav-home',
    classes: 'nav-classes',
    membership: 'nav-membership',
    auth: 'nav-auth',
    profile: 'nav-auth'
  };
  const screenHistory = ['home'];

  const setDrawerOpen = (open) => {
    if (!appDrawer || !appDrawerBackdrop || !appMenuButton) return;
    appDrawer.classList.toggle('open', open);
    appDrawer.setAttribute('aria-hidden', String(!open));
    appMenuButton.setAttribute('aria-expanded', String(open));
    appDrawerBackdrop.hidden = !open;
    requestAnimationFrame(() => appDrawerBackdrop.classList.toggle('open', open));
  };

  appMenuButton?.addEventListener('click', () => setDrawerOpen(!appDrawer?.classList.contains('open')));
  appDrawerBackdrop?.addEventListener('click', () => setDrawerOpen(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setDrawerOpen(false);
  });

  const updateUrlChrome = (screenId) => {
    const urlPath = document.getElementById('urlpath');
    const route = screenToRoute[screenId] || '/';
    if (urlPath) urlPath.textContent = `friendsgym.app${route === '/' ? '/' : route}`;
  };

  const showScreen = (screenId, options = {}) => {
    const { push = true, remember = true } = options;
    if (['profile', 'progress', 'settings'].includes(screenId) && !verifiedSessionUser) screenId = 'auth';
    const target = document.getElementById(screenId);
    if (!target || !target.classList.contains('screen')) return;
    setDrawerOpen(false);
    const current = document.querySelector('.screen.active');
    if (current && current.id === screenId) {
      updateUrlChrome(screenId);
      return;
    }
    document.querySelectorAll('.screen').forEach((screen) => screen.classList.remove('active'));
    target.classList.add('active');
    if (screenId === 'classes') setTimeout(() => refreshClassSchedule(), 0);
    if (remember && (!screenHistory.length || screenHistory[screenHistory.length - 1] !== screenId)) {
      screenHistory.push(screenId);
    }
    document.querySelectorAll('.nav-icon').forEach((item) => item.classList.remove('active'));
    const navId = navMap[screenId];
    if (navId) {
      const navItem = document.getElementById(navId);
      if (navItem) navItem.classList.add('active');
    }
    updateUrlChrome(screenId);
    const route = screenToRoute[screenId] || '/';
    if (push && window.location.pathname !== route) {
      window.history.pushState({ screenId }, '', route);
    }
    target.scrollTop = 0;
  };

  window.showScreen = (id) => showScreen(id);

  document.querySelectorAll('[data-screen]').forEach((item) => {
    item.addEventListener('click', (event) => {
      event.preventDefault();
      showScreen(item.dataset.screen);
    });
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        showScreen(item.dataset.screen);
      }
    });
  });

  document.querySelectorAll('[data-back]').forEach((button) => {
    button.addEventListener('click', () => {
      screenHistory.pop();
      const previous = screenHistory[screenHistory.length - 1] || 'home';
      showScreen(previous, { push: true, remember: false });
    });
  });

  window.addEventListener('popstate', () => {
    const screenId = routeToScreen[window.location.pathname] || 'home';
    showScreen(screenId, { push: false, remember: false });
  });

  showScreen(routeToScreen[window.location.pathname] || 'home', { push: false, remember: false });

  const googleAuthButton = document.getElementById('google-auth');
  const authToast = document.getElementById('authToast');
  const showAuthToast = (message = 'Signed in - opening Home...') => {
    if (!authToast) return;
    authToast.textContent = message;
    authToast.classList.add('show');
    setTimeout(() => authToast.classList.remove('show'), 1800);
  };

  let supabaseClient = null;
  const getSupabaseClient = async () => {
    if (supabaseClient) return supabaseClient;
    if (!window.supabase) return null;

    const localConfig = window.FRIENDS_GYM_SUPABASE || {};
    let url = localConfig.url || '';
    let anonKey = localConfig.anonKey || '';

    if (!url || !anonKey) {
      try {
        const response = await fetch(`${apiBase}/api/config`);
        if (response.ok) {
          const serverConfig = await response.json();
          url = serverConfig.supabaseUrl || '';
          anonKey = serverConfig.supabaseAnonKey || '';
        }
      } catch {
        return null;
      }
    }

    if (!url || !anonKey) return null;
    supabaseClient = window.supabase.createClient(url, anonKey);
    return supabaseClient;
  };
  window.getFriendsGymSupabaseClient = getSupabaseClient;
  window.getFriendsGymSessionUser = () => verifiedSessionUser;

  if (isNativeApp && window.Capacitor?.Plugins?.App) {
    window.Capacitor.Plugins.App.addListener('appUrlOpen', async ({ url }) => {
      if (!url?.startsWith(nativeAuthRedirect)) return;
      const callbackUrl = new URL(url);
      const authParams = new URLSearchParams(callbackUrl.hash.slice(1));
      const accessToken = authParams.get('access_token');
      const refreshToken = authParams.get('refresh_token');
      const client = await getSupabaseClient();
      if (!client || !accessToken || !refreshToken) return;
      const { data, error } = await client.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      });
      if (!error && data.session?.user) {
        await window.Capacitor.Plugins.Browser?.close();
        await loadMemberDashboard(data.session.user, { redirect: true });
        showAuthToast();
      }
    });
  }

  if (googleAuthButton) {
    googleAuthButton.addEventListener('click', async () => {
      const client = await getSupabaseClient();
      if (client) {
        const { data: existing } = await client.auth.getSession();
        if (existing.session?.user) {
          await loadMemberDashboard(existing.session.user, { redirect: true });
          showAuthToast('Already signed in. Logout before using another account.');
          return;
        }
        const { data, error } = await client.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: isNativeApp ? nativeAuthRedirect : window.location.origin,
            skipBrowserRedirect: isNativeApp,
            queryParams: { prompt: 'select_account' }
          }
        });
        if (error) showAuthToast('Google sign-in start nahi ho saka. Dobara try karein.');
        if (isNativeApp && data?.url) {
          await window.Capacitor.Plugins.Browser?.open({ url: data.url });
        }
        return;
      }
      showAuthToast('Google sign-in abhi setup nahi hai. Email/password se sign in karein.');
    });
  }
  if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  }

  const applyTheme = (theme) => {
    root.setAttribute('data-theme', theme);
    localStorage.setItem('friends-gym-theme', theme);
    if (themeToggle) themeToggle.textContent = theme === 'dark' ? 'Light' : 'Dark';
  };

  const savedTheme = localStorage.getItem('friends-gym-theme');
  if (savedTheme) applyTheme(savedTheme);
  else if (themeToggle) themeToggle.textContent = root.getAttribute('data-theme') === 'light' ? 'Dark' : 'Light';

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const currentTheme = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
      applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
    });
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    if (installButton) installButton.hidden = false;
  });

  if (installButton) {
    installButton.hidden = false;
    installButton.addEventListener('click', async () => {
      if (!installPrompt) {
        window.alert(/iphone|ipad|ipod/i.test(navigator.userAgent)
          ? 'Safari mein Share button dabayein, phir Add to Home Screen select karein.'
          : 'Chrome menu kholein aur Install app ya Add to Home screen select karein.');
        return;
      }
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
    });
  }

  window.addEventListener('appinstalled', () => {
    if (installButton) installButton.hidden = true;
  });

  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      nav.classList.toggle('active');
      toggle.setAttribute('aria-expanded', nav.classList.contains('active') ? 'true' : 'false');
    });
    nav.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        nav.classList.remove('active');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  const splitHeadline = (element) => {
    if (!element || element.dataset.splitDone) return;
    const text = element.textContent.trim();
    element.textContent = '';
    const words = text.split(/\s+/);
    words.forEach((word, index) => {
      const wordSpan = document.createElement('span');
      wordSpan.className = 'word';
      word.split('').forEach((char) => {
        const charSpan = document.createElement('span');
        charSpan.className = 'char';
        charSpan.textContent = char;
        wordSpan.appendChild(charSpan);
      });
      element.appendChild(wordSpan);
      if (index < words.length - 1) element.appendChild(document.createTextNode(' '));
    });
    element.dataset.splitDone = 'true';
  };

  document.querySelectorAll('.split-headline').forEach(splitHeadline);

  if (!reducedMotion && window.gsap && window.ScrollTrigger) {
    gsap.registerPlugin(ScrollTrigger);

    gsap.from('.hero-copy .word .char', {
      yPercent: 120,
      opacity: 0,
      duration: 0.9,
      ease: 'power4.out',
      stagger: 0.015,
      delay: 0.2
    });

    gsap.from('.hero .stat strong', {
      textContent: 0,
      duration: 2,
      ease: 'power1.out',
      snap: { textContent: 1 },
      stagger: 0.12,
      scrollTrigger: {
        trigger: '.hero',
        start: 'top top'
      }
    });

    document.querySelectorAll('.motion-section .section-title').forEach((title) => {
      gsap.fromTo(title, { clipPath: 'inset(0 100% 0 0)' }, {
        clipPath: 'inset(0 0% 0 0)',
        duration: 0.9,
        ease: 'power3.out',
        scrollTrigger: { trigger: title, start: 'top 80%' }
      });
    });

    document.querySelectorAll('.gallery-card').forEach((card, index) => {
      gsap.fromTo(card, {
        y: 60,
        rotate: index % 2 === 0 ? -8 : 8,
        scale: 0.95,
        opacity: 0
      }, {
        y: 0,
        rotate: 0,
        scale: 1,
        opacity: 1,
        duration: 0.9,
        ease: 'power3.out',
        scrollTrigger: { trigger: card, start: 'top 82%' }
      });
    });

    gsap.to('.gallery-grid', {
      y: -60,
      scrollTrigger: {
        trigger: '#gallery',
        start: 'top 75%',
        end: 'bottom top',
        scrub: true
      }
    });

    gsap.to('.marquee-track', {
      xPercent: -50,
      ease: 'none',
      scrollTrigger: {
        trigger: '.marquee',
        scrub: 0.2
      }
    });

    document.querySelectorAll('.btn').forEach((button) => button.classList.add('magnetic'));
  } else {
    document.querySelectorAll('.hero-copy .char').forEach((char) => {
      char.style.opacity = '1';
      char.style.transform = 'none';
    });
  }

  if (!reducedMotion && !isMobile) {
    document.querySelectorAll('.magnetic').forEach((item) => {
      item.addEventListener('pointermove', (event) => {
        const rect = item.getBoundingClientRect();
        const dx = ((event.clientX - rect.left) / rect.width - 0.5) * 12;
        const dy = ((event.clientY - rect.top) / rect.height - 0.5) * 12;
        item.style.transform = `translate(${dx}px, ${dy}px)`;
      });
      item.addEventListener('pointerleave', () => {
        item.style.transform = '';
      });
    });
  }

  const setupSegmented = (groupName, inputId) => {
    const group = document.querySelector(`[data-segmented="${groupName}"]`);
    const input = document.getElementById(inputId);
    if (!group || !input) return;
    const buttons = [...group.querySelectorAll('.segment')];
    const pill = document.createElement('div');
    pill.className = 'segment-pill';
    group.prepend(pill);

    const movePill = (activeButton) => {
      const index = buttons.indexOf(activeButton);
      const width = 100 / buttons.length;
      pill.style.width = `${width}%`;
      pill.style.transform = `translateX(${index * 100}%)`;
    };

    const activate = (button) => {
      buttons.forEach((item) => {
        const active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      input.value = button.dataset.value;
      movePill(button);
    };

    buttons.forEach((button) => button.addEventListener('click', () => activate(button)));
    activate(buttons.find((button) => button.classList.contains('active')) || buttons[0]);
  };

  setupSegmented('gender', 'gender');
  setupSegmented('goal', 'goal');
  setupSegmented('session-intensity', 'session-intensity');

  const bmiForm = document.getElementById('bmi-form');
  const bmiResult = document.getElementById('bmi-result');
  if (bmiForm && bmiResult) {
    bmiForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const height = Number(document.getElementById('height').value);
      const weight = Number(document.getElementById('weight').value);
      const age = Number(document.getElementById('age').value);
      const gender = document.getElementById('gender').value;
      if (!height || !weight || !age) {
        bmiResult.textContent = 'Please enter valid height, weight, and age.';
        return;
      }
      const bmi = (weight / ((height / 100) ** 2)).toFixed(1);
      let bmiMessage = 'Normal range';
      if (bmi < 18.5) bmiMessage = 'Underweight';
      else if (bmi < 24.9) bmiMessage = 'Healthy';
      else if (bmi < 29.9) bmiMessage = 'Overweight';
      else bmiMessage = 'Obese';
      const bmr = gender === 'male'
        ? 10 * weight + 6.25 * height - 5 * age + 5
        : 10 * weight + 6.25 * height - 5 * age - 161;
      const dailyCalories = Math.round(bmr * 1.55);
      bmiResult.innerHTML = `Your BMI is <strong>${bmi}</strong> - <strong>${bmiMessage}</strong>.<br>Your estimated daily calories are <strong>${dailyCalories}</strong> kcal.`;
    });
  }

  const toolTiles = [...document.querySelectorAll('[data-tool-target]')];
  const toolPanels = [...document.querySelectorAll('.tool-panel')];
  toolTiles.forEach((tile) => tile.addEventListener('click', () => {
    toolTiles.forEach((item) => item.classList.toggle('active', item === tile));
    toolPanels.forEach((panel) => panel.classList.toggle('active', panel.id === tile.dataset.toolTarget));
    document.getElementById(tile.dataset.toolTarget)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
  const bindCalculator = (formId, resultId, calculate) => {
    const form = document.getElementById(formId);
    const result = document.getElementById(resultId);
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      try { result.textContent = calculate(); }
      catch (error) { result.textContent = error.message || 'Please check your values.'; }
    });
  };
  bindCalculator('calorie-tool-form', 'calorie-tool-result', () => {
    const weight = Number(document.getElementById('tool-calorie-weight').value);
    const minutes = Number(document.getElementById('tool-calorie-minutes').value);
    const met = Number(document.getElementById('tool-calorie-activity').value);
    return `Estimated burn: ${Math.round(met * 3.5 * weight / 200 * minutes)} kcal. Actual burn varies by intensity and fitness level.`;
  });
  bindCalculator('repmax-tool-form', 'repmax-tool-result', () => {
    const weight = Number(document.getElementById('tool-lift-weight').value);
    const reps = Number(document.getElementById('tool-lift-reps').value);
    return `Estimated one-rep max: ${Math.round(weight * (1 + reps / 30))} kg. Use a spotter and progress gradually.`;
  });
  bindCalculator('bodyfat-tool-form', 'bodyfat-tool-result', () => {
    const bmi = Number(document.getElementById('tool-bodyfat-bmi').value);
    const age = Number(document.getElementById('tool-bodyfat-age').value);
    const sex = Number(document.getElementById('tool-bodyfat-sex').value);
    const estimate = Math.max(3, Math.min(60, 1.2 * bmi + 0.23 * age - 10.8 * sex - 5.4));
    return `Estimated body fat: ${estimate.toFixed(1)}%. This is informational only; a professional measurement is more accurate.`;
  });
  bindCalculator('water-tool-form', 'water-tool-result', () => {
    const weight = Number(document.getElementById('tool-water-weight').value);
    const minutes = Number(document.getElementById('tool-water-minutes').value);
    const litres = weight * 0.035 + (minutes / 30) * 0.35;
    return `Daily water goal: about ${litres.toFixed(1)} litres, adjusted for a ${minutes}-minute workout.`;
  });
  bindCalculator('protein-tool-form', 'protein-tool-result', () => {
    const weight = Number(document.getElementById('tool-protein-weight').value);
    const factor = Number(document.getElementById('tool-protein-goal').value);
    const target = weight * factor;
    return `Daily protein goal: ${Math.round(target * 0.9)}–${Math.round(target * 1.1)} g. Spread it across meals.`;
  });
  document.querySelectorAll('.billing-toggle button').forEach((button) => button.addEventListener('click', () => {
    document.querySelectorAll('.billing-toggle button').forEach((item) => item.classList.toggle('active', item === button));
  }));
  document.querySelector('[data-contact-focus]')?.addEventListener('click', () => {
    document.getElementById('contact-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.getElementById('contact-name')?.focus({ preventScroll: true });
  });
  const waterButtons = [...document.querySelectorAll('#water-glasses button')];
  waterButtons.forEach((button, index) => button.addEventListener('click', () => {
    const count = index + 1;
    waterButtons.forEach((item, itemIndex) => item.classList.toggle('filled', itemIndex < count));
    const label = document.getElementById('water-label');
    if (label) label.textContent = `${count} of 8 glasses`;
    localStorage.setItem('friends-gym-water-glasses', String(count));
  }));
  const savedWater = Math.min(8, Math.max(0, Number(localStorage.getItem('friends-gym-water-glasses') || 6)));
  waterButtons.forEach((item, index) => item.classList.toggle('filled', index < savedWater));
  if (document.getElementById('water-label')) document.getElementById('water-label').textContent = `${savedWater} of 8 glasses`;
  const workoutBoxes = document.querySelectorAll('[data-workout]');
  const trackerStatus = document.getElementById('tracker-status');
  const workoutCalendar = document.getElementById('workout-calendar');
  const calendarMonth = document.getElementById('calendar-month');
  const calendarLiveTime = document.getElementById('calendar-live-time');
  const calendarPrev = document.getElementById('calendar-prev');
  const calendarNext = document.getElementById('calendar-next');
  const calendarToday = document.getElementById('calendar-today');
  const workoutDateTitle = document.getElementById('workout-date-title');
  const activityTitle = document.getElementById('activity-title');
  const activityDayLabel = document.getElementById('activity-day-label');

  const readHistory = (key) => {
    try { return JSON.parse(localStorage.getItem(key) || '{}'); }
    catch { return {}; }
  };
  const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const dateFromKey = (key) => {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year, month - 1, day);
  };
  const startOfWeek = (date) => {
    const value = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const mondayOffset = (value.getDay() + 6) % 7;
    value.setDate(value.getDate() - mondayOffset);
    return value;
  };

  let activeActivityOwner = 'guest';
  const workoutHistoryKey = () => `friends-gym-workouts-v3:${activeActivityOwner}`;
  const sessionHistoryKey = () => `friends-gym-sessions-v3:${activeActivityOwner}`;
  const trainerDoneKey = () => `friends-gym-trainer-done-v2:${activeActivityOwner}`;
  const activityDirtyKey = () => `friends-gym-activity-dirty-v1:${activeActivityOwner}`;
  const readDirtyActivityDates = () => {
    try { return new Set(JSON.parse(localStorage.getItem(activityDirtyKey()) || '[]')); }
    catch { return new Set(); }
  };
  const writeDirtyActivityDates = (dates) => localStorage.setItem(activityDirtyKey(), JSON.stringify([...dates]));
  let reloadTrainerForOwner = () => {};
  let persistActivityDayToCloud = async () => false;
  let syncActivityCloud = async () => false;
  const workoutHistory = readHistory(workoutHistoryKey());
  const sessionHistory = readHistory(sessionHistoryKey());
  let selectedWorkoutDate = new Date();
  let selectedWorkoutKey = dateKey(selectedWorkoutDate);
  let calendarWeekStart = startOfWeek(selectedWorkoutDate);
  let lastTodayKey = selectedWorkoutKey;
  let loadSelectedDate = () => {};

  const legacyWorkout = (() => {
    try { return JSON.parse(localStorage.getItem('friends-gym-workout') || '[]'); }
    catch { return []; }
  })();
  const legacySession = (() => {
    try { return JSON.parse(localStorage.getItem('friends-gym-session') || 'null'); }
    catch { return null; }
  })();
  if (!workoutHistory[selectedWorkoutKey] && legacyWorkout.length) workoutHistory[selectedWorkoutKey] = legacyWorkout;
  if (!sessionHistory[selectedWorkoutKey] && legacySession) sessionHistory[selectedWorkoutKey] = legacySession;
  localStorage.setItem(workoutHistoryKey(), JSON.stringify(workoutHistory));
  localStorage.setItem(sessionHistoryKey(), JSON.stringify(sessionHistory));

  const renderCalendar = () => {
    if (!workoutCalendar) return;
    workoutCalendar.replaceChildren();
    const weekEnd = new Date(calendarWeekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    if (calendarMonth) {
      const startLabel = calendarWeekStart.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      const endLabel = weekEnd.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      calendarMonth.textContent = `${startLabel} - ${endLabel}`;
    }
    if (workoutDateTitle) {
      workoutDateTitle.textContent = selectedWorkoutDate.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();
    }
    const todayKey = dateKey(new Date());
    const selectedLabel = selectedWorkoutDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    if (activityTitle) activityTitle.textContent = selectedWorkoutKey === todayKey ? "Today's Activity" : `Activity for ${selectedLabel}`;
    if (activityDayLabel) activityDayLabel.textContent = selectedWorkoutKey === todayKey ? 'Today in gym' : `Workout on ${selectedLabel}`;
    for (let index = 0; index < 7; index += 1) {
      const day = new Date(calendarWeekStart);
      day.setDate(day.getDate() + index);
      const key = dateKey(day);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'day';
      button.dataset.date = key;
      button.setAttribute('aria-label', day.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
      button.classList.toggle('active', key === selectedWorkoutKey);
      button.classList.toggle('today', key === todayKey);
      button.classList.toggle('has-data', Boolean(workoutHistory[key]?.length || sessionHistory[key]));
      if (key === selectedWorkoutKey) button.setAttribute('aria-pressed', 'true');
      button.innerHTML = `<span>${day.toLocaleDateString('en-IN', { weekday: 'narrow' })}</span><span class="dot">${day.getDate()}</span>`;
      workoutCalendar.appendChild(button);
    }
  };

  const selectWorkoutDate = (date) => {
    selectedWorkoutDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    selectedWorkoutKey = dateKey(selectedWorkoutDate);
    calendarWeekStart = startOfWeek(selectedWorkoutDate);
    renderCalendar();
    loadSelectedDate();
  };

  const updateLiveCalendar = () => {
    const now = new Date();
    if (calendarLiveTime) calendarLiveTime.textContent = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const currentTodayKey = dateKey(now);
    if (currentTodayKey !== lastTodayKey) {
      const wasFollowingToday = selectedWorkoutKey === lastTodayKey;
      lastTodayKey = currentTodayKey;
      if (wasFollowingToday) selectWorkoutDate(now);
      else renderCalendar();
    }
  };

  workoutCalendar?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-date]');
    if (!button) return;
    selectWorkoutDate(dateFromKey(button.dataset.date));
  });
  calendarPrev?.addEventListener('click', () => {
    calendarWeekStart.setDate(calendarWeekStart.getDate() - 7);
    renderCalendar();
  });
  calendarNext?.addEventListener('click', () => {
    calendarWeekStart.setDate(calendarWeekStart.getDate() + 7);
    renderCalendar();
  });
  calendarToday?.addEventListener('click', () => selectWorkoutDate(new Date()));

  const loadTrackerForDate = () => {
    const savedWorkout = workoutHistory[selectedWorkoutKey] || [];
    workoutBoxes.forEach((box) => { box.checked = savedWorkout.includes(box.value); });
    const done = [...workoutBoxes].filter((box) => box.checked).length;
    if (trackerStatus) trackerStatus.textContent = `${done}/${workoutBoxes.length} completed`;
  };

  const updateTracker = () => {
    const completed = [...workoutBoxes].filter((box) => box.checked).map((box) => box.value);
    workoutHistory[selectedWorkoutKey] = completed;
    localStorage.setItem(workoutHistoryKey(), JSON.stringify(workoutHistory));
    persistActivityDayToCloud(selectedWorkoutKey);
    loadTrackerForDate();
    renderCalendar();
  };
  workoutBoxes.forEach((box) => box.addEventListener('change', updateTracker));

  const sessionForm = document.getElementById('session-form');
  const sessionSteps = document.getElementById('session-steps');
  const sessionMinutes = document.getElementById('session-minutes');
  const sessionWorkout = document.getElementById('session-workout');
  const sessionIntensity = document.getElementById('session-intensity');
  const sessionResult = document.getElementById('session-result');
  const liveSessionTime = document.getElementById('live-session-time');
  const sessionCalories = document.getElementById('session-calories');
  const sessionDistance = document.getElementById('session-distance');
  const dashboardSteps = document.getElementById('dashboard-steps');
  const dashboardCalories = document.getElementById('dashboard-calories');
  const dashboardTime = document.getElementById('dashboard-time');
  const homeSteps = document.getElementById('home-steps');
  const homeCalories = document.getElementById('home-calories');
  const homeTime = document.getElementById('home-time');
  const homeRecovery = document.getElementById('home-recovery');
  const sessionRowSteps = document.getElementById('session-row-steps');
  const sessionRowCalories = document.getElementById('session-row-calories');
  const sessionRowTime = document.getElementById('session-row-time');
  const startSession = document.getElementById('start-session');
  const stopSession = document.getElementById('stop-session');
  const resetSession = document.getElementById('reset-session');
  let sessionTimer = null;
  let sessionStartedAt = null;

  const formatClock = (totalSeconds) => {
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
  };

  const pulseTimer = () => {
    if (!liveSessionTime) return;
    liveSessionTime.animate([
      { transform: 'scale(1)' },
      { transform: 'scale(1.08)' },
      { transform: 'scale(1)' }
    ], { duration: 220, easing: 'ease-out' });
  };

  const calculateCalories = (minutes, workout, intensity, weight = 70) => {
    const metRates = { strength: 5, cardio: 7, hiit: 9, mobility: 3 };
    const intensityRates = { light: 0.72, moderate: 1, hard: 1.28 };
    const safeMinutes = Math.max(0, Number(minutes) || 0);
    const safeWeight = Math.min(350, Math.max(20, Number(weight) || 70));
    const met = metRates[workout] || metRates.strength;
    const multiplier = intensityRates[intensity] || intensityRates.moderate;
    return Math.max(0, Math.round(met * multiplier * 3.5 * safeWeight / 200 * safeMinutes));
  };

  const updateSessionDashboard = (session) => {
    if (!session) return;
    if (dashboardSteps) dashboardSteps.textContent = session.steps.toLocaleString();
    if (dashboardCalories) dashboardCalories.textContent = `${session.calories} kcal`;
    if (dashboardTime) dashboardTime.textContent = `${session.minutes} min`;
    if (homeSteps) homeSteps.textContent = session.steps.toLocaleString();
    if (homeCalories) homeCalories.textContent = session.calories.toLocaleString();
    if (homeTime) homeTime.textContent = `${session.minutes}m`;
    if (homeRecovery) homeRecovery.textContent = session.intensity === 'hard' ? 'High' : (session.intensity === 'light' ? 'Light' : 'Good');
    if (sessionRowSteps) sessionRowSteps.textContent = session.steps.toLocaleString();
    if (sessionRowCalories) sessionRowCalories.textContent = `${session.calories}`;
    if (sessionRowTime) sessionRowTime.textContent = `${session.minutes}m`;
    if (sessionCalories) sessionCalories.textContent = session.calories;
    if (sessionDistance) sessionDistance.textContent = `${session.distanceKm.toFixed(2)} km`;
    if (sessionResult) {
      sessionResult.innerHTML = `You walked <strong>${session.steps.toLocaleString()}</strong> steps, spent <strong>${session.minutes}</strong> minutes in gym, and burned around <strong>${session.calories} kcal</strong>.`;
    }
  };

  const clearSessionDashboard = () => {
    if (sessionCalories) sessionCalories.textContent = '0';
    if (sessionDistance) sessionDistance.textContent = '0.00 km';
    if (dashboardSteps) dashboardSteps.textContent = '0';
    if (dashboardCalories) dashboardCalories.textContent = '0 kcal';
    if (dashboardTime) dashboardTime.textContent = '0 min';
    if (homeSteps) homeSteps.textContent = '0';
    if (homeCalories) homeCalories.textContent = '0';
    if (homeTime) homeTime.textContent = '0m';
    if (homeRecovery) homeRecovery.textContent = 'Ready';
    if (sessionRowSteps) sessionRowSteps.textContent = '0';
    if (sessionRowCalories) sessionRowCalories.textContent = '0';
    if (sessionRowTime) sessionRowTime.textContent = '0m';
    if (sessionResult) sessionResult.textContent = `No workout saved for ${selectedWorkoutDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}.`;
  };

  loadSelectedDate = () => {
    loadTrackerForDate();
    const savedSession = sessionHistory[selectedWorkoutKey];
    if (savedSession) {
      if (sessionSteps) sessionSteps.value = savedSession.steps;
      if (sessionMinutes) sessionMinutes.value = savedSession.minutes;
      if (sessionWorkout) sessionWorkout.value = savedSession.workout;
      updateSessionDashboard(savedSession);
    } else {
      if (sessionSteps) sessionSteps.value = '';
      if (sessionMinutes) sessionMinutes.value = '';
      clearSessionDashboard();
    }
    if (liveSessionTime) liveSessionTime.textContent = '00:00';
  };

  renderCalendar();
  loadSelectedDate();
  updateLiveCalendar();
  setInterval(updateLiveCalendar, 30000);

  if (startSession && liveSessionTime) {
    startSession.addEventListener('click', () => {
      sessionStartedAt = Date.now();
      clearInterval(sessionTimer);
      sessionTimer = setInterval(() => {
        const seconds = Math.floor((Date.now() - sessionStartedAt) / 1000);
        liveSessionTime.textContent = formatClock(seconds);
        if (sessionMinutes) sessionMinutes.value = Math.max(1, Math.round(seconds / 60));
        pulseTimer();
      }, 1000);
    });
  }

  if (stopSession) {
    stopSession.addEventListener('click', () => {
      clearInterval(sessionTimer);
      sessionTimer = null;
      sessionStartedAt = null;
    });
  }

  if (sessionForm) {
    sessionForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const steps = Math.max(0, Number(sessionSteps.value || 0));
      const minutes = Math.max(1, Number(sessionMinutes.value || 1));
      const workout = sessionWorkout.value;
      const intensity = sessionIntensity.value;
      const distanceKm = steps * 0.000762;
      const weight = Math.min(350, Math.max(20, Number(sessionWeight?.value || 70)));
      const calories = calculateCalories(minutes, workout, intensity, weight);
      const session = { steps, minutes, workout, intensity, weight, distanceKm, calories, source: healthConnectActive ? 'health-connect' : (autoTracking ? 'sensor' : 'manual'), date: selectedWorkoutKey, savedAt: new Date().toISOString() };
      sessionHistory[selectedWorkoutKey] = session;
      localStorage.setItem(sessionHistoryKey(), JSON.stringify(sessionHistory));
      persistActivityDayToCloud(selectedWorkoutKey);
      updateLocalActivityTotals();
      updateSessionDashboard(session);
      renderCalendar();
    });
  }

  if (resetSession) {
    resetSession.addEventListener('click', () => {
      clearInterval(sessionTimer);
      sessionTimer = null;
      sessionStartedAt = null;
      delete sessionHistory[selectedWorkoutKey];
      localStorage.setItem(sessionHistoryKey(), JSON.stringify(sessionHistory));
      persistActivityDayToCloud(selectedWorkoutKey);
      if (sessionForm) sessionForm.reset();
      if (liveSessionTime) liveSessionTime.textContent = '00:00';
      if (sessionCalories) sessionCalories.textContent = '0';
      if (sessionDistance) sessionDistance.textContent = '0.00 km';
      if (dashboardSteps) dashboardSteps.textContent = '0';
      if (dashboardCalories) dashboardCalories.textContent = '0 kcal';
      if (dashboardTime) dashboardTime.textContent = '0 min';
    if (homeSteps) homeSteps.textContent = '0';
    if (homeCalories) homeCalories.textContent = '0';
    if (homeTime) homeTime.textContent = '0m';
    if (homeRecovery) homeRecovery.textContent = 'Ready';
      if (sessionRowSteps) sessionRowSteps.textContent = '0';
      if (sessionRowCalories) sessionRowCalories.textContent = '0';
      if (sessionRowTime) sessionRowTime.textContent = '0m';
      if (sessionResult) sessionResult.textContent = 'Session reset for the selected date.';
      renderCalendar();
    });
  }

  const replaceHistory = (target, source) => {
    Object.keys(target).forEach((key) => delete target[key]);
    Object.assign(target, source && typeof source === 'object' ? source : {});
  };
  const switchActivityOwner = (ownerId = 'guest') => {
    const nextOwner = String(ownerId || 'guest').replace(/[^a-zA-Z0-9-]/g, '') || 'guest';
    if (nextOwner === activeActivityOwner) return;
    activeActivityOwner = nextOwner;
    replaceHistory(workoutHistory, readHistory(workoutHistoryKey()));
    replaceHistory(sessionHistory, readHistory(sessionHistoryKey()));
    stopSession?.click();
    renderCalendar();
    loadSelectedDate();
    if (typeof updateLocalActivityTotals === 'function') updateLocalActivityTotals();
    reloadTrainerForOwner();
  };
  const cloudActivityRow = (key, memberId = verifiedSessionUser?.id) => {
    const completed = Array.isArray(workoutHistory[key]) ? workoutHistory[key] : [];
    const session = sessionHistory[key] || null;
    return {
      member_id: memberId,
      activity_date: key,
      completed_items: completed,
      steps: session ? Math.max(0, Math.round(Number(session.steps) || 0)) : null,
      minutes: session ? Math.max(0, Number(session.minutes) || 0) : null,
      workout_type: session?.workout || null,
      intensity: session?.intensity || null,
      weight_kg: session?.weight ? Number(session.weight) : null,
      distance_km: session ? Math.max(0, Number(session.distanceKm) || 0) : null,
      calories: session ? Math.max(0, Math.round(Number(session.calories) || 0)) : null,
      tracking_source: session?.source || 'manual'
    };
  };

  persistActivityDayToCloud = async (key) => {
    const dirtyDates = readDirtyActivityDates();
    dirtyDates.add(key);
    writeDirtyActivityDates(dirtyDates);
    const memberId = verifiedSessionUser?.id;
    const client = await getSupabaseClient();
    if (!memberId || !client) return false;
    const completed = workoutHistory[key] || [];
    const session = sessionHistory[key] || null;
    let error = null;
    if (!completed.length && !session) {
      ({ error } = await client.from('activity_days').delete().eq('member_id', memberId).eq('activity_date', key));
    } else {
      ({ error } = await client.from('activity_days').upsert(cloudActivityRow(key, memberId), {
        onConflict: 'member_id,activity_date'
      }));
    }
    if (!error) {
      dirtyDates.delete(key);
      writeDirtyActivityDates(dirtyDates);
    }
    return !error;
  };

  syncActivityCloud = async (memberId) => {
    const syncStatus = document.getElementById('profile-sync-status');
    const client = await getSupabaseClient();
    if (!client || !memberId) {
      if (syncStatus) syncStatus.textContent = 'Saved on this device';
      return false;
    }
    for (const dirtyDate of readDirtyActivityDates()) {
      await persistActivityDayToCloud(dirtyDate);
    }
    const { data, error } = await client.from('activity_days')
      .select('activity_date,completed_items,steps,minutes,workout_type,intensity,weight_kg,distance_km,calories,tracking_source,updated_at')
      .eq('member_id', memberId)
      .order('activity_date', { ascending: true });
    if (error) {
      if (syncStatus) syncStatus.textContent = 'Saved locally - cloud setup pending';
      return false;
    }

    const remoteDates = new Set();
    (data || []).forEach((row) => {
      const key = row.activity_date;
      remoteDates.add(key);
      workoutHistory[key] = Array.isArray(row.completed_items) ? row.completed_items : [];
      if (row.calories == null) {
        delete sessionHistory[key];
      } else {
        sessionHistory[key] = {
          steps: Number(row.steps) || 0,
          minutes: Number(row.minutes) || 0,
          workout: row.workout_type || 'strength',
          intensity: row.intensity || 'moderate',
          weight: Number(row.weight_kg) || 70,
          distanceKm: Number(row.distance_km) || 0,
          calories: Number(row.calories) || 0,
          source: row.tracking_source || 'manual',
          date: key,
          savedAt: row.updated_at
        };
      }
    });

    const localDates = new Set([...Object.keys(workoutHistory), ...Object.keys(sessionHistory)]);
    const missingRows = [...localDates]
      .filter((key) => !remoteDates.has(key))
      .map((key) => cloudActivityRow(key, memberId));
    if (missingRows.length) {
      await client.from('activity_days').upsert(missingRows, { onConflict: 'member_id,activity_date' });
    }

    localStorage.setItem(workoutHistoryKey(), JSON.stringify(workoutHistory));
    localStorage.setItem(sessionHistoryKey(), JSON.stringify(sessionHistory));
    renderCalendar();
    loadSelectedDate();
    updateLocalActivityTotals();
    if (syncStatus) syncStatus.textContent = 'Cloud sync active';
    return true;
  };
  const dietForm = document.getElementById('diet-form');
  const dietResult = document.getElementById('diet-result');
  if (dietForm && dietResult) {
    dietForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const goal = document.getElementById('goal').value;
      const caloriesValue = Number(document.getElementById('calories').value);
      if (!caloriesValue || caloriesValue <= 0) {
        dietResult.textContent = 'Please enter a valid calorie target.';
        return;
      }
      const calories = Math.round(caloriesValue);
      const plans = {
        lose: [
          ['Breakfast', 'Greek yogurt bowl', 'Berries + seeds', Math.round(calories * 0.24)],
          ['Lunch', 'Grilled chicken salad', 'Lean protein + greens', Math.round(calories * 0.34)],
          ['Dinner', 'Baked fish plate', 'Vegetables + light carbs', Math.round(calories * 0.32)],
          ['Snack', 'Apple + nuts', 'Fiber + healthy fats', Math.round(calories * 0.1)]
        ],
        maintain: [
          ['Breakfast', 'Oats with banana', 'Milk + fruit', Math.round(calories * 0.25)],
          ['Lunch', 'Chicken rice bowl', 'Rice + protein + salad', Math.round(calories * 0.35)],
          ['Dinner', 'Lean protein pasta', 'Pasta + vegetables', Math.round(calories * 0.3)],
          ['Snack', 'Hummus and veggies', 'Light evening snack', Math.round(calories * 0.1)]
        ],
        gain: [
          ['Breakfast', 'Eggs with toast', 'High protein start', Math.round(calories * 0.26)],
          ['Lunch', 'Turkey wrap with rice', 'Carbs + protein', Math.round(calories * 0.34)],
          ['Dinner', 'Steak with potatoes', 'Strength meal', Math.round(calories * 0.3)],
          ['Snack', 'Protein shake', 'Post-workout support', Math.round(calories * 0.1)]
        ]
      };
      const macroHtml = `
        <div class="macro-summary">
          <span><i class="dot purple-dot"></i>${Math.round(calories * 0.28 / 4)}g protein</span>
          <span><i class="dot orange-dot"></i>${Math.round(calories * 0.45 / 4)}g carbs</span>
          <span><i class="dot teal-dot"></i>${Math.round(calories * 0.27 / 9)}g fat</span>
        </div>`;
      const meals = plans[goal].map(([meal, name, portion, kcal], index) => `
        <details class="meal-card" ${index === 0 ? 'open' : ''}>
          <summary><span>${meal}</span><strong>${kcal} kcal</strong></summary>
          <div class="meal-line"><span class="badge-icon ${index % 3 === 0 ? 'purple' : index % 3 === 1 ? 'orange' : 'teal'}">${meal.charAt(0)}</span><div><b>${name}</b><small>${portion}</small></div></div>
        </details>`).join('');
      dietResult.innerHTML = `<strong>Plan for ${calories} kcal</strong>${macroHtml}<div class="meal-list">${meals}</div>`;
      const nutritionCalories = document.getElementById('nutrition-calories');
      const nutritionProtein = document.getElementById('nutrition-protein');
      const nutritionCarbs = document.getElementById('nutrition-carbs');
      const nutritionFats = document.getElementById('nutrition-fats');
      if (nutritionCalories) nutritionCalories.textContent = calories.toLocaleString('en-IN');
      if (nutritionProtein) nutritionProtein.textContent = `${Math.round(calories * 0.28 / 4)}g`;
      if (nutritionCarbs) nutritionCarbs.textContent = `${Math.round(calories * 0.45 / 4)}g`;
      if (nutritionFats) nutritionFats.textContent = `${Math.round(calories * 0.27 / 9)}g`;
    });
  }

  const authForm = document.getElementById('auth-form');
  const authMessage = document.getElementById('auth-message');
  const authTabs = document.querySelectorAll('.auth-tab');
  const authTitle = document.getElementById('auth-title');
  const dashboardTitle = document.getElementById('dashboard-title');
  const authNameInput = document.getElementById('auth-name');
  const authLogout = document.getElementById('auth-logout');
  const authDivider = document.querySelector('#auth .divider');
  let authMode = 'login';

  const updateAuthMode = (mode) => {
    authMode = mode;
    authTabs.forEach((item) => item.classList.toggle('active', item.dataset.mode === mode));
    const passwordInput = document.getElementById('auth-password');
    if (passwordInput) passwordInput.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    if (authNameInput) {
      authNameInput.hidden = mode !== 'register';
      authNameInput.required = mode === 'register';
      if (mode !== 'register') authNameInput.value = '';
    }
    if (authMessage) {
      authMessage.textContent = mode === 'register'
        ? 'Registering your account will unlock member-only planning tools.'
        : 'Welcome back! Sign in to continue your fitness journey.';
    }
  };

  const setLoggedInUser = (user) => {
    const userName = user.name || user.email;
    verifiedSessionUser = user;
    setTimeout(() => refreshClassSchedule(true), 0);
    localStorage.setItem('friends-gym-user', JSON.stringify(user));
    switchActivityOwner(user.id);
    if (authTitle) authTitle.textContent = `Welcome, ${userName}`;
    if (dashboardTitle) dashboardTitle.textContent = `Welcome back, ${userName}`;
    authTabs.forEach((item) => { item.hidden = true; });
    if (authForm) {
      authForm.querySelectorAll('input').forEach((input) => { input.hidden = true; });
      const submitButton = authForm.querySelector('button');
      if (submitButton) {
        submitButton.textContent = 'Logged in';
        submitButton.disabled = true;
        submitButton.hidden = true;
      }
    }
    if (googleAuthButton) googleAuthButton.hidden = true;
    if (authDivider) authDivider.hidden = true;
    if (authForm) authForm.hidden = true;
    if (authLogout) authLogout.hidden = false;
    const accountLabel = accountNav?.querySelector('span');
    if (accountLabel) accountLabel.textContent = 'Profile';
  };

  const resetLoggedOutUi = () => {
    verifiedSessionUser = null;
    setTimeout(() => refreshClassSchedule(true), 0);
    localStorage.removeItem('friends-gym-user');
    switchActivityOwner('guest');
    if (authTitle) authTitle.textContent = 'Login / Register';
    if (dashboardTitle) dashboardTitle.textContent = 'Member dashboard overview';
    authTabs.forEach((item) => { item.hidden = false; });
    if (authForm) {
      authForm.querySelectorAll('input').forEach((input) => {
        input.hidden = false;
        input.value = '';
      });
      const submitButton = authForm.querySelector('button');
      if (submitButton) {
        submitButton.textContent = 'Continue';
        submitButton.disabled = false;
        submitButton.hidden = false;
      }
    }
    if (googleAuthButton) googleAuthButton.hidden = false;
    if (authDivider) authDivider.hidden = false;
    if (authForm) authForm.hidden = false;
    if (authLogout) authLogout.hidden = true;
    const accountLabel = accountNav?.querySelector('span');
    if (accountLabel) accountLabel.textContent = 'Account';
    profileText('home-live-label', 'Live today');
    profileText('home-plan', 'No active plan');
    profileText('home-plan-note', 'Sign in to sync membership');
    profileText('membership-page-plan', 'No active plan');
    profileText('membership-page-expiry', 'Sign in to view your membership');
    profileText('membership-page-status', 'SIGNED OUT');
    updateAuthMode('login');
  };

  const mapSupabaseUser = (user) => ({
    id: user.id,
    name: user.user_metadata?.full_name || user.user_metadata?.name || user.name || user.email?.split('@')[0] || 'Member',
    email: user.email || ''
  });

  const accountNav = document.getElementById('nav-auth');
  const adminDashboardLink = document.getElementById('admin-dashboard-link');
  const profileAdminLink = document.getElementById('profile-admin-link');
  if (isNativeApp) {
    if (installButton) installButton.hidden = true;
    [adminDashboardLink, profileAdminLink].forEach((link) => {
      link?.addEventListener('click', async (event) => {
        event.preventDefault();
        window.location.assign(`${liveApiBase}/admin`);
      });
    });
  }
  const profileLogout = document.getElementById('profile-logout');
  const profileText = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  };
  const niceProfileDate = (value) => {
    if (!value) return '--';
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  const updateLocalActivityTotals = () => {
    const totals = Object.values(sessionHistory).reduce((sum, session) => {
      sum.steps += Number(session?.steps) || 0;
      sum.calories += Number(session?.calories) || 0;
      sum.minutes += Number(session?.minutes) || 0;
      return sum;
    }, { steps: 0, calories: 0, minutes: 0 });
    profileText('profile-total-steps', Math.round(totals.steps).toLocaleString('en-IN'));
    profileText('profile-total-calories', Math.round(totals.calories).toLocaleString('en-IN'));
    profileText('profile-total-time', Math.round(totals.minutes).toLocaleString('en-IN'));
  };
  const populateMemberIdentity = (user, profile = {}) => {
    const mapped = mapSupabaseUser(user);
    const name = profile.full_name || mapped.name || 'Member';
    const initials = name.split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase() || 'FG';
    profileText('profile-name', name);
    profileText('profile-email', mapped.email || 'Email not available');
    profileText('profile-member-id', `FG-${String(mapped.id || 'MEMBER').replace(/-/g, '').slice(0, 8).toUpperCase()}`);
    profileText('profile-role', (profile.role || 'member').toUpperCase());
    profileText('profile-avatar', initials);
    profileText('profile-avatar-large', initials);
    profileText('home-live-label', `Welcome, ${name.split(/\s+/)[0]}`);
    const isAdmin = profile.role === 'admin';
    if (adminDashboardLink) adminDashboardLink.hidden = !isAdmin;
    if (profileAdminLink) profileAdminLink.hidden = !isAdmin;
    updateLocalActivityTotals();
  };
  const populateMembership = (membership) => {
    const status = membership?.status || 'none';
    profileText('profile-membership-status', status === 'none' ? 'NO ACTIVE PLAN' : status.toUpperCase());
    profileText('profile-plan', membership?.plan_name || 'No membership assigned');
    profileText('profile-plan-start', niceProfileDate(membership?.starts_on));
    profileText('profile-plan-expiry', niceProfileDate(membership?.expires_on));
    profileText('profile-plan-amount', membership?.amount_inr ? `Rs ${Number(membership.amount_inr).toLocaleString('en-IN')}` : '--');
    profileText('profile-plan-note', membership ? 'Membership details are synced securely with the gym.' : 'Ask the gym admin to assign or activate your membership.');
    profileText('home-plan', membership?.plan_name || 'No active plan');
    profileText('home-plan-note', membership?.expires_on ? `Valid until ${niceProfileDate(membership.expires_on)}` : 'Choose a plan to unlock benefits');
    profileText('membership-page-plan', membership?.plan_name || 'No active plan');
    profileText('membership-page-expiry', membership?.expires_on ? `Valid until ${niceProfileDate(membership.expires_on)}` : 'Sign in or choose a membership');
    profileText('membership-page-status', status === 'none' ? 'NONE' : status.toUpperCase());
    const badge = document.getElementById('profile-membership-status');
    if (badge) badge.dataset.status = status;
  };
  const loadMemberDashboard = async (user, { redirect = false } = {}) => {
    if (!user) return;
    const mapped = mapSupabaseUser(user);
    setLoggedInUser(mapped);
    populateMemberIdentity(user);
    populateMembership(null);
    const client = await getSupabaseClient();
    if (client) {
      const [profileResult, membershipResult] = await Promise.all([
        client.from('profiles').select('full_name, phone, role, created_at').eq('id', user.id).maybeSingle(),
        client.from('memberships').select('plan_name, status, starts_on, expires_on, amount_inr, created_at').eq('member_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
      ]);
      if (profileResult.error) {
        populateMemberIdentity(user, { role: 'member' });
        if (authMessage) authMessage.textContent = 'Your secure profile could not be loaded. Please refresh or sign in again.';
      } else {
        populateMemberIdentity(user, profileResult.data || {});
      }
      if (membershipResult.error) {
        profileText('profile-membership-status', 'UNAVAILABLE');
        profileText('profile-plan', 'Membership could not be loaded');
        profileText('profile-plan-note', 'Please refresh or contact the gym if this continues.');
      } else {
        populateMembership(membershipResult.data || null);
      }
    }
    await syncActivityCloud(user.id);
    if (accountNav) accountNav.dataset.screen = 'profile';
    const signedInRoute = routeToScreen[window.location.pathname];
    if (redirect || window.location.pathname === '/auth') showScreen('home');
    else if (['profile', 'progress', 'settings'].includes(signedInRoute)) showScreen(signedInRoute, { push: false, remember: false });
  };
  const logoutMember = async () => {
    const client = await getSupabaseClient();
    if (client) await client.auth.signOut();
    resetLoggedOutUi();
    if (accountNav) accountNav.dataset.screen = 'auth';
    if (adminDashboardLink) adminDashboardLink.hidden = true;
    if (profileAdminLink) profileAdminLink.hidden = true;
    if (authMessage) authMessage.textContent = 'You have been logged out.';
    showScreen('auth');
  };
  if (authForm && authMessage) {
    updateAuthMode('login');

    authTabs.forEach((tab) => {
      tab.addEventListener('click', () => updateAuthMode(tab.dataset.mode));
    });

    getSupabaseClient().then(async (client) => {
      if (!client) {
        resetLoggedOutUi();
        authMessage.textContent = 'Secure login is temporarily unavailable. Please try again later.';
        if (['/profile', '/progress', '/settings'].includes(window.location.pathname)) showScreen('auth');
        return;
      }
      const { data, error } = await client.auth.getSession();
      if (error) {
        resetLoggedOutUi();
        authMessage.textContent = 'Your session could not be verified. Please sign in again.';
        showScreen('auth');
      } else if (data.session?.user) {
        await loadMemberDashboard(data.session.user);
        authMessage.textContent = 'You are securely signed in. Logout before using another account on this device.';
      } else {
        resetLoggedOutUi();
        if (['/profile', '/progress', '/settings'].includes(window.location.pathname)) showScreen('auth');
      }
      client.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          setTimeout(() => loadMemberDashboard(session.user, { redirect: true }), 0);
        }
        if (event === 'SIGNED_OUT') {
          setTimeout(() => {
            resetLoggedOutUi();
            if (document.getElementById('profile')?.classList.contains('active') || document.getElementById('progress')?.classList.contains('active') || document.getElementById('settings')?.classList.contains('active')) showScreen('auth');
          }, 0);
        }
      });
    });
    if (authLogout) authLogout.addEventListener('click', logoutMember);
    if (profileLogout) profileLogout.addEventListener('click', logoutMember);

    authForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = document.getElementById('auth-name').value.trim();
      const email = document.getElementById('auth-email').value.trim().toLowerCase();
      const password = document.getElementById('auth-password').value;
      if (!email || !password) {
        authMessage.textContent = 'Please enter your email and password.';
        return;
      }
      if (password.length < 8) {
        authMessage.textContent = 'Password must contain at least 8 characters.';
        return;
      }
      if (authMode === 'register' && !name) {
        authMessage.textContent = 'Please enter your name to register.';
        return;
      }

      const submitButton = authForm.querySelector('button[type="submit"]');
      if (submitButton) submitButton.disabled = true;
      try {
        const client = await getSupabaseClient();
        if (client) {
          if (authMode === 'register') {
            const { data, error } = await client.auth.signUp({
              email,
              password,
              options: {
                data: { full_name: name },
                emailRedirectTo: isNativeApp ? nativeAuthRedirect : `${window.location.origin}/auth`
              }
            });
            if (error) throw error;
            if (data.session?.user) {
              await loadMemberDashboard(data.session.user, { redirect: true });
              authMessage.textContent = 'Registration successful. Welcome to Friends Gym!';
              showAuthToast('Account created successfully.');

            } else {
              authMessage.textContent = 'Account created. Please check your email and confirm your account.';
            }
          } else {
            const { data, error } = await client.auth.signInWithPassword({ email, password });
            if (error) throw error;
            await loadMemberDashboard(data.user, { redirect: true });
            authMessage.textContent = 'Login successful! Welcome back.';
            showAuthToast('Signed in - opening Home...');
          }
          return;
        }

        throw new Error('Secure login is unavailable. Please try again later.');
      } catch (error) {
        authMessage.textContent = error.message || 'Unable to sign in. Please try again.';
      } finally {
        if (submitButton && !submitButton.hidden) submitButton.disabled = false;
      }
    });
  }

  const postJson = async (endpoint, payload) => {
    const response = await fetch(`${apiBase}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Request failed.');
    return data;
  };

  const bookingForm = document.getElementById('booking-form');
  const bookingResult = document.getElementById('booking-result');
  if (bookingForm && bookingResult) {
    bookingForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const result = await postJson('/api/bookings', {
          name: document.getElementById('booking-name').value.trim(),
          phone: document.getElementById('booking-phone').value.trim(),
          plan: document.getElementById('booking-plan').value
        });
        bookingResult.textContent = result.message;
        bookingForm.reset();
      } catch (error) {
        bookingResult.textContent = error.message;
      }
    });
  }

  const classSchedule = document.getElementById('class-schedule');
  const classBookingStatus = document.getElementById('class-booking-status');
  const refreshClassesButton = document.getElementById('refresh-classes');
  const escapeClassText = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
  const classDateLabel = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Schedule pending';
    return date.toLocaleString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };
  const classReminderId = (classId) => {
    let hash = 17;
    for (const character of String(classId || '')) hash = ((hash * 31) + character.charCodeAt(0)) | 0;
    return Math.abs(hash || 1);
  };
  const classReminderTime = (startsAt) => {
    const start = new Date(startsAt);
    if (Number.isNaN(start.getTime()) || start.getTime() <= Date.now()) return null;
    const oneHourBefore = start.getTime() - (60 * 60 * 1000);
    return new Date(Math.max(oneHourBefore, Date.now() + 15 * 1000));
  };
  const scheduleClassReminder = async ({ id, title, startsAt }) => {
    if (!isNativeApp) return { scheduled: false, message: 'Background reminder updated Android app mein available hai.' };
    const notifications = window.Capacitor?.Plugins?.LocalNotifications;
    if (!notifications) return { scheduled: false, message: 'Reminder ke liye updated Android app install karein.' };
    const at = classReminderTime(startsAt);
    if (!at) return { scheduled: false, message: 'Class time reminder ke liye valid nahi hai.' };
    let permission = await notifications.checkPermissions();
    if (permission.display !== 'granted') permission = await notifications.requestPermissions();
    if (permission.display !== 'granted') return { scheduled: false, message: 'Class booked, lekin notification permission off hai.' };
    if (window.Capacitor?.getPlatform?.() === 'android') {
      await notifications.createChannel({
        id: 'class-reminders',
        name: 'Class reminders',
        description: 'Friends Gym booked class reminders',
        importance: 4,
        visibility: 1,
        vibration: true
      });
    }
    const notificationId = classReminderId(id);
    await notifications.cancel({ notifications: [{ id: notificationId }] });
    await notifications.schedule({
      notifications: [{
        id: notificationId,
        title: 'Your class starts soon',
        body: `${title || 'Friends Gym class'} starts at ${classDateLabel(startsAt)}. Get ready!`,
        schedule: { at },
        channelId: 'class-reminders',
        autoCancel: true,
        extra: { classId: id }
      }]
    });
    return {
      scheduled: true,
      message: `Reminder ${at.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} ke liye set hai.`
    };
  };
  const cancelClassReminder = async (classId) => {
    const notifications = window.Capacitor?.Plugins?.LocalNotifications;
    if (!isNativeApp || !notifications) return;
    await notifications.cancel({ notifications: [{ id: classReminderId(classId) }] });
  };
  let activeClassFilter = 'all';
  let latestClassSchedule = [];
  const renderClassSchedule = (classes) => {
    if (!classSchedule) return;
    latestClassSchedule = Array.isArray(classes) ? classes : [];
    const visibleClasses = activeClassFilter === 'all'
      ? latestClassSchedule
      : latestClassSchedule.filter((item) => String(item.category || '').toLowerCase() === activeClassFilter);
    if (!visibleClasses.length) {
      classSchedule.innerHTML = '<div class="class-card"><h5>No upcoming classes</h5><p>New sessions will appear here when the gym publishes them.</p></div>';
      return;
    }
    classSchedule.innerHTML = visibleClasses.map((item) => {
      const booked = Number(item.booked_count || 0);
      const capacity = Math.max(1, Number(item.capacity || 1));
      const seats = Math.max(0, capacity - booked);
      const isBooked = ['booked', 'attended'].includes(item.user_booking_status);
      const isFull = seats === 0 && !isBooked;
      const categoryClass = String(item.category || 'fitness').toLowerCase().replace(/[^a-z0-9_-]/g, '');
      return `<article class="class-card live-class-card ${isBooked ? 'is-booked' : ''}">
        <div class="class-card-top"><span class="class-tag ${categoryClass}">${escapeClassText(item.category || 'Fitness')}</span><span class="class-date">${escapeClassText(classDateLabel(item.starts_at))}</span></div>
        <h5>${escapeClassText(item.title)}</h5>
        <p>${escapeClassText(item.description || 'Coach-led Friends Gym class.')}</p>
        <div class="class-meta"><span><b>${Number(item.duration_minutes) || 45} min</b></span><span><b>${escapeClassText(item.level || 'All levels')}</b></span><span><b>${escapeClassText(item.trainer_name || 'Friends Gym Coach')}</b></span></div>
        <div class="class-seat-row"><span>${isBooked ? 'Your seat is confirmed' : `${seats} of ${capacity} seats left`}</span><button class="class-book-button ${isBooked ? 'cancel' : ''}" type="button" data-class-id="${escapeClassText(item.id)}" data-class-title="${escapeClassText(item.title)}" data-class-start="${escapeClassText(item.starts_at)}" data-class-action="${isBooked ? 'cancel' : 'book'}" ${isFull ? 'disabled' : ''}>${isBooked ? 'Cancel booking' : (isFull ? 'Class full' : 'Book class')}</button></div>
      </article>`;
    }).join('');
  };
  refreshClassSchedule = async (quiet = false) => {
    if (!classSchedule) return;
    if (!verifiedSessionUser) {
      classSchedule.innerHTML = '<div class="class-card class-login-card"><h5>Sign in to book classes</h5><p>Class seats and your bookings are protected by your member account.</p><button class="btn btn-primary" type="button" data-class-login>Open secure login</button></div>';
      if (!quiet && classBookingStatus) classBookingStatus.textContent = 'Login is required to view live availability.';
      return;
    }
    if (!quiet) classSchedule.classList.add('loading');
    try {
      const client = await getSupabaseClient();
      if (!client) throw new Error('Class service is unavailable.');
      const { data, error } = await client.rpc('get_class_schedule');
      if (error) throw error;
      renderClassSchedule(Array.isArray(data) ? data : []);
      if (!quiet && classBookingStatus) classBookingStatus.textContent = 'Live seats updated just now.';
    } catch (error) {
      classSchedule.innerHTML = '<div class="class-card"><h5>Schedule unavailable</h5><p>Run the class booking SQL setup, then refresh this page.</p></div>';
      if (classBookingStatus) classBookingStatus.textContent = error.message || 'Classes could not be loaded.';
    } finally {
      classSchedule.classList.remove('loading');
    }
  };
  refreshClassesButton?.addEventListener('click', () => refreshClassSchedule());
  document.querySelectorAll('[data-class-filter]').forEach((button) => button.addEventListener('click', () => {
    activeClassFilter = button.dataset.classFilter || 'all';
    document.querySelectorAll('[data-class-filter]').forEach((item) => item.classList.toggle('active', item === button));
    if (!verifiedSessionUser) refreshClassSchedule(true);
    else renderClassSchedule(latestClassSchedule);
  }));
  classSchedule?.addEventListener('click', async (event) => {
    const loginButton = event.target.closest('[data-class-login]');
    if (loginButton) return showScreen('auth');
    const button = event.target.closest('[data-class-action]');
    if (!button || button.disabled) return;
    button.disabled = true;
    try {
      const client = await getSupabaseClient();
      const action = button.dataset.classAction;
      const rpcName = action === 'cancel' ? 'cancel_class_booking' : 'book_class';
      const { error } = await client.rpc(rpcName, { target_class_id: button.dataset.classId });
      if (error) throw error;
      if (action === 'cancel') {
        await cancelClassReminder(button.dataset.classId).catch(() => {});
        if (classBookingStatus) classBookingStatus.textContent = 'Class booking aur reminder cancel ho gaye.';
      } else {
        const reminder = await scheduleClassReminder({
          id: button.dataset.classId,
          title: button.dataset.classTitle,
          startsAt: button.dataset.classStart
        }).catch(() => ({ scheduled: false, message: 'Class booked, lekin reminder set nahi ho saka.' }));
        if (classBookingStatus) classBookingStatus.textContent = `Class booked! ${reminder.message}`;
      }
      await refreshClassSchedule(true);
    } catch (error) {
      if (classBookingStatus) classBookingStatus.textContent = error.message || 'Booking could not be updated.';
      button.disabled = false;
    }
  });

  const paymentStatus = document.getElementById('payment-status');
  const paymentButtons = [...document.querySelectorAll('[data-payment-plan]')];
  const setPaymentBusy = (busy) => paymentButtons.forEach((button) => { button.disabled = busy; });
  const paymentRequest = async (endpoint, payload, accessToken) => {
    const response = await fetch(`${apiBase}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Payment request failed.');
    return data;
  };
  const beginMembershipPayment = async (planCode) => {
    if (!paymentStatus) return;
    setPaymentBusy(true);
    let checkoutOpened = false;
    try {
      const client = await getSupabaseClient();
      const { data: sessionData } = client ? await client.auth.getSession() : { data: {} };
      const session = sessionData?.session;
      if (!session?.access_token || !session.user) {
        paymentStatus.textContent = 'Please sign in first. Opening secure login...';
        setTimeout(() => showScreen('auth'), 500);
        return;
      }
      if (typeof window.Razorpay !== 'function') throw new Error('Secure checkout could not load. Check your internet and try again.');
      paymentStatus.textContent = 'Creating a secure test order...';
      const checkoutData = await paymentRequest('/api/payments/order', { planCode }, session.access_token);
      const user = session.user;
      const checkout = new window.Razorpay({
        key: checkoutData.keyId,
        amount: checkoutData.order.amount,
        currency: checkoutData.order.currency,
        name: 'Friends Gym',
        description: `${checkoutData.plan.name} membership`,
        order_id: checkoutData.order.id,
        prefill: {
          name: user.user_metadata?.full_name || user.user_metadata?.name || '',
          email: user.email || ''
        },
        theme: { color: '#57d795' },
        retry: { enabled: false },
        handler: async (response) => {
          setPaymentBusy(true);
          paymentStatus.textContent = 'Payment received. Verifying securely...';
          try {
            const verified = await paymentRequest('/api/payments/verify', response, session.access_token);
            paymentStatus.textContent = verified.message;
            await loadMemberDashboard(user);
            setTimeout(() => showScreen('profile'), 900);
          } catch (verificationError) {
            paymentStatus.textContent = verificationError.message;
          } finally {
            setPaymentBusy(false);
          }
        },
        modal: {
          ondismiss: () => {
            paymentStatus.textContent = 'Payment cancelled. No membership was activated.';
            setPaymentBusy(false);
          }
        }
      });
      checkout.on('payment.failed', (response) => {
        paymentStatus.textContent = response?.error?.description || 'Test payment failed. Membership was not activated.';
        setPaymentBusy(false);
      });
      paymentStatus.textContent = 'Secure Razorpay checkout opened.';
      checkout.open();
      checkoutOpened = true;
    } catch (error) {
      paymentStatus.textContent = error.message || 'Payment could not be started.';
    } finally {
      if (!checkoutOpened) setPaymentBusy(false);
    }
  };
  paymentButtons.forEach((button) => button.addEventListener('click', () => beginMembershipPayment(button.dataset.paymentPlan)));

  document.querySelectorAll('[data-plan]').forEach((button) => {
    button.addEventListener('click', () => {
      const planSelect = document.getElementById('booking-plan');
      if (planSelect) planSelect.value = button.dataset.plan;
      if (bookingResult) bookingResult.textContent = `${button.dataset.plan} selected. Send your callback request to continue.`;
    });
  });
  const contactForm = document.getElementById('contact-form');
  const contactResult = document.getElementById('contact-result');
  if (contactForm && contactResult) {
    contactForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const result = await postJson('/api/contact', {
          name: document.getElementById('contact-name').value.trim(),
          email: document.getElementById('contact-email').value.trim(),
          message: document.getElementById('contact-message').value.trim()
        });
        contactResult.textContent = result.message;
        contactForm.reset();
      } catch (error) {
        contactResult.textContent = error.message;
      }
    });
  }

  const yearElement = document.getElementById('year');
  if (yearElement) yearElement.textContent = new Date().getFullYear();

  const trainerExercises = [
    { id:'squat', short:'Squat', icon:'SQ', video:'assets/trainer-squat.mp4', name:'Bodyweight Squat', muscle:'LEGS / GLUTES', sets:3, reps:'12', rest:45, coaching:'Keep your chest tall and push your knees in line with your toes.', steps:['Stand with feet slightly wider than hips.','Brace your core and sit your hips back.','Lower until thighs are comfortable near parallel.','Drive through your whole foot to stand tall.'] },
    { id:'pushup', short:'Push-up', icon:'PU', video:'assets/trainer-pushup.mp4', name:'Push-up', muscle:'CHEST / ARMS', sets:3, reps:'10', rest:45, coaching:'Keep one straight line from head to heel and move with control.', steps:['Place hands slightly wider than shoulders.','Brace your core and keep your body straight.','Lower your chest toward the floor.','Press the floor away without shrugging.'] },
    { id:'bench', short:'Bench', icon:'BP', video:'assets/bench-press.mp4', name:'Bench Press', muscle:'CHEST / TRICEPS', sets:3, reps:'10', rest:60, coaching:'Keep shoulder blades gently pulled back and feet planted.', steps:['Lie with eyes just below the bar.','Grip slightly wider than shoulder width.','Lower the bar under control toward mid-chest.','Press upward while keeping shoulders stable.'] },
    { id:'lunge', short:'Lunge', icon:'LG', video:'assets/trainer-lunge.mp4', name:'Reverse Lunge', muscle:'LEGS / BALANCE', sets:3, reps:'8 / side', rest:45, coaching:'Step far enough back so the front heel stays grounded.', steps:['Stand tall with feet hip-width apart.','Step one foot back and lower gently.','Keep the front knee tracking over the toes.','Push through the front foot to return.'] },
    { id:'ropes', short:'Ropes', icon:'BR', video:'assets/battle-ropes.mp4', name:'Battle Ropes', muscle:'FULL BODY / CARDIO', sets:4, reps:'30 sec', rest:30, coaching:'Stay athletic with a braced core and make smooth alternating waves.', steps:['Stand with feet shoulder-width and knees soft.','Hold one rope end in each hand.','Alternate arms while keeping your chest tall.','Maintain steady waves for the full interval.'] }
  ];
  const trainerPicker = document.getElementById('trainer-picker');
  if (trainerPicker) {
    let trainerActive = 0;
    let trainerTimer = null;
    let trainerSeconds = trainerExercises[0].rest;
    const trainerDone = new Set(JSON.parse(localStorage.getItem(trainerDoneKey()) || '[]'));
    const trainerSearch = document.getElementById('trainer-search');
    const applyTrainerSearch = () => {
      const query = String(trainerSearch?.value || '').trim().toLowerCase();
      trainerPicker.querySelectorAll('[data-trainer-index]').forEach((button) => {
        const exercise = trainerExercises[Number(button.dataset.trainerIndex)];
        button.hidden = Boolean(query) && !`${exercise.name} ${exercise.muscle} ${exercise.short}`.toLowerCase().includes(query);
      });
    };
    const trainerClock = document.getElementById('trainer-rest-clock');
    const trainerComplete = document.getElementById('trainer-complete');
    const trainerRestButton = document.getElementById('trainer-rest-start');
    const renderTrainerClock = () => { trainerClock.textContent = `00:${String(trainerSeconds).padStart(2,'0')}`; };
    const renderTrainer = () => {
      const item = trainerExercises[trainerActive];
      trainerPicker.innerHTML = trainerExercises.map((exercise,index) => `<button class="trainer-chip ${index===trainerActive?'active':''} ${trainerDone.has(exercise.id)?'done':''}" type="button" data-trainer-index="${index}">${exercise.short}</button>`).join(''); applyTrainerSearch();
      const trainerVisual=document.getElementById('trainer-visual'); const trainerVideo=document.getElementById('trainer-video'); const mediaLabel=document.getElementById('trainer-media-label'); trainerVisual.textContent=item.icon; if(item.video){trainerVideo.src=item.video;trainerVideo.hidden=false;trainerVisual.hidden=true;mediaLabel.textContent='Tap video to pause';trainerVideo.play().catch(()=>{});}else{trainerVideo.pause();trainerVideo.removeAttribute('src');trainerVideo.load();trainerVideo.hidden=true;trainerVisual.hidden=false;mediaLabel.textContent='Demo coming soon';} document.getElementById('trainer-muscle').textContent=item.muscle; document.getElementById('trainer-name').textContent=item.name; document.getElementById('trainer-coaching').textContent=item.coaching; document.getElementById('trainer-sets').textContent=item.sets; document.getElementById('trainer-reps').textContent=item.reps; document.getElementById('trainer-rest').textContent=`${item.rest}s`; document.getElementById('trainer-steps').innerHTML=item.steps.map(step=>`<li>${step}</li>`).join(''); document.getElementById('trainer-progress').textContent=`${trainerDone.size}/${trainerExercises.length} done`;
      trainerComplete.textContent=trainerDone.has(item.id)?'Completed - DONE':'Mark exercise complete'; trainerComplete.classList.toggle('completed',trainerDone.has(item.id)); clearInterval(trainerTimer); trainerTimer=null; trainerSeconds=item.rest; trainerRestButton.firstChild.textContent='Start rest '; renderTrainerClock();
    };
    document.getElementById('trainer-video')?.addEventListener('click',event=>{if(event.currentTarget.paused)event.currentTarget.play().catch(()=>{});else event.currentTarget.pause();});
    trainerSearch?.addEventListener('input', applyTrainerSearch);
    trainerPicker.addEventListener('click',event=>{const button=event.target.closest('[data-trainer-index]');if(!button)return;trainerActive=Number(button.dataset.trainerIndex);renderTrainer();});
    reloadTrainerForOwner=()=>{trainerDone.clear();JSON.parse(localStorage.getItem(trainerDoneKey())||'[]').forEach(id=>trainerDone.add(id));renderTrainer();};
    trainerComplete.addEventListener('click',()=>{const id=trainerExercises[trainerActive].id;if(trainerDone.has(id))trainerDone.delete(id);else trainerDone.add(id);localStorage.setItem(trainerDoneKey(),JSON.stringify([...trainerDone]));renderTrainer();});
    trainerRestButton.addEventListener('click',()=>{if(trainerTimer){clearInterval(trainerTimer);trainerTimer=null;trainerRestButton.firstChild.textContent='Resume rest ';return;}if(trainerSeconds<=0)trainerSeconds=trainerExercises[trainerActive].rest;trainerRestButton.firstChild.textContent='Pause rest ';trainerTimer=setInterval(()=>{trainerSeconds-=1;renderTrainerClock();if(trainerSeconds<=0){clearInterval(trainerTimer);trainerTimer=null;trainerRestButton.firstChild.textContent='Rest complete ';if(navigator.vibrate)navigator.vibrate([120,80,120]);}},1000);});
    renderTrainer();
  }
  const autoTrackerStart = document.getElementById('auto-tracker-start');
  const autoTrackerStatus = document.getElementById('auto-tracker-status');
  const sessionWeight = document.getElementById('session-weight');
  const autoTrackerPanel = document.querySelector('.auto-tracker-panel');
  let autoTracking = false;
  let autoMotionHandler = null;
  let autoLiveInterval = null;
  let autoLastMagnitude = null;
  let autoLastStepAt = 0;
  let autoStepTimes = [];
  let autoMotionSamples = [];
  let healthConnectActive = false;
  let healthConnectInterval = null;
  let healthLastSteps = null;
  let healthLastReadAt = null;
  let healthCadence = 0;

  const autoIntensityFromMotion = () => {
    if (healthConnectActive) {
      if (healthCadence >= 115) return 'hard';
      if (healthCadence >= 65) return 'moderate';
      return 'light';
    }
    const now = Date.now();
    autoStepTimes = autoStepTimes.filter(time => now - time < 30000);
    const cadence = autoStepTimes.length * 2;
    const motion = autoMotionSamples.length ? autoMotionSamples.reduce((sum,value)=>sum+value,0) / autoMotionSamples.length : 0;
    if (cadence >= 115 || motion > 2.6) return 'hard';
    if (cadence >= 65 || motion > 1.25) return 'moderate';
    return 'light';
  };
  const setAutoIntensity = (intensity) => {
    if (sessionIntensity) sessionIntensity.value = intensity;
    document.querySelectorAll('[data-segmented="session-intensity"] .segment').forEach(button => {
      const active = button.dataset.value === intensity;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  };
  const updateAutoLiveStats = () => {
    if (!autoTracking || !sessionStartedAt) return;
    const seconds = Math.max(1,Math.floor((Date.now()-sessionStartedAt)/1000));
    const minutesExact = seconds / 60;
    const steps = Math.max(0,Number(sessionSteps?.value||0));
    const weight = Math.max(30,Number(sessionWeight?.value||70));
    const intensity = autoIntensityFromMotion();
    setAutoIntensity(intensity);
        const calories = calculateCalories(minutesExact, sessionWorkout?.value || 'strength', intensity, weight);
    const distanceKm = steps*.000762;
    if(sessionRowSteps) sessionRowSteps.textContent=steps.toLocaleString();
    if(sessionRowTime) sessionRowTime.textContent=`${Math.floor(minutesExact)}m`;
    if(sessionRowCalories) sessionRowCalories.textContent=String(calories);
    if(sessionCalories) sessionCalories.textContent=String(calories);
    if(sessionDistance) sessionDistance.textContent=`${distanceKm.toFixed(2)} km`;
    if(dashboardSteps) dashboardSteps.textContent=steps.toLocaleString();
    if(dashboardCalories) dashboardCalories.textContent=`${calories} kcal`;
    if(dashboardTime) dashboardTime.textContent=`${Math.floor(minutesExact)} min`;
    if(autoTrackerStatus) autoTrackerStatus.textContent=`Tracking - ${intensity} - ${autoStepTimes.length*2} steps/min · calorie estimate`;
  };
  const stopAutoTracking = (message='Paused - tap Enable & Start to continue') => {
    autoTracking=false;
    if(autoMotionHandler) window.removeEventListener('devicemotion',autoMotionHandler);
    autoMotionHandler=null; clearInterval(autoLiveInterval); autoLiveInterval=null;
    clearInterval(healthConnectInterval); healthConnectInterval=null; healthConnectActive=false;
    autoTrackerPanel?.classList.remove('tracking');
    if(autoTrackerStart) autoTrackerStart.textContent='Enable & Start';
    if(autoTrackerStatus) autoTrackerStatus.textContent=message;
  };
  const readHealthConnectSteps = async () => {
    const plugin = window.Capacitor?.Plugins?.HealthConnect;
    if (!plugin) throw new Error('Health Connect plugin unavailable');
    const result = await plugin.readTodaySteps();
    const steps = Math.max(0, Number(result?.steps || 0));
    const now = Date.now();
    if (healthLastSteps != null && healthLastReadAt && steps >= healthLastSteps) {
      healthCadence = Math.round((steps - healthLastSteps) * 60000 / Math.max(1000, now - healthLastReadAt));
    }
    healthLastSteps = steps;
    healthLastReadAt = now;
    if (sessionSteps) sessionSteps.value = String(steps);
    updateAutoLiveStats();
  };
  const beginHealthConnectTracking = async () => {
    const plugin = window.Capacitor?.Plugins?.HealthConnect;
    if (!plugin) return false;
    try {
      if (autoTrackerStatus) autoTrackerStatus.textContent = 'Checking Health Connect...';
      const availability = await plugin.status();
      if (availability?.status !== 'available') {
        if (autoTrackerStatus) autoTrackerStatus.textContent = availability?.status === 'update-required' ? 'Install or update Health Connect, then try again' : 'Health Connect is unavailable on this phone';
        return true;
      }
      const permission = await plugin.requestStepsPermission();
      if (!permission?.granted) {
        if (autoTrackerStatus) autoTrackerStatus.textContent = 'Steps access not allowed - enable it in Health Connect settings';
        return true;
      }
      if (!sessionStartedAt) startSession?.click();
      autoTracking = true;
      healthConnectActive = true;
      healthLastSteps = null;
      healthLastReadAt = null;
      healthCadence = 0;
      await readHealthConnectSteps();
      healthConnectInterval = setInterval(() => readHealthConnectSteps().catch(() => {}), 15000);
      autoLiveInterval = setInterval(updateAutoLiveStats, 1000);
      autoTrackerPanel?.classList.add('tracking');
      if (autoTrackerStart) autoTrackerStart.textContent = 'Pause tracking';
      if (autoTrackerStatus) autoTrackerStatus.textContent = 'Health Connect linked - today steps are live';
      return true;
    } catch (error) {
      if (autoTrackerStatus) autoTrackerStatus.textContent = 'Health Connect could not start - use manual mode';
      return true;
    }
  };
  const beginAutoTracking = async () => {
    if (isNativeApp && await beginHealthConnectTracking()) return;
    if(!('DeviceMotionEvent' in window)){ if(autoTrackerStatus)autoTrackerStatus.textContent='Motion sensor unavailable - use manual fields'; return; }
    try {
      if(typeof DeviceMotionEvent.requestPermission==='function'){
        const permission=await DeviceMotionEvent.requestPermission();
        if(permission!=='granted'){if(autoTrackerStatus)autoTrackerStatus.textContent='Motion permission denied';return;}
      }
      if(!sessionStartedAt) startSession?.click();
      autoTracking=true; autoStepTimes=[]; autoMotionSamples=[]; autoLastMagnitude=null;
      autoMotionHandler=(event)=>{
        const a=event.accelerationIncludingGravity||event.acceleration; if(!a||a.x==null||a.y==null||a.z==null)return;
        const magnitude=Math.sqrt(a.x*a.x+a.y*a.y+a.z*a.z); if(autoLastMagnitude==null){autoLastMagnitude=magnitude;return;}
        const delta=Math.abs(magnitude-autoLastMagnitude); autoLastMagnitude=magnitude; autoMotionSamples.push(delta); if(autoMotionSamples.length>40)autoMotionSamples.shift();
        const now=Date.now(); if(delta>1.65&&now-autoLastStepAt>280){autoLastStepAt=now;autoStepTimes.push(now);if(sessionSteps)sessionSteps.value=String(Number(sessionSteps.value||0)+1);}
      };
      window.addEventListener('devicemotion',autoMotionHandler,{passive:true});
      autoLiveInterval=setInterval(updateAutoLiveStats,1000); updateAutoLiveStats();
      autoTrackerPanel?.classList.add('tracking'); autoTrackerStart.textContent='Pause tracking';
    } catch { if(autoTrackerStatus)autoTrackerStatus.textContent='Sensor could not start - use manual mode'; }
  };
  autoTrackerStart?.addEventListener('click',()=>{if(autoTracking)stopAutoTracking();else beginAutoTracking();});
  stopSession?.addEventListener('click',()=>stopAutoTracking('Workout stopped - values ready to save'));
  resetSession?.addEventListener('click',()=>{stopAutoTracking('Ready - keep app open during workout');if(sessionWeight)sessionWeight.value=localStorage.getItem('friends-gym-weight')||'70';});
  sessionWeight?.addEventListener('change',()=>localStorage.setItem('friends-gym-weight',sessionWeight.value));
  if(sessionWeight)sessionWeight.value=localStorage.getItem('friends-gym-weight')||sessionWeight.value||'70';
  if (isNativeApp && window.Capacitor?.Plugins?.HealthConnect && autoTrackerStart) {
    autoTrackerStart.textContent = 'Connect Health';
    if (autoTrackerStatus) autoTrackerStatus.textContent = 'Connect Health Connect for real daily steps';
  }
});
