import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const DEFAULT_PASSWORD_HASH = 'b1d2db51c06057150a493b5b3f7f960f:e730302526ee20f24ff50acc761afc196f733897584a0efecb2181fd528c85ec';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const COOKIE_NAME = 'high_scanner_session';
let updater = null;
const chartCache = new Map();
const loginAttempts = new Map();
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const publicFiles = new Set(['/index.html', '/app.js', '/style.css', '/chart.css']);

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function sessionToken() {
  return crypto.createHmac('sha256', SESSION_SECRET).update('high-price-scanner').digest('hex');
}

function passwordMatches(password) {
  if (APP_PASSWORD) return safeEqual(password, APP_PASSWORD);
  const [salt, expected] = DEFAULT_PASSWORD_HASH.split(':');
  return safeEqual(crypto.scryptSync(String(password), salt, 32).toString('hex'), expected);
}

function isAuthenticated(req) {
  if (!SESSION_SECRET) return false;
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(v => v.trim().split('=').map(decodeURIComponent)).filter(v => v.length === 2));
  return safeEqual(cookies[COOKIE_NAME] || '', sessionToken());
}

function loginPage(message = '') {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>신고가 검색기 로그인</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d1726;color:#eef4ff;font-family:system-ui,sans-serif}.card{width:min(360px,calc(100% - 40px));padding:34px;border:1px solid #29405c;border-radius:18px;background:#142238;box-shadow:0 18px 55px #0008}h1{font-size:24px;margin:0 0 8px}p{color:#9fb0c5;margin:0 0 24px}input,button{box-sizing:border-box;width:100%;padding:13px 14px;border-radius:10px;font-size:16px}input{border:1px solid #3a5270;background:#0d1726;color:white;margin-bottom:12px}button{border:0;background:#f5b942;color:#17263b;font-weight:800;cursor:pointer}.error{color:#ff8994;margin-bottom:14px}</style></head><body><form class="card" method="post" action="/login"><h1>신고가 검색기</h1><p>비밀번호를 입력하세요.</p>${message ? `<div class="error">${message}</div>` : ''}<input type="password" name="password" autocomplete="current-password" autofocus required><button type="submit">들어가기</button></form></body></html>`;
}

async function readForm(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 4096) throw new Error('Too large');
  }
  return new URLSearchParams(body);
}

async function sendFile(res, file) {
  try {
    const data = await fsp.readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (url.pathname === '/login' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(loginPage());
  }
  if (url.pathname === '/login' && req.method === 'POST') {
    const ip = req.socket.remoteAddress || 'unknown';
    const attempt = loginAttempts.get(ip) || { count: 0, until: 0 };
    if (attempt.until > Date.now()) { res.writeHead(429, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(loginPage('잠시 후 다시 시도하세요.')); }
    const form = await readForm(req).catch(() => new URLSearchParams());
    if (passwordMatches(form.get('password') || '')) {
      loginAttempts.delete(ip);
      const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      res.writeHead(303, { Location: '/', 'Set-Cookie': `${COOKIE_NAME}=${sessionToken()}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=2592000`, 'Cache-Control': 'no-store' });
      return res.end();
    }
    attempt.count += 1;
    if (attempt.count >= 5) { attempt.count = 0; attempt.until = Date.now() + 60_000; }
    loginAttempts.set(ip, attempt);
    res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(loginPage('비밀번호가 맞지 않습니다.'));
  }
  if (url.pathname === '/logout') {
    res.writeHead(303, { Location: '/login', 'Set-Cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });
    return res.end();
  }
  if (!isAuthenticated(req)) { res.writeHead(303, { Location: '/login', 'Cache-Control': 'no-store' }); return res.end(); }
  if (url.pathname === '/api/chart') {
    const code = url.searchParams.get('code') || '';
    if (!/^\d{6}$/.test(code)) { res.writeHead(400); return res.end('Invalid code'); }
    const cached = chartCache.get(code);
    if (cached && Date.now() - cached.at < 10 * 60_000) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(cached.body);
    }
    try {
      const response = await fetch(`https://fchart.stock.naver.com/sise.nhn?symbol=${code}&timeframe=day&count=300&requestType=0`, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://finance.naver.com/' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const xml = await response.text();
      const daily = [...xml.matchAll(/<item data="([^"]+)"/g)].map(m => {
        const [date, open, high, low, close, volume] = m[1].split('|').map(Number);
        return { date: String(date), open, high, low, close, volume };
      });
      const body = JSON.stringify({ code, daily }); chartCache.set(code, { at: Date.now(), body });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(body);
    } catch (error) { res.writeHead(502); return res.end(error.message); }
  }
  if (req.method === 'POST' && url.pathname === '/api/refresh') {
    if (updater) { res.writeHead(409, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: false, message: '이미 갱신 중입니다.' })); }
    updater = spawn(process.execPath, [path.join(ROOT, 'update-data.mjs')], { cwd: ROOT, stdio: ['ignore', fs.openSync(path.join(ROOT, 'update.log'), 'a'), fs.openSync(path.join(ROOT, 'update.log'), 'a')] });
    updater.on('exit', () => { updater = null; });
    res.writeHead(202, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }
  if (url.pathname === '/api/status') return sendFile(res, path.join(ROOT, 'data', 'status.json'));
  if (url.pathname === '/api/stocks') return sendFile(res, path.join(ROOT, 'data', 'stocks.json'));
  const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  if (!publicFiles.has(requested)) { res.writeHead(404); return res.end('Not found'); }
  const rel = requested.slice(1);
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  return sendFile(res, file);
});

server.listen(PORT, HOST, () => console.log(`신고가 검색기: http://${HOST}:${PORT}`));
