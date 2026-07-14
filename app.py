from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
import json
import os
import smtplib
from email.message import EmailMessage
from pathlib import Path

if os.environ.get('ALLOW_LEGACY_PYTHON_SERVER') != 'true':
    raise SystemExit('Legacy Python backend is disabled. Run npm start to use the supported Node.js server.')

ROOT = Path(__file__).resolve().parent
DATA_FILE = ROOT / 'users.json'
LOG_FILE = ROOT / 'activity.log'
CONFIG_FILE = ROOT / 'email_config.json'
PORT = int(os.environ.get('PORT', 3000))

if not DATA_FILE.exists():
    DATA_FILE.write_text('[]', encoding='utf-8')
if not LOG_FILE.exists():
    LOG_FILE.write_text('', encoding='utf-8')
if not CONFIG_FILE.exists():
    CONFIG_FILE.write_text('{"smtp_email":"","smtp_password":"","owner_email":""}', encoding='utf-8')


def read_users():
    try:
        return json.loads(DATA_FILE.read_text(encoding='utf-8'))
    except Exception:
        return []


def write_users(users):
    DATA_FILE.write_text(json.dumps(users, indent=2), encoding='utf-8')


def log_activity(message):
    with LOG_FILE.open('a', encoding='utf-8') as fh:
        fh.write(message + '\n')


def read_email_config():
    try:
        return json.loads(CONFIG_FILE.read_text(encoding='utf-8'))
    except Exception:
        return {"smtp_email": "", "smtp_password": "", "owner_email": ""}


def write_email_config(config):
    CONFIG_FILE.write_text(json.dumps(config, indent=2), encoding='utf-8')


def get_email_config():
    env_smtp = os.environ.get('SMTP_EMAIL')
    env_password = os.environ.get('SMTP_PASSWORD')
    env_owner = os.environ.get('OWNER_EMAIL')
    config = read_email_config()
    return {
        'smtp_email': env_smtp or config.get('smtp_email', ''),
        'smtp_password': env_password or config.get('smtp_password', ''),
        'owner_email': env_owner or config.get('owner_email', ''),
    }


def send_email_notification(subject, body):
    config = get_email_config()
    sender = config.get('smtp_email', '')
    password = config.get('smtp_password', '')
    receiver = config.get('owner_email', '')

    if not sender or not password or not receiver:
        log_activity(f'EMAIL_SKIPPED: {subject}')
        return False

    try:
        msg = EmailMessage()
        msg['Subject'] = subject
        msg['From'] = sender
        msg['To'] = receiver
        msg.set_content(body)

        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as smtp:
            smtp.login(sender, password)
            smtp.send_message(msg)
        log_activity(f'EMAIL_SENT: {subject}')
        return True
    except Exception as exc:
        log_activity(f'EMAIL_FAILED: {subject} - {exc}')
        return False


class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/users':
            users = read_users()
            self.send_json(200, {'users': [{'name': u['name'], 'email': u['email']} for u in users]})
            return

        if parsed.path == '/api/activity':
            lines = [line.strip() for line in LOG_FILE.read_text(encoding='utf-8').splitlines() if line.strip()]
            self.send_json(200, {'activity': lines[-10:]})
            return

        if parsed.path == '/api/email-status':
            config = get_email_config()
            self.send_json(200, {
                'configured': bool(config.get('smtp_email') and config.get('smtp_password') and config.get('owner_email')),
                'smtp_email': config.get('smtp_email', ''),
                'owner_email': config.get('owner_email', '')
            })
            return

        path = parsed.path
        if path == '/':
            path = '/index.html'
        file_path = (ROOT / path.lstrip('/')).resolve()
        if ROOT not in file_path.parents and file_path != ROOT:
            self.send_json(403, {'message': 'Forbidden'})
            return

        if file_path.is_file():
            content_type = 'text/html; charset=utf-8' if file_path.suffix == '.html' else 'application/octet-stream'
            if file_path.suffix == '.css':
                content_type = 'text/css; charset=utf-8'
            elif file_path.suffix == '.js':
                content_type = 'application/javascript; charset=utf-8'
            elif file_path.suffix == '.json':
                content_type = 'application/json; charset=utf-8'

            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.end_headers()
            with file_path.open('rb') as fh:
                self.wfile.write(fh.read())
        else:
            self.send_json(404, {'message': 'File not found'})

    def do_POST(self):
        parsed = urlparse(self.path)
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length).decode('utf-8') if length else '{}'

        if parsed.path == '/api/register':
            try:
                data = json.loads(body)
            except Exception:
                self.send_json(400, {'message': 'Invalid request data.'})
                return

            name = data.get('name', '').strip()
            email = data.get('email', '').strip()
            password = data.get('password', '')
            if not name or not email or not password:
                self.send_json(400, {'message': 'Please fill in all fields.'})
                return

            users = read_users()
            if any(u['email'].lower() == email.lower() for u in users):
                self.send_json(409, {'message': 'An account with this email already exists.'})
                return

            users.append({'name': name, 'email': email, 'password': password})
            write_users(users)
            log_activity(f"REGISTER: {name} ({email})")
            send_email_notification(
                'New Friends Gym Registration',
                f'A new client registered:\nName: {name}\nEmail: {email}'
            )
            self.send_json(201, {'message': 'Registration successful! You can log in now.', 'user': {'name': name, 'email': email}})
            return

        if parsed.path == '/api/login':
            try:
                data = json.loads(body)
            except Exception:
                self.send_json(400, {'message': 'Invalid request data.'})
                return

            email = data.get('email', '').strip()
            password = data.get('password', '')
            if not email or not password:
                self.send_json(400, {'message': 'Please enter your email and password.'})
                return

            users = read_users()
            user = next((u for u in users if u['email'].lower() == email.lower() and u['password'] == password), None)
            if not user:
                log_activity(f"FAILED_LOGIN: {email}")
                self.send_json(401, {'message': 'Invalid email or password.'})
                return

            log_activity(f"LOGIN: {user['name']} ({user['email']})")
            send_email_notification(
                'Friends Gym Login Alert',
                f'A client logged in:\nName: {user["name"]}\nEmail: {user["email"]}'
            )
            self.send_json(200, {'message': 'Login successful! Welcome back.', 'user': {'name': user['name'], 'email': user['email']}})
            return

        if parsed.path == '/api/save-email-config':
            try:
                data = json.loads(body)
            except Exception:
                self.send_json(400, {'message': 'Invalid request data.'})
                return

            config = {
                'smtp_email': (data.get('smtp_email') or '').strip(),
                'smtp_password': (data.get('smtp_password') or '').strip(),
                'owner_email': (data.get('owner_email') or '').strip(),
            }
            write_email_config(config)
            self.send_json(200, {'message': 'Email settings saved.', 'configured': bool(config['smtp_email'] and config['smtp_password'] and config['owner_email'])})
            return

        if parsed.path == '/api/test-email':
            success = send_email_notification(
                'Friends Gym Test Email',
                'This is a test email from your Friends Gym backend.'
            )
            if success:
                self.send_json(200, {'message': 'Test email sent successfully.'})
            else:
                self.send_json(400, {'message': 'Test email failed. Check your SMTP settings.'})
            return

        self.send_json(404, {'message': 'Not found'})

    def send_json(self, status_code, payload):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    server = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    print(f'Friends Gym backend running at http://localhost:{PORT}')
    server.serve_forever()
