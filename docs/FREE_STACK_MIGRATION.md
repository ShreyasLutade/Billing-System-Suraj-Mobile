# Free-stack migration — Cloudflare Pages + Google Cloud e2-micro + SQLite

This branch (`deploy/gcp-cloudflare-free`) adds a production-ready free hosting
path. **`main` stays on Railway** until you finish testing and cut over.

| Layer | Target | Cost |
|-------|--------|------|
| Frontend | Cloudflare Pages | Free |
| Backend | GCP Compute Engine **e2-micro** + Docker | Always Free* |
| Database | SQLite at `/data/suraj.db` on the VM disk | Free |
| SSL / DNS | Cloudflare (proxy) | Free |
| Backups | Excel reports + daily `.db` email | Free |

\*Always Free e2-micro is limited to certain regions (`us-west1`, `us-central1`,
`us-east1`) and one instance per billing account. Confirm current Google Cloud
Always Free terms for your account.

---

## Auto-deploy (GitHub Actions)

Pushes to this branch can update the VM automatically.

See [`deploy/gcp/AUTO_DEPLOY.md`](../deploy/gcp/AUTO_DEPLOY.md) for SSH key + GitHub secrets setup.

---

## What you need to create / provide

### 1) Accounts
1. **Google Cloud** account with billing enabled (Always Free still needs a billing account on file).
2. **Cloudflare** account (free plan) — domain recommended.
3. **GitHub** (already used) so Pages can build from this branch.
4. Email sender already in use:
   - **Resend** API key (works everywhere), **or**
   - Gmail App Password for SMTP (usually works from GCP; often blocked on Railway).

### 2) Details to fill in `deploy/gcp/.env`
Share/set these when you are ready (do not paste secrets into chat if avoidable):

- Domain names you want, e.g. `billing.yourdomain.com` + `api.yourdomain.com`
- `JWT_SECRET` (long random)
- `REPORT_CRON_SECRET` (long random)
- `REPORT_EMAIL_TO`
- `RESEND_API_KEY` and/or Gmail SMTP app password
- Shop fields (already in Railway env — copy them)

### 3) Optional from you later
- Cloudflare Origin Certificate files for Full (strict) SSL
- Preference: keep using Resend vs switch to Gmail SMTP on GCP

---

## Target architecture

```
Phone / Laptop
    │
    ├─ https://billing.yourdomain.com  → Cloudflare Pages (React build)
    │                                      VITE_API_URL=https://api.yourdomain.com/api
    │
    └─ https://api.yourdomain.com      → Cloudflare proxy → GCP e2-micro :80
                                            Caddy → Docker API :4000
                                            SQLite volume → /data/suraj.db
```

Railway monolith (`Dockerfile` at repo root) is unchanged and still used by `main`.

---

## Step-by-step (you do this; I can help remotely)

### A. Google Cloud VM
1. Console → **Compute Engine** → Create instance  
2. Machine: **e2-micro**  
3. Region: **us-west1 / us-central1 / us-east1** (Always Free)  
4. Boot disk: Debian 12 or Ubuntu LTS, **20–30 GB** SSD (SQLite + images + Docker)  
5. Firewall: allow **HTTP** and **HTTPS** (and SSH)  
6. Reserve a **static external IP** (free while attached)  
7. SSH in and run:

```bash
export REPO_URL="https://github.com/ShreyasLutade/Billing-System-Suraj-Mobile.git"
export BRANCH="deploy/gcp-cloudflare-free"
curl -fsSL https://raw.githubusercontent.com/ShreyasLutade/Billing-System-Suraj-Mobile/deploy/gcp-cloudflare-free/deploy/gcp/scripts/bootstrap-vm.sh | bash
# or clone first, then: bash deploy/gcp/scripts/bootstrap-vm.sh
```

8. Edit `~/Billing-System-Suraj-Mobile/deploy/gcp/.env`  
9. Start:

```bash
cd ~/Billing-System-Suraj-Mobile
docker compose -f deploy/gcp/docker-compose.yml --env-file deploy/gcp/.env up -d --build
curl -fsS http://127.0.0.1/api/health
```

### B. Cloudflare DNS + SSL
1. Add domain to Cloudflare (free)  
2. DNS:
   - `api` → A → VM static IP (**Proxied** orange cloud)  
   - `billing` → CNAME → your Pages site (**Proxied**)  
3. SSL/TLS mode:
   - Start with **Flexible** (works with default `Caddyfile` on :80)  
   - Later upgrade to **Full (strict)** using Origin CA + `Caddyfile.full`

### C. Cloudflare Pages (frontend)
1. Workers & Pages → Create → Connect GitHub repo  
2. Branch: `deploy/gcp-cloudflare-free` (or whichever you deploy)  
3. Root directory: `client`  
4. Build command: `npm ci && npm run build`  
5. Output: `dist`  
6. Environment variable:
   - `VITE_API_URL` = `https://api.yourdomain.com/api`  
7. Custom domain: `billing.yourdomain.com`

### D. Copy Railway data (cutover day)
1. Keep Railway running while you test GCP with a copy.  
2. Download Railway SQLite (volume / backup) as `suraj.db`.  
3. On the VM:

```bash
docker compose -f deploy/gcp/docker-compose.yml --env-file deploy/gcp/.env stop api
docker run --rm -v suraj-billing_suraj-data:/data -v "$PWD":/backup alpine \
  cp /backup/suraj.db /data/suraj.db
docker compose -f deploy/gcp/docker-compose.yml --env-file deploy/gcp/.env start api
```

4. Login on the new UI, spot-check bills/stock/suppliers.  
5. Only after several good days: point customers to the new domain and pause Railway.

Exact Railway volume export depends on how the volume is attached; if you want, send a screenshot of Railway storage and I’ll give the precise copy commands.

### E. Backups (already wired in this branch)
- Excel full dump: Tue/Fri/Sun 11:00 PM IST (`REPORT_CRON`) — same as today  
- SQLite `.db` email: daily 11:30 PM IST (`BACKUP_DB_CRON`)  
- Manual admin trigger: `POST /api/reports/backup-db`  
- On-disk copies under `/data/backups` (kept `BACKUP_DB_KEEP_DAYS` days)

---

## Reliability notes (e2-micro)
- 1 GiB RAM is tight: image uses `NODE_OPTIONS=--max-old-space-size=384` and bootstrap enables **1G swap**  
- Prefer **API-only** container (`SERVE_CLIENT=0`); Pages hosts the UI  
- Healthcheck hits `/api/health` (includes DB `SELECT 1`)  
- Compose restarts containers with `unless-stopped`  
- Do not open DB ports publicly — only 80/443 via Cloudflare  

## Rollback
- Leave Railway `main` deployed until cutover is trusted  
- DNS can be flipped back to Railway in minutes if needed  

## Files added on this branch
- `deploy/gcp/` — Docker, Compose, Caddy, bootstrap, env example  
- `deploy/cloudflare/` — Pages wrangler notes  
- `server/src/services/sqliteBackup.ts` — daily `.db` email  
- API hardening: `TRUST_PROXY`, SQLite WAL, richer `/api/health`
