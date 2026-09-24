# Auto-deploy to Google Cloud e2-micro

Pushes to `deploy/gcp-cloudflare-free` can deploy automatically via GitHub Actions
(SSH → `git pull` → `docker compose up --build` on the VM).

`main` / Railway is not deployed by this workflow.

## One-time setup (about 5 minutes)

### 1) Create an SSH deploy key (on your Mac)

```bash
ssh-keygen -t ed25519 -C "github-deploy-suraj-billing" -f ~/suraj-billing-gcp-deploy -N ""
```

This creates:
- `~/suraj-billing-gcp-deploy` (private — goes to GitHub secret)
- `~/suraj-billing-gcp-deploy.pub` (public — goes on the VM)

### 2) Install the public key on the VM

In Google Cloud → VM → **SSH**, run:

```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
nano ~/.ssh/authorized_keys
```

Paste the **full contents** of `~/suraj-billing-gcp-deploy.pub` as a new line, then save.

```bash
chmod 600 ~/.ssh/authorized_keys
```

### 3) Allow SSH from the internet (you already have this)

Firewall rule `default-allow-ssh` (tcp:22) must exist — yours does.

### 4) Add GitHub secrets

Repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Secret name | Value |
|-------------|--------|
| `GCP_HOST` | VM external IP, e.g. `136.69.239.155` |
| `GCP_USER` | SSH username, e.g. `surajmobilereports` |
| `GCP_SSH_KEY` | Full private key file contents (`~/suraj-billing-gcp-deploy`) including `BEGIN` / `END` lines |

Optional: `GCP_SSH_PORT` if not `22`.

### 5) Test

1. GitHub → **Actions** → **Deploy GCP free stack** → **Run workflow**
2. Or push any small change to `deploy/gcp-cloudflare-free`
3. Watch the job logs; when green, open `http://YOUR_IP` and hard-refresh

### Troubleshooting SSH authentication

The message `unable to authenticate, attempted methods [none publickey]` means the VM was reached, but it rejected the key or username. In the Google Cloud browser SSH session, run:

```bash
whoami
mkdir -p ~/.ssh
chmod 700 ~/.ssh
echo 'PASTE_THE_CONTENTS_OF_suraj-billing-gcp-deploy.pub_HERE' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

Set `GCP_USER` to the exact output of `whoami`. Set `GCP_SSH_KEY` to the matching private key file, including its `BEGIN ... PRIVATE KEY` and `END ... PRIVATE KEY` lines. Do not put the `.pub` file in `GCP_SSH_KEY`, and do not add quotes around the key. If the VM SSH port is not `22`, set `GCP_SSH_PORT` as well.

## Notes

- First auto-deploy build on e2-micro can take **10–20 minutes**
- `.env` on the VM is never overwritten by git (it stays local)
- If IP changes, update secret `GCP_HOST` (or reserve a static IP)
- To pause auto-deploy: disable the workflow in Actions, or remove the secrets
