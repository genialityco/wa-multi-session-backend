# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install       # install deps (requires Node 20.x, and Google Chrome for the Puppeteer/whatsapp-web.js path)
npm start          # run the server (node server.js) — no dev/watch script defined
```

There is no build step, linter, or test suite configured in this repo. `npm run dev` mentioned in README does not exist as a script — use `npm start` (or `node server.js` directly, `nodemon` if you want auto-reload).

Local `.env` requires at minimum `MONGO_URI` and `PORT`. `WEBHOOK_VERIFY_TOKEN` is optional (defaults to `mi_token_secreto`) and used for the Meta webhook GET verification handshake.

Production runs via PM2 behind Caddy (see [DEPLOYMENT.md](DEPLOYMENT.md) for the full droplet setup/restart/log commands).

## Architecture

This is a single Express + Socket.IO app (`server.js`) that bridges **two entirely separate WhatsApp integrations**. They don't share code paths — know which one an endpoint belongs to before touching it:

1. **whatsapp-web.js (unofficial, browser-automation) path** — [sessions/sessionManager.js](sessions/sessionManager.js)
   - Drives a real WhatsApp Web session per `clientId` via Puppeteer/Chrome, authenticated by scanning a QR code.
   - Session credentials persist to MongoDB via `RemoteAuth` + `wwebjs-mongo`'s `MongoStore` (uses a `mongoose` connection), so sessions survive restarts.
   - Active clients live in the in-memory `clients` map (`sessions/sessionManager.js`). QR codes and connection status are pushed to the frontend over Socket.IO rooms keyed by `clientId` (`socket.join(clientId)`, events: `qr`, `status`, `session_cleaned`).
   - Endpoints: `POST /api/session` (create/reuse a session), `POST /api/send` (text or image via `MessageMedia`), `POST /api/logout`, `GET /api/sessions`.

2. **WhatsApp Cloud API (official Meta Graph API) path** — [services/whatsappApi.js](services/whatsappApi.js)
   - Talks directly to `graph.facebook.com` with a per-account `phoneNumberId` + `accessToken`, used for sending pre-approved message *templates* (meeting requests/confirmations/cancellations/rejections, welcome messages, projection/result notifications).
   - Accounts are registered via `POST /api/account/register` and held **only in the in-memory `accounts` object** in `services/whatsappApi.js` — nothing is persisted to Mongo, so registered accounts are lost on every restart/redeploy and must be re-registered by the caller.
   - Sending template messages with dynamic image headers requires uploading the image to Meta first via `uploadMedia()` to get a `media.id`, then referencing that id in the template's header component.
   - Inbound messages/status callbacks from Meta land on `GET/POST /webhook` in `server.js` (GET does the `hub.verify_token` handshake; POST dispatches text messages to `services/webhookHandler.js` and failed-delivery statuses to the email fallback system).

### Email fallback system ([services/emailFallback.js](services/emailFallback.js))

Only applies to the **Cloud API** path (`/api/send-*` template endpoints), not the whatsapp-web.js path. Callers can optionally pass `fallbackEmail`/`fallbackSubject`/`fallbackHtml` (+ optional `fallbackFromName`/`fallbackFromEmail`/`fallbackCc`/`fallbackBcc`) in the request body:
- On a **synchronous** send failure (the Graph API call itself throws), `tryEmailFallback()` fires immediately.
- On a **successful** send, `registerFallbackForMessage(msgId, reqBody)` stashes the fallback payload in an in-memory `Map` keyed by Meta's message id (auto-expires after 24h). If Meta's webhook later reports that message as `status: 'failed'`, `triggerFallbackFromWebhook()` looks it up and sends the email then.
- Emails are actually sent by POSTing to an external service at `apigencampus.geniality.com.co/email/custom` (not part of this repo).

### Data layer

Two independent Mongo connections exist side by side — don't assume they're unified:
- [db/mongo.js](db/mongo.js) opens a raw `MongoClient` and is only used once at startup in `server.js` to confirm connectivity/log; nothing else queries through it.
- `mongoose` (connected lazily in `sessions/sessionManager.js` on first session creation, using the same `MONGO_URI`) backs both the `wwebjs-mongo` `MongoStore` (session auth blobs) and the `Confirmation` model ([models/Confirmation.js](models/Confirmation.js)), which `services/webhookHandler.js` uses to match an inbound "sí/no" WhatsApp reply to the most recent pending confirmation for that phone number.

### Conventions worth knowing

- All phone numbers passed to Cloud API endpoints are normalized with `String(to).replace(/[^0-9]/g, '').replace(/^0+/, '')` and validated to be 10–15 digits before sending.
- Route handlers in `server.js` are long and largely follow one pattern per Cloud API template endpoint: validate required body fields → look up `accountId` via `getAccount()` → clean phone → build the Meta `template` payload (body/header/button components) → `sendTemplateWithButtons()` or `sendTemplateWithParams()` → on success `registerFallbackForMessage()`, on failure `tryEmailFallback()`.
- ES modules throughout (`"type": "module"` in package.json) — use `import`/`export`, not `require`.
