# Friends Gym Mobile App

Installable mobile-first PWA for Friends Gym. It includes BMI and calorie tools, diet planning, workout tracking, login/register, callback bookings, contact messages, an offline app shell, and a lightweight JSON-backed Node API.

## Run Locally

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

Protected admin data view:

```text
http://localhost:3000/view-data.html
```

Enter the `ADMIN_TOKEN` configured on the server to load member, booking, message, and activity data.

## Production Deploy

This project has no external npm dependencies. It includes `render.yaml` and a `Dockerfile`. Copy `.env.example` to `.env` for local production configuration, or configure the same variables in the hosting dashboard.

```bash
npm start
```

Set the platform port with `PORT` if required. Set `DATA_DIR` to a persistent disk path. The app stores data in:

- `users.json`
- `bookings.json`
- `messages.json`
- `activity.log`

Passwords are stored with Node's `scrypt` hashing. Admin APIs require `ADMIN_TOKEN`. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` to receive instant booking and contact alerts.

See `PLAY_STORE_DEPLOYMENT.md` for the publishing checklist.
