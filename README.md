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

This project includes `render.yaml` and a `Dockerfile`. Copy `.env.example` to `.env` for local production configuration, or configure the same variables in the hosting dashboard.

```bash
npm start
```

Set the platform port with `PORT` if required. Set `DATA_DIR` to a persistent disk path. The app stores data in:

- `users.json`
- `bookings.json`
- `messages.json`
- `activity.log`

Passwords are stored with Node's `scrypt` hashing. Admin APIs require `ADMIN_TOKEN`.

Set `SMTP_EMAIL`, `SMTP_PASSWORD`, and `OWNER_EMAIL` to receive booking and contact alerts by email. For Gmail, use a Google App Password, not your normal Gmail password. Optional Telegram alerts still work with `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.

See `PLAY_STORE_DEPLOYMENT.md` for the publishing checklist.


## Razorpay Test Payments

1. Run `supabase/payment-integration.sql` in the Supabase SQL Editor.
2. Add `SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_KEY_ID`, and `RAZORPAY_KEY_SECRET` as secret server environment variables.
3. Use Razorpay Test Mode keys until the entire flow has been verified.
4. Enable automatic payment capture in Razorpay. Membership activation occurs only after server-side signature verification and a captured payment status check.

Never place the Razorpay key secret or Supabase service-role key in browser code, Git, or the APK.
