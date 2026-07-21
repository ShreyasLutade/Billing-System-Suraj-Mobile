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

Every day at **11:00 PM IST** the server emails an Excel file:

- **Daily:** today's bills only
- **Sunday:** today's file + full backup (all bills up to date)

Set these on Railway (and local `.env`):

```
SMTP_USER=surajmobilereports@gmail.com
SMTP_PASS=your-gmail-app-password
REPORT_EMAIL_TO=surajmobile33556@gmail.com
REPORT_CRON=0 23 * * *
REPORT_CRON_ENABLED=true
```

Admin can also trigger manually: `POST /api/reports/send` with `{ "scope": "today" }` or `{ "scope": "all" }`.
