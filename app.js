const $ = id => document.getElementById(id);
let all = [], visible = [], sort = { key: 'distanceFromHigh', dir: -1 };
const hosted = location.hostname.endsWith('github.io');
const fmt = n => Number(n).toLocaleString('ko-KR');
const eok = won => `${fmt(Math.round(won / 100_000_000))}억`;
const compact = won => won >= 1e12 ? `${(won/1e12).toFixed(1)}조` : `${Math.round(won/1e8)}억`;

function candleChart(daily, large=false, high52=0) {
  const count=large?300:20, data = (daily || []).filter(d => d.high && d.low).slice(0, count);
  if (!large) data.reverse();
  if (!data.length) return '<span class="chart-empty">갱신 필요</span>';
  const W=large?840:142,H=large?320:42,left=large?68:3,right=large?12:3,topPad=large?12:3,bottom=large?18:3;
  const rawMax=Math.max(...data.map(d=>d.high),high52||0), rawMin=Math.min(...data.map(d=>d.low));
  const margin=(rawMax-rawMin)*.04, max=rawMax+margin, min=Math.max(0,rawMin-margin);
  const y=v=>topPad+(max-v)/Math.max(1,max-min)*(H-topPad-bottom), step=(W-left-right)/data.length, bw=Math.max(large?1:2,step*.64);
  const candles=data.map((d,i)=>{const x=left+step*i+step/2, up=d.close>=d.open, c=up?'#eb4a58':'#3979d1', yo=y(d.open),yc=y(d.close), bodyTop=Math.min(yo,yc), h=Math.max(1,Math.abs(yo-yc));return `<line x1="${x.toFixed(1)}" y1="${y(d.high).toFixed(1)}" x2="${x.toFixed(1)}" y2="${y(d.low).toFixed(1)}" stroke="${c}" stroke-width="1"/><rect x="${(x-bw/2).toFixed(1)}" y="${bodyTop.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${c}" rx=".5"/>`}).join('');
  let guides='';
  if(large){guides=Array.from({length:6},(_,i)=>{const value=max-(max-min)*i/5,py=y(value);return `<line x1="${left}" y1="${py.toFixed(1)}" x2="${W-right}" y2="${py.toFixed(1)}" stroke="#29405c" stroke-width="1"/><text x="${left-7}" y="${(py+3).toFixed(1)}" text-anchor="end" fill="#9fb0c5" font-size="10">${Math.round(value).toLocaleString('ko-KR')}</text>`}).join('');if(high52){const hy=y(high52);guides+=`<line x1="${left}" y1="${hy.toFixed(1)}" x2="${W-right}" y2="${hy.toFixed(1)}" stroke="#f5b942" stroke-width="1.5" stroke-dasharray="5 4"/><rect x="${W-142}" y="${(hy-15).toFixed(1)}" width="130" height="16" rx="4" fill="#f5b942"/><text x="${W-18}" y="${(hy-4).toFixed(1)}" text-anchor="end" fill="#17263b" font-size="10" font-weight="700">52주 최고 ${Math.round(high52).toLocaleString('ko-KR')}</text>`}}
  return `<svg class="candle-chart${large?' candle-chart-large':''}" viewBox="0 0 ${W} ${H}" role="img" aria-label="최근 ${data.length}거래일 일봉 차트">${guides}${candles}</svg>`;
}

async function load() {
  try {
    const res = await fetch((hosted ? './data/stocks.json' : '/api/stocks') + '?t=' + Date.now());
    if (!res.ok) throw new Error();
    const data = await res.json(); all = data.stocks || [];
    const d = new Date(data.updatedAt); $('dataDate').textContent = d.toLocaleDateString('ko-KR');
    $('statusText').textContent = `${fmt(data.totalMarketStocks)}개 종목 기준`;
    apply();
  } catch { apply(); }
}

function apply() {
  const maxD = Number($('distance').value), cap = Number($('cap').value) * 1e8, vol = Number($('volume').value);
  const market = $('market').value, q = $('search').value.trim().toLowerCase();
  $('distanceLabel').textContent = `-${maxD}% 이상`;
  visible = all.filter(s => s.distanceFromHigh >= -maxD && s.marketCap >= cap && s.volume >= vol && (market === 'ALL' || s.market === market) && (!q || s.name.toLowerCase().includes(q) || s.code.includes(q)));
  visible.sort((a,b) => { const x=a[sort.key], y=b[sort.key]; return (typeof x==='string' ? x.localeCompare(y,'ko') : x-y) * sort.dir; });
  render();
}

