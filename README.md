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

## Automatic Excel + database email

Nightly Excel reports are emailed as a **full dump every day** at **11:00 PM IST** (`REPORT_CRON`; only its minute and hour are used).  
Each send also attaches a **SQLite `.db` snapshot** (when `DATABASE_URL` is `file:...`) so you can restore the shop from email.

Admin UI: **/backup** — email Excel + `.db` now, or upload a `.db` to restore (overwrites live data; server restarts).

### Railway (recommended): Resend HTTPS

Railway typically **blocks outbound SMTP** (ports 465/587 time out). Use [Resend](https://resend.com) over HTTPS instead:

1. Create a free account at https://resend.com  
2. Create an API key  
3. Set Railway variables:

```env
REPORT_EMAIL_TO=surajmobile33556@gmail.com
RESEND_API_KEY=re_xxxxxxxx
REPORT_CRON=0 23 * * *
REPORT_CRON_ENABLED=true
REPORT_CRON_SECRET=long-random-cron-secret
```

Optional: `RESEND_FROM="Suraj Mobile Reports <onboarding@resend.dev>"`  
(After you verify your own domain in Resend, use that address as `RESEND_FROM`.)

### Local: Gmail SMTP

On your PC, Gmail SMTP still works:

```env
SMTP_USER=surajmobilereports@gmail.com
SMTP_PASS=your-gmail-app-password
REPORT_EMAIL_TO=surajmobile33556@gmail.com
SMTP_PORT=587
```

Admin can trigger manually: `POST /api/reports/send` with `{ "scope": "today" }` or `{ "scope": "all" }` (add `"force": true` to resend).

### Railway Cron Job (optional but reliable)

- Schedule: `0 23 * * *` Asia/Kolkata (daily 11:00 PM IST), or `30 17 * * *` UTC  
- `POST https://YOUR_APP.up.railway.app/api/reports/cron/run`  
- Header: `Authorization: Bearer <REPORT_CRON_SECRET>`

## Accessories shop (testing)

A separate counter at **/acc** ("Switch shop" → Accessories shop), with its own
catalogue, stock, sales, wholesale customers, dues and suppliers (`Acc*` tables;
the mobile shop's data is untouched).

- **Counter**: favourite (★) products as tiles: category → type or brand → product.
  Tap a product, tap a price, Sell (Cash/UPI). Cart for several items, Undo after a sale.
- **Wholesale**: customer (name, phone, shop, city, address, group), bulk quantities
  (+10/+50/+100), paid now / due, promised date, bill PDF and WhatsApp.
- **Stock**: add products for many phone models at once, add stock from suppliers,
  count corrections and history. **Dues** by group with ageing, payments, statements.
- PDFs on Stock, Sales, Dues (group-wise), customer statement, Suppliers and Analytics.

Every admin of the Babu shop can open it (repair-shop logins cannot). To let staff logins
in too, list them in `ACCESSORIES_SHOP_PHONES="7038006342,7581817575"` on the server.
