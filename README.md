# YTMP4 Cloud

A clean, responsive media converter for **direct media file URLs** from sources you own or are authorized to download. It supports MP4 output, MP3 audio extraction, MP4 resolution choices, thumbnail capture in the browser, and local browser history.

## Important scope

This starter deliberately does **not** extract video from YouTube watch pages, bypass DRM, login gates, or access controls. Paste a direct media file URL from a host you control or have permission to use. The source host must be explicitly allowlisted on the server using `ALLOWED_MEDIA_HOSTS`.

## Run locally

Requirements: Node.js 20+ and internet access to install npm packages.

```bash
npm install
# Linux/macOS example; use the equivalent environment-variable syntax on Windows:
ALLOWED_MEDIA_HOSTS=media.example.com npm start
```

Open `http://localhost:10000`. Replace `media.example.com` with a domain you control or are authorized to use. Multiple hosts can be comma-separated. Do not use a public service as an allowlist unless you have permission to process its files.

Optional setting: `MAX_MEDIA_BYTES` (default 157286400 = 150 MiB).

## Deploy for free (cloud)

### 1. Push this folder to GitHub

Create a new GitHub repository and upload the contents of this folder. Do not upload `.env` files or secrets.

### 2. Deploy the backend on Render

1. Sign in to Render and choose **New → Web Service**.
2. Connect the GitHub repository containing this project.
3. Choose the free instance for a hobby test.
4. Runtime: Docker (Render detects `Dockerfile`).
5. Add environment variable `ALLOWED_MEDIA_HOSTS` with your authorized direct-media host(s), for example `media.example.com`.
6. Optionally add `MAX_MEDIA_BYTES` (in bytes).
7. Create the service and wait for the deploy. Copy the `https://...onrender.com` URL.

The Docker image installs FFmpeg for conversion. The server checks the source host against your allowlist and rejects private/local IP addresses. It also limits request size and refuses redirects.

### 3. Open the app

This starter serves both frontend and API from the same Render service, so use the Render URL as the website URL. You do not need to run your computer after deployment.

### 4. Optional Cloudflare Pages frontend

For the simplest setup, keep the frontend and API together on Render. If you want a separate Cloudflare Pages frontend, you must adjust the API base URL in `public/index.html` and configure CORS on the backend before deploying the frontend as a Pages static site. That split deployment is not preconfigured in this starter.

## Free hosting caveat

Render free web services spin down after 15 minutes without inbound traffic and may take about a minute to wake up. Files in the service filesystem are ephemeral; this app stores conversions in a temporary directory and removes them after sending. Download history is stored in each visitor's browser, not on the server. The site URL remains hosted, but the conversion API is not guaranteed to respond instantly 24/7 on a free instance. See Render's current free service limits: https://render.com/docs/free

## Safety and production notes

- Only process media you own or are authorized to download and convert.
- Keep the allowlist narrow. Do not set it to a generic shared hosting domain.
- This starter is for a hobby prototype, not a high-volume public downloader. Add rate limiting, authentication/abuse controls, monitoring, and a stronger job queue before opening it to the public.
- Free hosting has memory, CPU, bandwidth, and runtime constraints; large media may fail or time out.