function render() {
  $('matchCount').textContent = `${fmt(visible.length)}개`; $('nearCount').textContent = `${fmt(visible.filter(s=>s.distanceFromHigh>=-5).length)}개`;
  const avg = visible.length ? visible.reduce((a,s)=>a+s.price*s.volume,0)/visible.length : 0; $('avgValue').textContent = compact(avg); $('resultBadge').textContent = visible.length;
  $('empty').style.display = visible.length ? 'none' : 'block';
  $('rows').innerHTML = visible.map(s => `<tr><td><div class="stock"><span class="ticker">${s.market==='KOSPI'?'KS':'KQ'}</span><div>${s.name}<small>${s.code} · ${s.market}</small></div></div></td><td>${fmt(s.price)}원</td><td class="${s.changeRate>=0?'up':'down'}">${s.changeRate>=0?'+':''}${s.changeRate.toFixed(2)}%</td><td>${fmt(s.high52)}원</td><td><span class="distance ${s.distanceFromHigh < -10?'mid':''}">${s.distanceFromHigh.toFixed(1)}%</span></td><td>${fmt(s.volume)}</td><td>${eok(s.marketCap)}</td><td class="chart-cell"><div class="chart chart-hover" data-code="${s.code}" data-name="${s.name}" data-high52="${s.high52}" title="마우스를 올리면 300봉 일봉 차트">${candleChart(s.daily)}</div></td></tr>`).join('');
}

let hoverTimer=0, hoverController=null;
function positionTooltip(e){const tip=$('chartTooltip'), gap=16, w=Math.min(880,innerWidth-24), h=390;let x=e.clientX+gap,y=e.clientY+gap;if(x+w>innerWidth-8)x=e.clientX-w-gap;if(y+h>innerHeight-8)y=Math.max(8,e.clientY-h-gap);tip.style.left=`${Math.max(8,x)}px`;tip.style.top=`${y}px`}
document.addEventListener('mouseover',e=>{const el=e.target.closest?.('.chart-hover');if(!el||el.contains(e.relatedTarget))return;clearTimeout(hoverTimer);hoverTimer=setTimeout(async()=>{const tip=$('chartTooltip');$('chartTitle').textContent=`${el.dataset.name} · 300봉 일봉`;$('chartPeriod').textContent='';$('chartLarge').className='chart-large-loading';$('chartLarge').textContent='불러오는 중…';positionTooltip(e);tip.classList.add('show');tip.setAttribute('aria-hidden','false');hoverController?.abort();hoverController=new AbortController();try{const chartUrl=hosted?`./data/charts/${el.dataset.code}.json`:`/api/chart?code=${el.dataset.code}`;const d=await(await fetch(chartUrl,{signal:hoverController.signal})).json();$('chartLarge').className='';$('chartLarge').innerHTML=candleChart(d.daily,true,Number(el.dataset.high52));if(d.daily.length)$('chartPeriod').textContent=`${d.daily[0].date} — ${d.daily[d.daily.length-1].date} · ${d.daily.length}봉`;}catch(err){if(err.name!=='AbortError')$('chartLarge').textContent='이 종목의 300봉 차트는 다음 자동 갱신 때 준비됩니다.'}},180)});
document.addEventListener('mousemove',e=>{if($('chartTooltip').classList.contains('show'))positionTooltip(e)});
document.addEventListener('mouseout',e=>{const el=e.target.closest?.('.chart-hover');if(!el||el.contains(e.relatedTarget))return;clearTimeout(hoverTimer);hoverController?.abort();$('chartTooltip').classList.remove('show');$('chartTooltip').setAttribute('aria-hidden','true')});

async function refresh() {
  if(hosted){alert('웹 버전은 매일 오전 7시에 자동 갱신됩니다.');return}
  const btn=$('refresh'); btn.disabled=true; btn.textContent='갱신 시작 중…';
  try { const r=await fetch('/api/refresh',{method:'POST'}); if(!r.ok&&r.status!==409) throw new Error(); poll(); }
  catch { btn.disabled=false; btn.textContent='↻ 오늘 데이터 갱신'; alert('갱신을 시작하지 못했습니다.'); }
}
async function poll(){
  try{const s=await (await fetch('/api/status?t='+Date.now())).json(); $('statusText').textContent=s.total?`${s.message} ${s.completed||0}/${s.total}`:s.message; $('statusText').classList.toggle('loading',s.state==='running'); if(s.state==='done'){ $('refresh').disabled=false;$('refresh').textContent='↻ 오늘 데이터 갱신';await load();return } if(s.state==='error'){throw new Error(s.message)}}catch(e){$('refresh').disabled=false;$('refresh').textContent='↻ 오늘 데이터 갱신';if(e.message)alert(e.message);return} setTimeout(poll,1500);
}
function csv(){const head=['종목코드','종목명','시장','현재가','등락률','52주최고가','고점대비(%)','거래량','시가총액'];const body=visible.map(s=>[s.code,s.name,s.market,s.price,s.changeRate,s.high52,s.distanceFromHigh.toFixed(2),s.volume,s.marketCap]);const text='\uFEFF'+[head,...body].map(r=>r.join(',')).join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'text/csv'}));a.download=`신고가검색_${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(a.href)}
['distance','cap','volume','market','search'].forEach(id=>$(id).addEventListener(id==='search'?'input':'change',apply));
document.querySelectorAll('th[data-sort]').forEach(th=>th.onclick=()=>{const k=th.dataset.sort;sort={key:k,dir:sort.key===k?-sort.dir:(k==='name'?1:-1)};apply()});
$('refresh').onclick=refresh;$('csv').onclick=csv;$('reset').onclick=()=>{$('distance').value=20;$('cap').value=2000;$('volume').value=150000;$('market').value='ALL';$('search').value='';apply()};load();
