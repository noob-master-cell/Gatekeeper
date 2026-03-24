# 🚂 Gatekeeper Railway Deployment Guide

Railway is the perfect platform for Gatekeeper because it natively supports Docker multi-container architectures and **Internal Private Networking**.

This guide will walk you through spinning up the entire stack securely, exposing **only** the Dashboard to the public internet, while keeping your databases and proxy strictly locked in a private network.

---

### Step 1: Prepare your Repository
Make sure your latest code is pushed to your GitHub repository. Railway will hook directly into it.

### Step 2: Provision the Databases (1-Click)
1. Log into your [Railway Dashboard](https://railway.app/).
2. Click **New Project** → **Provision PostgreSQL**.
3. Once that finishes, click **Create** (top right) → **Database** → **Add Redis**.
4. You now have your backend storage ready!

### Step 3: Deploy the Control Plane (Internal)
1. Click **Create** → **GitHub Repo** → select your Gatekeeper repository.
2. Railway will add the service. Click on the new service, go to **Settings**.
3. Change the name of the service to exactly: `control-plane`.
4. Scroll down to **Root Directory** and set it to: `/gatekeeper-control-plane`.
5. Go to the **Variables** tab and inject your secrets:
   - `GK_CP_DATABASE_URL` = `postgresql+asyncpg://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}` *(Railway will automatically interpolate these from your Postgres plugin)*
   - `GK_CP_REDIS_URL` = `redis://default:${REDIS_PASSWORD}@${REDIS_HOST}:${REDIS_PORT}`
   - `GK_CP_API_KEY` = `your-secure-random-string`

### Step 4: Deploy the Proxy Engine (Internal)
1. Click **Create** → **GitHub Repo** again, selecting the same repository.
2. Go to **Settings**, rename this service to exactly `proxy`. *(This naming is critical so the dashboard can find it!)*
3. Set the **Root Directory** to: `/gatekeeper-proxy`.
4. Go to the **Variables** tab and inject:
   - `GK_CONTROL_PLANE_URL` = `http://control-plane:8002`
   - `GK_REDIS_URL` = `redis://default:${REDIS_PASSWORD}@${REDIS_HOST}:${REDIS_PORT}`
   - `GK_CP_API_KEY` = `your-secure-random-string` *(Same as above)*
   - `GK_GOOGLE_CLIENT_ID` = `your-google-oauth-client-id`
   - `GK_GOOGLE_CLIENT_SECRET` = `your-google-oauth-secret`
   - `GK_GOOGLE_REDIRECT_URI` = `https://your-future-dashboard.up.railway.app/auth/callback/google`

### Step 5: (Optional) Deploy the Dummy Backend
1. Click **Create** → **GitHub Repo**.
2. Rename service to `backend` and set Root Directory to `/gatekeeper-backend`.

### Step 6: Deploy the Dashboard (Public)
1. Click **Create** → **GitHub Repo**.
2. Go to **Settings**, rename this service to `dashboard`.
3. Set the **Root Directory** to: `/gatekeeper-dashboard`.
4. Railway will automatically build the React App into an Nginx container.
5. In the Railway UI for the `dashboard` service, go to **Settings** → **Networking** → **Generate Domain**.
6. Railway will give you a public URL (e.g., `https://dashboard-production-123.up.railway.app`).

---

### Final Google SSO Verification
Now that your dashboard has a real public HTTPS URL from Railway:
1. Copy that Railway URL.
2. Go to your **Google Cloud Console** > **OAuth credentials**.
3. Make sure the Authorized Redirect URI matches exactly:
   `https://dashboard-production-...up.railway.app/auth/callback/google`
4. Make sure the `GK_GOOGLE_REDIRECT_URI` variable in your Railway **Proxy** service matches this exact URL.

### 🎉 You're Done!
If you visit your new Railway Dashboard URL, Nginx will serve the React UI and privately proxy all API and authentication calls safely backward through Railway's internal network to the Proxy engine!
