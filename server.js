const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
function loadLocalEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadLocalEnv();
let nodemailer = null;

try {
  nodemailer = require('nodemailer');
} catch {
  nodemailer = null;
}

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
function resolveDataDir() {
  const candidates = [
    process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : null,
    path.join('/tmp', 'friends-gym-data'),
    ROOT
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      fs.mkdirSync(candidate, { recursive: true });
      fs.accessSync(candidate, fs.constants.W_OK);
      return candidate;
    } catch {
      // Try the next candidate so the app can still boot on read-only hosts.
    }
  }

  return ROOT;
}

const DATA_DIR = resolveDataDir();
const DATA_FILE = path.join(DATA_DIR, 'users.json');
const BOOKINGS_FILE = path.join(DATA_DIR, 'bookings.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const ACTIVITY_FILE = path.join(DATA_DIR, 'activity.log');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const ALLOWED_ORIGIN = String(process.env.ALLOWED_ORIGIN || '').trim();
const MAX_BODY_BYTES = 64 * 1024;
const rateLimits = new Map();

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, '[]', 'utf8');
}
if (!fs.existsSync(BOOKINGS_FILE)) {
  fs.writeFileSync(BOOKINGS_FILE, '[]', 'utf8');
}
if (!fs.existsSync(MESSAGES_FILE)) {
  fs.writeFileSync(MESSAGES_FILE, '[]', 'utf8');
}
if (!fs.existsSync(ACTIVITY_FILE)) {
  fs.writeFileSync(ACTIVITY_FILE, '', 'utf8');
}

function readJsonArray(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeJsonArray(filePath, items) {
  fs.writeFileSync(filePath, JSON.stringify(items, null, 2), 'utf8');
}

function readUsers() {
  return readJsonArray(DATA_FILE);
}

function writeUsers(users) {
  writeJsonArray(DATA_FILE, users);
}

function logActivity(message) {
  fs.appendFileSync(ACTIVITY_FILE, `${new Date().toISOString()} ${message}\n`, 'utf8');
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored.includes(':')) return password === stored;
  const [salt, storedHash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(storedHash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function isRateLimited(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const key = forwarded || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const recent = (rateLimits.get(key) || []).filter(time => now - time < 60000);
  recent.push(now);
  rateLimits.set(key, recent);
  if (rateLimits.size > 5000) {
    for (const [entryKey, times] of rateLimits) {
      if (!times.some(time => now - time < 60000)) rateLimits.delete(entryKey);
    }
  }
  const sensitiveWrite = req.method === 'POST' && ['/api/bookings', '/api/contact'].includes(new URL(req.url, 'http://localhost').pathname);
  return recent.length > (sensitiveWrite ? 10 : 30);
}

function isAdmin(req) {
  if (!ADMIN_TOKEN) return false;
  const supplied = Buffer.from(String(req.headers.authorization || ''));
  const expected = Buffer.from(`Bearer ${ADMIN_TOKEN}`);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

async function sendOwnerEmail(subject, text) {
  const smtpEmail = String(process.env.SMTP_EMAIL || '').trim();
  const smtpPassword = String(process.env.SMTP_PASSWORD || '').replace(/\s+/g, '');
  const ownerEmail = String(process.env.OWNER_EMAIL || smtpEmail).trim();

  if (!nodemailer) {
    logActivity('EMAIL_NOTIFICATION_SKIPPED nodemailer_not_installed');
    return { sent: false, reason: 'email package is not installed' };
  }

  if (!smtpEmail || !smtpPassword || !ownerEmail) {
    logActivity('EMAIL_NOTIFICATION_SKIPPED missing_smtp_env');
    return { sent: false, reason: 'email environment variables are missing' };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 465),
    secure: process.env.SMTP_SECURE !== 'false',
    auth: {
      user: smtpEmail,
      pass: smtpPassword
    }
  });

  try {
    await transporter.sendMail({
      from: `"Friends Gym" <${smtpEmail}>`,
      to: ownerEmail,
      subject,
      text
    });
    logActivity(`EMAIL_NOTIFICATION_SENT ${ownerEmail}`);
    return { sent: true };
  } catch (error) {
    logActivity(`EMAIL_NOTIFICATION_FAILED ${error.message}`);
    return { sent: false, reason: 'email provider rejected the message' };
  }
}

async function notifyOwner(subject, text) {
  const emailResult = await sendOwnerEmail(subject, text);

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId || typeof fetch !== 'function') return emailResult;

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: `${subject}\n${text}` })
    });
  } catch (error) {
    logActivity(`TELEGRAM_NOTIFICATION_FAILED ${error.message}`);
  }

  return emailResult;
}

