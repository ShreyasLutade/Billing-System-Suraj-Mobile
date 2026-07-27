# Suraj Mobile Shop — Billing System

Production-ready billing web app for **Suraj Mobile Shop, Balaghat**.  
Works on desktop and mobile. Data is stored on the server so laptop and phone stay in sync.

## Features (v1)

- Manual bill creation (product name, price, GST, IMEI, warranty typed by hand)
- Payment split: **Cash / Online / Finance**
- Auto **Due** when paid amount is less than grand total + expected collection date
- Invoice PDF download
- Analytics: today’s sale, cash, online, finance, dues, outstanding
- Responsive UI (desktop + mobile)

## Tech stack

| Layer | Technology |
|-------|------------|
| Frontend | React + TypeScript + Vite + Tailwind + Framer Motion |
| Backend | Node.js + Express + TypeScript |
| Database | SQLite (local) → PostgreSQL on Railway (production) |
| Hosting | Railway Hobby (~₹420/month) |

## Quick start

### Requirements

- Node.js 18+ (20+ recommended)
- npm 9+

### 1. Install & run API

```bash
cd server
npm install
npx prisma generate
npx prisma db push
npm run dev
```

API: `http://localhost:4000`

### 2. Install & run UI

```bash
cd client
npm install
npm run dev
```

App: `http://localhost:5173`

### Environment

Copy `server/.env.example` to `server/.env` (already set for local SQLite).

Optional client env (`client/.env`):

```
VITE_API_URL=http://localhost:4000/api
```

## Project structure

```
client/   React UI
server/   Express API + Prisma
```

## Railway deploy (later)

1. Create Railway account (Hobby plan)
2. Add PostgreSQL plugin
3. Change Prisma datasource provider to `postgresql`
4. Set `DATABASE_URL` from Railway
5. Deploy `server` + serve `client` build (or host client on Railway static)

## Shop details

Edit in `server/.env`:

- `SHOP_NAME`
- `SHOP_ADDRESS`
- `SHOP_PHONE`
- `SHOP_GSTIN`

## Automatic Excel email (Gmail SMTP)

Nightly Excel reports are emailed at **11:00 PM IST** (`REPORT_CRON`). Sundays also send a full backup.

```env
SMTP_USER=surajmobilereports@gmail.com
SMTP_PASS=your-gmail-app-password
REPORT_EMAIL_TO=surajmobile33556@gmail.com
SMTP_PORT=587
REPORT_CRON=0 23 * * *
REPORT_CRON_ENABLED=true
REPORT_CRON_SECRET=long-random-cron-secret
```

Admin can also trigger manually: `POST /api/reports/send` with `{ "scope": "today" }` or `{ "scope": "all" }` (add `"force": true` to resend the same day).

### Railway notes

In-process `node-cron` can miss the window if the service restarts around 11 PM. The app also:

1. Prefers **SMTP port 587** in production (Railway often blocks 465)
2. Verifies SMTP on boot (check deploy logs for `[reports] SMTP verified`)
3. Catches up the same IST day if the cron time already passed and mail was not sent
4. Exposes `POST /api/reports/cron/run` for a **Railway Cron Job** (recommended)

Railway Variables to set: `SMTP_USER`, `SMTP_PASS`, `REPORT_EMAIL_TO`, `SMTP_PORT=587`, `REPORT_CRON_SECRET`.

Railway Cron Job example:

- Schedule: `30 17 * * *` (17:30 UTC ≈ 23:00 IST) — or use Asia/Kolkata if your cron UI supports timezones
- Request: `POST https://YOUR_APP.up.railway.app/api/reports/cron/run`
- Header: `Authorization: Bearer <REPORT_CRON_SECRET>`
