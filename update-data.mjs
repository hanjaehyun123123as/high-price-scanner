import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, 'data');
const OUT = path.join(DATA_DIR, 'stocks.json');
const STATUS = path.join(DATA_DIR, 'status.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) KR-High-Scanner/1.0';

const args = new Map(process.argv.slice(2).map(x => x.replace(/^--/, '').split('=')));
// 수집 단계에서는 전 종목을 보존한다. 아래 옵션은 문제 진단용으로 명시했을 때만 사용한다.
const collectionMinCap = Number(args.get('min-cap') || 0) * 100_000_000; // 억원 → 원
const collectionMinVolume = Number(args.get('min-volume') || 0);

const n = value => Number(String(value ?? '').replace(/[^0-9.-]/g, '')) || 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function json(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://m.stock.naver.com/' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      if (attempt === retries) throw error;
      await sleep(350 * attempt);
    }
  }
}

async function writeStatus(payload) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STATUS, JSON.stringify({ ...payload, at: new Date().toISOString() }, null, 2), 'utf8');
}

async function fetchMarket(market) {
  const pageSize = 100;
  const first = await json(`https://m.stock.naver.com/api/stocks/marketValue/${market}?page=1&pageSize=${pageSize}`);
  const pages = Math.ceil(first.totalCount / pageSize);
  const stocks = [...first.stocks];
  for (let page = 2; page <= pages; page++) {
    const data = await json(`https://m.stock.naver.com/api/stocks/marketValue/${market}?page=${page}&pageSize=${pageSize}`);
    stocks.push(...data.stocks);
  }
  return stocks;
}

function baseStock(s) {
  return {
    code: s.itemCode,
    name: s.stockName,
    market: s.stockExchangeType?.name || (s.sosok === '0' ? 'KOSPI' : 'KOSDAQ'),
    price: n(s.closePriceRaw || s.closePrice),
    change: n(s.compareToPreviousClosePriceRaw || s.compareToPreviousClosePrice),
    changeRate: n(s.fluctuationsRatio),
    volume: n(s.accumulatedTradingVolumeRaw || s.accumulatedTradingVolume),
    marketCap: n(s.marketValueRaw),
    tradedAt: s.localTradedAt,
    url: s.endUrl || `https://m.stock.naver.com/domestic/stock/${s.itemCode}`
  };
}

async function add52Week(stock) {
  const [info, prices] = await Promise.all([
    json(`https://m.stock.naver.com/api/stock/${stock.code}/integration`),
    json(`https://m.stock.naver.com/api/stock/${stock.code}/price`)
  ]);
  const map = Object.fromEntries((info.totalInfos || []).map(x => [x.code, n(x.value)]));
  const high52 = map.highPriceOf52Weeks || 0;
  const currentDate = String(stock.tradedAt || '').slice(0, 10);
  const previous = (prices || []).find(p => p.localTradedAt < currentDate) || prices?.[1];
  return {
    ...stock,
    todayVolume: stock.volume,
    volume: n(previous?.accumulatedTradingVolume),
    volumeDate: previous?.localTradedAt || null,
    daily: (prices || []).slice(0, 30).map(p => ({
      date: p.localTradedAt,
      open: n(p.openPrice), high: n(p.highPrice), low: n(p.lowPrice), close: n(p.closePrice),
      volume: n(p.accumulatedTradingVolume)
    })),
    high52,
    low52: map.lowPriceOf52Weeks || 0,
    distanceFromHigh: high52 ? ((stock.price / high52) - 1) * 100 : null,
    per: map.per || null,
    pbr: map.pbr || null
  };
}

async function pooled(items, worker, concurrency = 10) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const i = cursor++;
      try { results[i] = await worker(items[i], i); }
      catch (error) { results[i] = { ...items[i], error: error.message }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

async function main() {
  await writeStatus({ state: 'running', message: '시장 종목 목록을 불러오는 중' });
  const [kospi, kosdaq] = await Promise.all([fetchMarket('KOSPI'), fetchMarket('KOSDAQ')]);
  const listedStocks = [...kospi, ...kosdaq].filter(s => s.stockEndType === 'stock');
  const candidates = listedStocks
    .map(baseStock)
    .filter(s => s.marketCap >= collectionMinCap && s.volume >= collectionMinVolume);

  let completed = 0;
  await writeStatus({ state: 'running', message: '52주 최고가를 확인하는 중', completed, total: candidates.length });
  const detailed = await pooled(candidates, async stock => {
    const result = await add52Week(stock);
    completed++;
    if (completed % 20 === 0 || completed === candidates.length) {
      await writeStatus({ state: 'running', message: '52주 최고가를 확인하는 중', completed, total: candidates.length });
    }
    return result;
  });

  const stocks = detailed.filter(s => !s.error && s.high52);
  const payload = {
    updatedAt: new Date().toISOString(),
    source: 'NAVER Finance',
    sourceNotice: '비공식 공개 시세를 이용하며 거래량은 키움 조건과 같이 1봉전(전 거래일) 기준입니다.',
    defaults: { minCapEok: 2000, minVolume: 150_000, maxDistancePercent: 20 },
    totalMarketStocks: listedStocks.length,
    candidateCount: candidates.length,
    stocks
  };
  await fs.writeFile(`${OUT}.tmp`, JSON.stringify(payload), 'utf8');
  await fs.rename(`${OUT}.tmp`, OUT);
  await writeStatus({ state: 'done', message: `${stocks.length}개 종목 갱신 완료`, completed: stocks.length, total: stocks.length });
  console.log(`${stocks.length} stocks saved to ${OUT}`);
}

main().catch(async error => {
  await writeStatus({ state: 'error', message: error.message });
  console.error(error);
  process.exitCode = 1;
});