function readBody(req, callback) {
  let body = '';
  let bytes = 0;
  let finished = false;
  const finish = (error, value) => {
    if (finished) return;
    finished = true;
    callback(error, value);
  };
  req.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      finish(new Error('Request body is too large.'));
      req.pause();
      return;
    }
    body += chunk;
  });
  req.on('end', () => {
    if (finished) return;
    try {
      finish(null, JSON.parse(body || '{}'));
    } catch {
      finish(new Error('Invalid request data.'));
    }
  });
  req.on('error', () => finish(new Error('Unable to read request data.')));
}

function setSecurityHeaders(res) {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; media-src 'self' blob:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), accelerometer=(self), gyroscope=(self)');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
}

function requestOriginAllowed(req) {
  const origin = String(req.headers.origin || '');
  if (!origin) return true;
  if (origin === 'http://localhost' || origin === 'capacitor://localhost') return true;
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || (req.socket.encrypted ? 'https' : 'http');
  const sameOrigin = `${protocol}://${req.headers.host}`;
  return origin === sameOrigin || (ALLOWED_ORIGIN && origin === ALLOWED_ORIGIN);
}
function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  });
  res.end(JSON.stringify(payload));
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.webmanifest': return 'application/manifest+json; charset=utf-8';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.png': return 'image/png';
    case '.svg': return 'image/svg+xml';
    case '.mp4': return 'video/mp4';
    default: return 'application/octet-stream';
  }
}

const APP_ROUTES = new Set(['/', '/workout', '/nutrition', '/classes', '/membership', '/tools', '/auth', '/profile', '/contact']);
const PUBLIC_FILES = new Set([
  '/index.html', '/style.css', '/script.js', '/supabase.min.js', '/supabase-config.js', '/manifest.webmanifest', '/service-worker.js',
  '/admin.html', '/admin.css', '/admin.js', '/about.html', '/contact.html', '/pricing.html', '/programs.html',
  '/pexels-arturo-eg-22214041-6628962.jpg', '/pexels-warrecreates-32233887.jpg'
]);
const PUBLIC_PREFIXES = ['/assets/', '/icons/'];

function serveFile(res, filePath, cacheControl = 'no-store') {
  res.setHeader('Content-Type', getContentType(filePath));
  res.setHeader('Cache-Control', cacheControl);
  res.statusCode = 200;
  fs.createReadStream(filePath).pipe(res);
}

