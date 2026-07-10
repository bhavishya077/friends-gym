const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
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
  const key = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const recent = (rateLimits.get(key) || []).filter(time => now - time < 60000);
  recent.push(now);
  rateLimits.set(key, recent);
  return recent.length > 40;
}

function isAdmin(req) {
  const token = req.headers.authorization || '';
  return Boolean(ADMIN_TOKEN) && token === `Bearer ${ADMIN_TOKEN}`;
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
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      callback(null, JSON.parse(body || '{}'));
    } catch {
      callback(new Error('Invalid request data.'));
    }
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
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
    default: return 'application/octet-stream';
  }
}

function serveStatic(req, res) {
  let requestedPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  if (requestedPath === '/') requestedPath = '/index.html';

  const safePath = path.normalize(requestedPath).replace(/^([.][.]([/\\]|$))+/, '');
  const fullPath = path.join(ROOT, safePath);

  if (!fullPath.startsWith(ROOT)) {
    sendJson(res, 403, { message: 'Forbidden' });
    return;
  }

  fs.stat(fullPath, (err, stats) => {
    if (err || !stats.isFile()) {
      const appRoutes = new Set(['/workout', '/nutrition', '/classes', '/membership', '/tools', '/auth', '/contact']);
      if (req.method === 'GET' && appRoutes.has(requestedPath)) {
        res.writeHead(200, { 'Content-Type': getContentType(path.join(ROOT, 'index.html')) });
        fs.createReadStream(path.join(ROOT, 'index.html')).pipe(res);
        return;
      }
      sendJson(res, 404, { message: 'File not found' });
      return;
    }

    res.writeHead(200, { 'Content-Type': getContentType(fullPath) });
    fs.createReadStream(fullPath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host}`);

  if (reqUrl.pathname.startsWith('/api/') && isRateLimited(req)) {
    sendJson(res, 429, { message: 'Too many requests. Please try again shortly.' });
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/health') {
    sendJson(res, 200, { status: 'ok', service: 'friends-gym' });
    return;
  }

  if (req.method === 'POST' && reqUrl.pathname === '/api/register') {
    readBody(req, async (error, data) => {
      try {
        if (error) throw error;
        const { name, email, password } = data;
        if (!name || !email || !password) {
          sendJson(res, 400, { message: 'Please fill in all fields.' });
          return;
        }

        const users = readUsers();
        const exists = users.some(user => user.email.toLowerCase() === email.toLowerCase());
        if (exists) {
          sendJson(res, 409, { message: 'An account with this email already exists.' });
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
        const { email, password } = data;
        if (!email || !password) {
          sendJson(res, 400, { message: 'Please enter your email and password.' });
          return;
        }

        const users = readUsers();
        const user = users.find(item => item.email.toLowerCase() === email.toLowerCase());
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
        if (!name || !phone || !plan) {
          sendJson(res, 400, { message: 'Please enter your name, phone, and plan.' });
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
        if (!name || !email || !message) {
          sendJson(res, 400, { message: 'Please complete all contact fields.' });
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
