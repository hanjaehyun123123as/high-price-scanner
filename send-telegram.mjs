import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ENV_CANDIDATES = [path.resolve(ROOT, '..', '.env'), path.resolve(ROOT, '..', 'telebot-config.env')];
const DATA_FILE = path.join(ROOT, 'data', 'stocks.json');

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#') && line.includes('='))
    .map(line => { const i = line.indexOf('='); return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]; }));
}

const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const fmt = value => Number(value).toLocaleString('ko-KR');

async function send(token, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true })
  });
  const body = await res.json();
  if (!body.ok) throw new Error(body.description || `Telegram HTTP ${res.status}`);
}

async function main() {
  let env = {};
  for (const file of ENV_CANDIDATES) {
    try { env = parseEnv(await fs.readFile(file, 'utf8')); break; } catch {}
  }
  env = { ...env, ...process.env };
  const token = env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_COMMAND_BOT_TOKEN;
  const chatId = env.TELEGRAM_SCANNER_CHAT_ID || '@Industrynewsfast';
  if (!token) throw new Error('telebot-config.env에 TELEGRAM_BOT_TOKEN이 없습니다.');

  const data = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
  const matched = data.stocks.filter(s => s.distanceFromHigh >= -20 && s.marketCap >= 200_000_000_000 && s.volume >= 150_000)
    .sort((a, b) => b.distanceFromHigh - a.distanceFromHigh);
  const marketDate = data.stocks.find(s => s.tradedAt)?.tradedAt?.slice(0, 10) || data.updatedAt.slice(0, 10);
  const header = `📡 <b>신고가 레이더</b> · ${marketDate}\n` +
    `52주 고점 -20% 이내 · 시총 2,000억↑ · 1봉전 거래량 15만주↑\n` +
    `조건 통과 <b>${matched.length}개</b>\n`;
  const lines = matched.map((s, i) => `${i + 1}. <a href="${s.url}"><b>${esc(s.name)}</b></a> (${s.code})\n` +
    `   ${fmt(s.price)}원 · 고점대비 ${s.distanceFromHigh.toFixed(1)}% · 거래량 ${fmt(s.volume)}`);

  const chunks = [];
  let chunk = header;
  for (const line of lines.length ? lines : ['조건에 맞는 종목이 없습니다.']) {
    if ((chunk + '\n' + line).length > 3800) { chunks.push(chunk); chunk = `📡 <b>신고가 레이더 (계속)</b>\n${line}`; }
    else chunk += `\n${line}`;
  }
  chunks.push(chunk + '\n\n<i>정보 제공용이며 투자 권유가 아닙니다.</i>');
  for (const message of chunks) await send(token, chatId, message);
  console.log(`${chatId}에 ${matched.length}개 종목 전송 완료`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
