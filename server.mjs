import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
let updater = null;
const chartCache = new Map();
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

async function sendFile(res, file) {
  try {
    const data = await fsp.readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
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
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  return sendFile(res, file);
});

server.listen(PORT, '127.0.0.1', () => console.log(`신고가 검색기: http://127.0.0.1:${PORT}`));
