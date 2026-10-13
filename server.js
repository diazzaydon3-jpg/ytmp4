const express = require('express');
const path = require('path');
const os = require('os');
const fs = require('fs');
const fsp = require('fs/promises');
const dns = require('dns').promises;
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const app = express();
const PORT = process.env.PORT || 10000;
const MAX_BYTES = Number(process.env.MAX_MEDIA_BYTES || 150 * 1024 * 1024);
const ALLOWED_HOSTS = (process.env.ALLOWED_MEDIA_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function isPrivateIPv4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || p[0] >= 224;
}
function isPrivateIPv6(ip) {
  const s = ip.toLowerCase();
  return s === '::1' || s === '::' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80:') || s.startsWith('::ffff:127.') || s.startsWith('::ffff:10.');
}
function hostAllowed(host) {
  return ALLOWED_HOSTS.some(domain => host === domain || host.endsWith('.' + domain));
}
async function validateSource(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('Enter a valid direct media URL.'); }
  const youtubeHosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtube-nocookie.com']);
  if (youtubeHosts.has(u.hostname.toLowerCase())) {
    throw new Error('You pasted a YouTube watch link. This version converts direct media-file URLs only; it cannot download or extract audio/video from YouTube pages. Use a direct media URL from a source you own or are authorized to download.');
  }
  if (!['https:', 'http:'].includes(u.protocol)) throw new Error('Only HTTP or HTTPS media links are supported.');
  if (u.username || u.password) throw new Error('Links containing a username or password are not allowed.');
  const host = u.hostname.toLowerCase();
  if (!hostAllowed(host)) throw new Error('This host is not on the allowed list. Set ALLOWED_MEDIA_HOSTS to a domain you own or are authorized to use.');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw new Error('Local network addresses are not allowed.');
  const records = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!records.length) throw new Error('Could not resolve the media host.');
  for (const r of records) {
    const ipType = net.isIP(r.address);
    if ((ipType === 4 && isPrivateIPv4(r.address)) || (ipType === 6 && isPrivateIPv6(r.address))) throw new Error('Private or local network addresses are not allowed.');
  }
  return u;
}
function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', d => { err += d.toString(); if (err.length > 6000) err = err.slice(-6000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error('Media processing failed. Check that the source is a valid media file. ' + err.slice(-900))));
  });
}
async function fetchMedia(url, dest) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`Source server returned HTTP ${response.status}.`);
  const type = (response.headers.get('content-type') || '').toLowerCase();
  if (!(type.startsWith('video/') || type.startsWith('audio/') || type === 'application/octet-stream')) throw new Error('The URL must point directly to a video or audio file, not a webpage.');
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) throw new Error('The media file exceeds the configured size limit.');
  if (!response.body) throw new Error('The source did not return a media stream.');
  const file = fs.createWriteStream(dest, { flags: 'wx' });
  let total = 0;
  try {
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > MAX_BYTES) { file.destroy(); throw new Error('The media file exceeds the configured size limit.'); }
      if (!file.write(chunk)) await new Promise((r, j) => { file.once('drain', r); file.once('error', j); });
    }
    await new Promise((r, j) => file.end(r).once('error', j));
  } catch (e) { file.destroy(); throw e; }
}
app.get('/api/health', (_req, res) => res.json({ ok: true, allowedHostsConfigured: ALLOWED_HOSTS.length > 0 }));
app.post('/api/convert', async (req, res) => {
  const { url, format, quality } = req.body || {};
  if (!url || typeof url !== 'string' || url.length > 2048) return res.status(400).json({ error: 'Paste a direct media file URL.' });
  if (!['mp4', 'mp3'].includes(format)) return res.status(400).json({ error: 'Choose MP4 or MP3.' });
  const qualityMap = { '360': '640:-2', '480': '854:-2', '720': '1280:-2', '1080': '1920:-2', 'source': null };
  if (format === 'mp4' && !Object.prototype.hasOwnProperty.call(qualityMap, String(quality || '720'))) return res.status(400).json({ error: 'Choose a supported quality.' });
  const job = crypto.randomUUID();
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ytmp4-'));
  const input = path.join(dir, 'source.bin');
  const output = path.join(dir, `converted.${format}`);
  try {
    const source = await validateSource(url);
    await fetchMedia(source.href, input);
    let args;
    if (format === 'mp3') args = ['-y', '-i', input, '-vn', '-codec:a', 'libmp3lame', '-b:a', '192k', output];
    else {
      const scale = qualityMap[String(quality || '720')];
      args = ['-y', '-i', input, '-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-movflags', '+faststart'];
      if (scale) args.push('-vf', `scale=${scale}:force_original_aspect_ratio=decrease`);
      args.push(output);
    }
    await runFfmpeg(args);
    res.setHeader('Content-Type', format === 'mp3' ? 'audio/mpeg' : 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="ytmp4-${job}.${format}"`);
    res.setHeader('Cache-Control', 'no-store');
    const stream = fs.createReadStream(output);
    stream.on('error', () => { if (!res.headersSent) res.status(500).end('Could not read converted file.'); else res.destroy(); });
    stream.on('close', () => fsp.rm(dir, { recursive: true, force: true }).catch(() => {}));
    stream.pipe(res);
  } catch (e) {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    res.status(400).json({ error: e.message || 'Conversion failed.' });
  }
});
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, '0.0.0.0', () => console.log(`YTMP4 listening on ${PORT}`));
