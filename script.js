document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.nav-links');
  const themeToggle = document.getElementById('theme-toggle');
  const root = document.documentElement;
  const apiBase = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';
  let installPrompt = null;

  if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    const installButton = document.getElementById('install-app');
    event.preventDefault();
    installPrompt = event;
    if (installButton) installButton.hidden = false;
  });

  const installButton = document.getElementById('install-app');
  if (installButton) {
    installButton.addEventListener('click', async () => {
      if (!installPrompt) {
        const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
        window.alert(isIos
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

  const applyTheme = (theme) => {
    root.setAttribute('data-theme', theme);
    localStorage.setItem('friends-gym-theme', theme);
    if (themeToggle) themeToggle.textContent = theme === 'dark' ? 'Light' : 'Dark';
  };

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const currentTheme = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
      const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
      applyTheme(nextTheme);
    });
  }

  const savedTheme = localStorage.getItem('friends-gym-theme');
  if (savedTheme) {
    applyTheme(savedTheme);
  } else if (themeToggle) {
    themeToggle.textContent = root.getAttribute('data-theme') === 'light' ? 'Dark' : 'Light';
  }

  const revealItems = document.querySelectorAll('.reveal');
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('animate');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });
  revealItems.forEach((item) => revealObserver.observe(item));

  const yearElement = document.getElementById('year');
  if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
  }

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

      bmiResult.innerHTML = `Your BMI is <strong>${bmi}</strong> — <strong>${bmiMessage}</strong>.<br>Your estimated daily calories are <strong>${dailyCalories}</strong> kcal.`;
    });
  }

  const workoutBoxes = document.querySelectorAll('[data-workout]');
  const trackerStatus = document.getElementById('tracker-status');
  if (trackerStatus) {
    const savedWorkout = JSON.parse(localStorage.getItem('friends-gym-workout') || '[]');
    workoutBoxes.forEach((box) => {
      box.checked = savedWorkout.includes(box.value);
    });

    const updateTracker = () => {
      const done = [...workoutBoxes].filter((box) => box.checked).length;
      trackerStatus.textContent = `${done}/${workoutBoxes.length} completed`;
      const completed = [...workoutBoxes].filter((box) => box.checked).map((box) => box.value);
      localStorage.setItem('friends-gym-workout', JSON.stringify(completed));
    };
    workoutBoxes.forEach((box) => box.addEventListener('change', updateTracker));
    updateTracker();
  }

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

  const calculateCalories = (steps, minutes, workout, intensity) => {
    const workoutRates = {
      strength: 5.8,
      cardio: 8.2,
      hiit: 10.5,
      mobility: 3.2
    };
    const intensityRates = {
      light: 0.82,
      moderate: 1,
      hard: 1.22
    };
    const workoutCalories = minutes * workoutRates[workout] * intensityRates[intensity];
    const stepCalories = steps * 0.045;
    return Math.max(0, Math.round(workoutCalories + stepCalories));
  };

  const updateSessionDashboard = (session) => {
    if (!session) return;
    if (dashboardSteps) dashboardSteps.textContent = session.steps.toLocaleString();
    if (dashboardCalories) dashboardCalories.textContent = `${session.calories} kcal`;
    if (dashboardTime) dashboardTime.textContent = `${session.minutes} min`;
    if (sessionCalories) sessionCalories.textContent = session.calories;
    if (sessionDistance) sessionDistance.textContent = `${session.distanceKm.toFixed(2)} km`;
    if (sessionResult) {
      sessionResult.innerHTML = `You walked <strong>${session.steps.toLocaleString()}</strong> steps, spent <strong>${session.minutes}</strong> minutes in gym, and burned around <strong>${session.calories} kcal</strong>.`;
    }
  };

  const savedSession = JSON.parse(localStorage.getItem('friends-gym-session') || 'null');
  updateSessionDashboard(savedSession);

  if (startSession && liveSessionTime) {
    startSession.addEventListener('click', () => {
      sessionStartedAt = Date.now();
      clearInterval(sessionTimer);
      sessionTimer = setInterval(() => {
        const seconds = Math.floor((Date.now() - sessionStartedAt) / 1000);
        liveSessionTime.textContent = formatClock(seconds);
        if (sessionMinutes) sessionMinutes.value = Math.max(1, Math.round(seconds / 60));
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
      const calories = calculateCalories(steps, minutes, workout, intensity);
      const session = {
        steps,
        minutes,
        workout,
        intensity,
        distanceKm,
        calories,
        savedAt: new Date().toISOString()
      };

      localStorage.setItem('friends-gym-session', JSON.stringify(session));
      updateSessionDashboard(session);
    });
  }

  if (resetSession) {
    resetSession.addEventListener('click', () => {
      clearInterval(sessionTimer);
      sessionTimer = null;
      sessionStartedAt = null;
      localStorage.removeItem('friends-gym-session');
      if (sessionForm) sessionForm.reset();
      if (liveSessionTime) liveSessionTime.textContent = '00:00';
      if (sessionCalories) sessionCalories.textContent = '0';
      if (sessionDistance) sessionDistance.textContent = '0.00 km';
      if (dashboardSteps) dashboardSteps.textContent = '0';
      if (dashboardCalories) dashboardCalories.textContent = '0 kcal';
      if (dashboardTime) dashboardTime.textContent = '0 min';
      if (sessionResult) sessionResult.textContent = 'Session reset. Enter new workout details to calculate again.';
    });
  }

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
      let plan = '';

      if (goal === 'lose') {
        plan = `Breakfast: Greek yogurt with berries, Lunch: grilled chicken salad, Dinner: baked fish with vegetables, Snack: apple + nuts.`;
      } else if (goal === 'maintain') {
        plan = `Breakfast: oats with banana, Lunch: rice bowl with chicken, Dinner: pasta with lean protein, Snack: hummus and veggies.`;
      } else {
        plan = `Breakfast: eggs with toast, Lunch: turkey wrap with rice, Dinner: steak with potatoes, Snack: protein shake.`;
      }

      dietResult.innerHTML = `<strong>Plan for ${calories} kcal</strong><br>${plan}`;
    });
  }

  const authForm = document.getElementById('auth-form');
  const authMessage = document.getElementById('auth-message');
  const authTabs = document.querySelectorAll('.auth-tab');
  const authTitle = document.getElementById('auth-title');
  const dashboardTitle = document.getElementById('dashboard-title');
  const authNameInput = document.getElementById('auth-name');
  const authLogout = document.getElementById('auth-logout');
  let authMode = 'login';

  const updateAuthMode = (mode) => {
    authMode = mode;
    authTabs.forEach((item) => item.classList.toggle('active', item.dataset.mode === mode));
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
    localStorage.setItem('friends-gym-user', JSON.stringify(user));
    if (authTitle) authTitle.textContent = `Welcome, ${userName}`;
    if (dashboardTitle) dashboardTitle.textContent = `Welcome back, ${userName}`;
    authTabs.forEach((item) => { item.hidden = true; });
    if (authForm) {
      authForm.querySelectorAll('input').forEach((input) => {
        input.hidden = true;
      });
      const submitButton = authForm.querySelector('button');
      if (submitButton) {
        submitButton.textContent = 'Logged in';
        submitButton.disabled = true;
        submitButton.hidden = true;
      }
    }
    if (authLogout) authLogout.hidden = false;
  };

  if (authForm && authMessage) {
    updateAuthMode('login');

    const savedUser = JSON.parse(localStorage.getItem('friends-gym-user') || 'null');
    if (savedUser) {
      setLoggedInUser(savedUser);
      authMessage.textContent = 'You are signed in on this device.';
    }

    authTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        updateAuthMode(tab.dataset.mode);
      });
    });

    if (authLogout) {
      authLogout.addEventListener('click', () => {
        localStorage.removeItem('friends-gym-user');
        if (authTitle) authTitle.textContent = 'Login / Register';
        if (dashboardTitle) dashboardTitle.textContent = 'Member dashboard overview';
        authTabs.forEach((item) => { item.hidden = false; });
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
        authLogout.hidden = true;
        updateAuthMode('login');
        authMessage.textContent = 'You have been logged out.';
      });
    }

    authForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = document.getElementById('auth-name').value.trim();
      const email = document.getElementById('auth-email').value.trim();
      const password = document.getElementById('auth-password').value;

      if (!email || !password) {
        authMessage.textContent = 'Please enter your email and password.';
        return;
      }

      if (authMode === 'register' && !name) {
        authMessage.textContent = 'Please enter your name to register.';
        return;
      }

      try {
        const endpoint = `${apiBase}${authMode === 'register' ? '/api/register' : '/api/login'}`;
        const payload = authMode === 'register'
          ? { name, email, password }
          : { email, password };

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const result = await response.json();
        authMessage.textContent = result.message || 'Request completed.';

        if (response.ok && result.user) {
          setLoggedInUser(result.user);
        }
      } catch (error) {
        authMessage.textContent = 'Unable to reach the server. Please try again.';
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
      const payload = {
        name: document.getElementById('booking-name').value.trim(),
        phone: document.getElementById('booking-phone').value.trim(),
        plan: document.getElementById('booking-plan').value
      };

      try {
        const result = await postJson('/api/bookings', payload);
        bookingResult.textContent = result.message;
        bookingForm.reset();
      } catch (error) {
        bookingResult.textContent = error.message;
      }
    });
  }

  const contactForm = document.getElementById('contact-form');
  const contactResult = document.getElementById('contact-result');
  if (contactForm && contactResult) {
    contactForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = {
        name: document.getElementById('contact-name').value.trim(),
        email: document.getElementById('contact-email').value.trim(),
        message: document.getElementById('contact-message').value.trim()
      };

      try {
        const result = await postJson('/api/contact', payload);
        contactResult.textContent = result.message;
        contactForm.reset();
      } catch (error) {
        contactResult.textContent = error.message;
      }
    });
  }
});

