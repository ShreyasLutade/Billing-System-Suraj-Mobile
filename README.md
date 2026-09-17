# Suraj Mobile Shop — Billing System

Production-ready billing web app for **Suraj Mobile Shop, Balaghat**.  
Works on desktop and mobile. Data is stored on the server so laptop and phone stay in sync.

## Hosting

| Branch | Hosting |
|--------|---------|
| `main` | **Railway** (current production — keep until free-stack is tested) |
| `deploy/gcp-cloudflare-free` | **Cloudflare Pages + GCP e2-micro + SQLite** (free stack) |

Full cutover guide: [`docs/FREE_STACK_MIGRATION.md`](docs/FREE_STACK_MIGRATION.md)

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
| Database | SQLite (`file:/data/suraj.db` in production) |
| Hosting (current) | Railway |
| Hosting (free branch) | Cloudflare Pages + Google Cloud Always Free e2-micro |

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
deploy/   GCP + Cloudflare free-stack configs (this branch)
```

## Shop details

Edit in `server/.env`:

- `SHOP_NAME`
- `SHOP_ADDRESS`
- `SHOP_PHONE`
- `SHOP_GSTIN`

## Automatic Excel + database email

Nightly Excel reports are emailed as a **full dump 3×/week** at **11:00 PM IST** on **Tuesday, Friday, and Sunday** (`REPORT_CRON`).  
Each send also attaches a **SQLite `.db` snapshot** (when `DATABASE_URL` is `file:...`) so you can restore the shop from email.

Admin UI: **/backup** — email Excel + `.db` now, or upload a `.db` to restore (overwrites live data; server restarts).

On the free-stack branch, a **daily SQLite `.db` email backup** also runs (`BACKUP_DB_CRON`).

### Resend HTTPS (Railway / any host)

1. Create a free account at https://resend.com  
2. Create an API key  
3. Set:

```env
REPORT_EMAIL_TO=surajmobile33556@gmail.com
RESEND_API_KEY=re_xxxxxxxx
REPORT_CRON=0 23 * * 0,2,5
REPORT_CRON_ENABLED=true
REPORT_CRON_SECRET=long-random-cron-secret
```

### Local / GCP: Gmail SMTP

```env
SMTP_USER=surajmobilereports@gmail.com
SMTP_PASS=your-gmail-app-password
REPORT_EMAIL_TO=surajmobile33556@gmail.com
SMTP_PORT=587
```

Admin can trigger manually: `POST /api/reports/send` with `{ "scope": "today" }` or `{ "scope": "all" }` (add `"force": true` to resend).  
SQLite file backup: `POST /api/reports/backup-db`.