function serveStatic(req, res) {
  let requestedPath;
  try {
    requestedPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  } catch {
    return sendJson(res, 400, { message: 'Invalid URL' });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { message: 'Method not allowed' });
  }
  if (APP_ROUTES.has(requestedPath)) {
    return serveFile(res, path.join(ROOT, 'index.html'), 'no-store');
  }
  if (requestedPath === '/admin') {
    return serveFile(res, path.join(ROOT, 'admin.html'), 'no-store');
  }

  const isPublic = PUBLIC_FILES.has(requestedPath) || PUBLIC_PREFIXES.some(prefix => requestedPath.startsWith(prefix));
  if (!isPublic || requestedPath.includes('..') || requestedPath.includes('\\')) {
    return sendJson(res, 404, { message: 'File not found' });
  }

  const relativePath = requestedPath.replace(/^\/+/, '');
  const fullPath = path.resolve(ROOT, relativePath);
  const rootPrefix = `${path.resolve(ROOT)}${path.sep}`;
  if (!fullPath.startsWith(rootPrefix)) return sendJson(res, 403, { message: 'Forbidden' });

  fs.stat(fullPath, (error, stats) => {
    if (error || !stats.isFile()) return sendJson(res, 404, { message: 'File not found' });
    const longCache = requestedPath.startsWith('/assets/') || requestedPath.startsWith('/icons/') || /\.(jpg|jpeg|png|svg|mp4)$/i.test(requestedPath);
    serveFile(res, fullPath, longCache ? 'public, max-age=604800' : 'public, max-age=3600');
  });
}
const server = http.createServer((req, res) => {
  setSecurityHeaders(res);
  if (!requestOriginAllowed(req)) return sendJson(res, 403, { message: 'Origin not allowed' });
  const requestOrigin = String(req.headers.origin || '');
  if (requestOrigin) res.setHeader('Access-Control-Allow-Origin', requestOrigin);
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host}`);

  if (reqUrl.pathname.startsWith('/api/') && isRateLimited(req)) {
    sendJson(res, 429, { message: 'Too many requests. Please try again shortly.' });
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/config') {
    sendJson(res, 200, {
      supabaseUrl: process.env.SUPABASE_URL || '',
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || ''
    });
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/health') {
    sendJson(res, 200, { status: 'ok', service: 'friends-gym' });
    return;
  }

  if (req.method === 'POST' && ['/api/register', '/api/login'].includes(reqUrl.pathname)) {
    sendJson(res, 410, { message: 'Legacy login is disabled. Use secure Supabase authentication.' });
    return;
  }
  if (req.method === 'POST' && reqUrl.pathname === '/api/register') {
    readBody(req, async (error, data) => {
      try {
        if (error) throw error;
        const name = String(data.name || '').trim();
        const email = String(data.email || '').trim().toLowerCase();
        const password = String(data.password || '');
        if (!name || !email || !password) {
          sendJson(res, 400, { message: 'Please fill in all fields.' });
          return;
        }

        const users = readUsers();
        const exists = users.some(user => String(user.email || '').toLowerCase() === email);
        if (exists) {
          sendJson(res, 409, { message: 'An account with this email already exists.' });
          return;
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          sendJson(res, 400, { message: 'Please enter a valid email address.' });
          return;
        }

        if (password.length < 8 || password.length > 128) {
          sendJson(res, 400, { message: 'Password must be between 8 and 128 characters.' });
          return;
        }

        users.push({ name, email, password: hashPassword(password), createdAt: new Date().toISOString() });
        writeUsers(users);
        logActivity(`REGISTER ${name} (${email})`);
        sendJson(res, 201, { message: 'Registration successful! You can log in now.', user: { name, email } });
      } catch {
        sendJson(res, 400, { message: 'Invalid request data.' });
      }
    });
    return;
  }

  if (req.method === 'POST' && reqUrl.pathname === '/api/login') {
    readBody(req, async (error, data) => {
      try {
        if (error) throw error;
        const email = String(data.email || '').trim().toLowerCase();
        const password = String(data.password || '');
        if (!email || !password) {
          sendJson(res, 400, { message: 'Please enter your email and password.' });
          return;
        }

        const users = readUsers();
        const user = users.find(item => String(item.email || '').toLowerCase() === email);
        if (!user || !verifyPassword(password, user.password)) {
          logActivity(`FAILED_LOGIN ${email}`);
          sendJson(res, 401, { message: 'Invalid email or password.' });
          return;
        }

        if (!user.password.includes(':')) {
          user.password = hashPassword(password);
          writeUsers(users);
        }

        logActivity(`LOGIN ${user.name} (${user.email})`);
        sendJson(res, 200, { message: 'Login successful! Welcome back.', user: { name: user.name, email: user.email } });
      } catch {
        sendJson(res, 400, { message: 'Invalid request data.' });
      }
    });
    return;
  }

  if (req.method === 'POST' && reqUrl.pathname === '/api/bookings') {
    readBody(req, async (error, data) => {
      try {
        if (error) throw error;
        const name = String(data.name || '').trim();
        const phone = String(data.phone || '').trim();
        const plan = String(data.plan || '').trim();
        const allowedPlans = new Set(['Drop-In', 'Standard', 'All-In']);
        if (!name || name.length > 80 || !/^[0-9+() -]{7,20}$/.test(phone) || !allowedPlans.has(plan)) {
          sendJson(res, 400, { message: 'Please enter valid booking details.' });
          return;
        }

        const bookings = readJsonArray(BOOKINGS_FILE);
        const booking = { id: Date.now(), name, phone, plan, createdAt: new Date().toISOString() };
        bookings.unshift(booking);
        writeJsonArray(BOOKINGS_FILE, bookings);
        logActivity(`BOOKING ${name} (${phone}) - ${plan}`);
        const notification = await notifyOwner(
          'New Friends Gym booking',
          `Name: ${name}\nPhone: ${phone}\nPlan: ${plan}`
        );
        sendJson(res, 201, {
          message: notification?.sent
            ? 'Callback request saved. Email notification sent.'
            : 'Callback request saved. Email notification not sent. Check Render email settings.',
          booking,
          notification
        });
      } catch {
        sendJson(res, 400, { message: 'Invalid request data.' });
      }
    });
    return;
  }

  if (req.method === 'POST' && reqUrl.pathname === '/api/contact') {
    readBody(req, async (error, data) => {
      try {
        if (error) throw error;
        const name = String(data.name || '').trim();
        const email = String(data.email || '').trim();
        const message = String(data.message || '').trim();
        const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        if (!name || name.length > 80 || !validEmail || email.length > 320 || !message || message.length > 2000) {
          sendJson(res, 400, { message: 'Please enter valid contact details.' });
          return;
        }

        const messages = readJsonArray(MESSAGES_FILE);
        const contact = { id: Date.now(), name, email, message, createdAt: new Date().toISOString() };
        messages.unshift(contact);
        writeJsonArray(MESSAGES_FILE, messages);
        logActivity(`CONTACT ${name} (${email})`);
        const notification = await notifyOwner(
          'New Friends Gym message',
          `Name: ${name}\nEmail: ${email}\nMessage: ${message}`
        );
        sendJson(res, 201, {
          message: notification?.sent
            ? 'Message saved. Email notification sent.'
            : 'Message saved. Email notification not sent. Check Render email settings.',
          contact,
          notification
        });
      } catch {
        sendJson(res, 400, { message: 'Invalid request data.' });
      }
    });
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/users') {
    if (!isAdmin(req)) return sendJson(res, 401, { message: 'Admin authorization required.' });
    sendJson(res, 200, { users: readUsers().map(user => ({ name: user.name, email: user.email })) });
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/bookings') {
    if (!isAdmin(req)) return sendJson(res, 401, { message: 'Admin authorization required.' });
    sendJson(res, 200, { bookings: readJsonArray(BOOKINGS_FILE) });
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/messages') {
    if (!isAdmin(req)) return sendJson(res, 401, { message: 'Admin authorization required.' });
    sendJson(res, 200, { messages: readJsonArray(MESSAGES_FILE) });
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/activity') {
    if (!isAdmin(req)) return sendJson(res, 401, { message: 'Admin authorization required.' });
    const activity = fs.readFileSync(ACTIVITY_FILE, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-30)
      .reverse();
    sendJson(res, 200, { activity });
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Friends Gym backend running at http://localhost:${PORT}`);
});
