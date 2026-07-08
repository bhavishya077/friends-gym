# Friends Gym Publishing Checklist

## 1. Online hosting

1. Put this project in a private GitHub repository.
2. Create a Render Blueprint from the repository. `render.yaml` creates the web service and persistent disk.
3. Set `ALLOWED_ORIGIN` to the final HTTPS URL.
4. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` for owner alerts.
5. Open `/api/health` and confirm the response is `{"status":"ok"...}`.

The Render Starter plan is specified because bookings, users, and messages need a persistent disk. Do not use temporary filesystem storage for real customer data.

## 2. Telegram notifications

1. Open Telegram and create a bot with `@BotFather`.
2. Send one message to the new bot.
3. Obtain the bot token and your chat ID, then add both values to the hosting environment.
4. Submit one test booking and one contact message.

Never commit the bot token or `ADMIN_TOKEN` to Git.

## 3. Play Store Android package

The recommended package is a Trusted Web Activity because it opens the hosted PWA, stays full-screen, and receives website updates without rebuilding the Android app for every content change.

Required before generating the signed AAB:

- Final HTTPS app URL and domain
- Android package name, suggested: `com.friendsgym.app`
- App name and support email
- 512 x 512 PNG app icon
- Google Play Console developer account
- Private signing keystore with secure backup
- Digital Asset Links file hosted at `/.well-known/assetlinks.json`

Generate the Android project with Bubblewrap after the final URL exists, test it on a physical Android phone, then upload the signed release `.aab` to Play Console internal testing.

## 4. Play Console listing

- App category: Health & Fitness
- Privacy policy hosted on a public HTTPS page
- Data safety declaration for account, phone, email, fitness, and message data
- App access instructions for reviewer login
- Content rating questionnaire
- Store icon, feature graphic, phone screenshots, short description, and full description
- Closed testing requirements applicable to the Play Console account

Publishing cannot be completed without access to the hosting account, domain, Telegram credentials, Play Console account, and signing key. Keep all secrets outside the repository.
