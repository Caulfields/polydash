// ── Constants ─────────────────────────────────────────────────────────────────
const GAMMA_API   = '/api/gamma';
const CLOB_API    = '/api/clob';
const WS_URL      = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
const METAR_COLOR = '#38bdf8';
const MIN_DISPLAY = 0.05;
const QUERY       = new URLSearchParams(location.search);
const FIXED_CITY  = QUERY.get('city');
const FIXED_DATE  = QUERY.get('date');
const EMBED       = QUERY.get('embed') === '1';

const CITIES = {
  beijing:{ id:'beijing',name:'Beijing',timezone:'Asia/Shanghai',metar:'ZBAA',
    slugPrefix:'highest-temperature-in-beijing-on',seriesSlug:'beijing-daily-weather',seriesId:'0' },
  london: { id:'london', name:'London', timezone:'Europe/London', metar:'EGLC',
    slugPrefix:'highest-temperature-in-london-on', seriesSlug:'london-daily-weather', seriesId:'10006' },
  paris:  { id:'paris',  name:'Paris',  timezone:'Europe/Paris',  metar:'LFPB',
    slugPrefix:'highest-temperature-in-paris-on',  seriesSlug:'paris-daily-weather',  seriesId:'11168' },
  nyc:    { id:'nyc',    name:'New York', timezone:'America/New_York', metar:'KLGA',
    slugPrefix:'highest-temperature-in-nyc-on',    seriesSlug:'nyc-daily-weather',    seriesId:'0', usesUsMetarTenths:true },
  dallas: { id:'dallas', name:'Dallas', timezone:'America/Chicago',    metar:'KDAL',
    slugPrefix:'highest-temperature-in-dallas-on', seriesSlug:'dallas-daily-weather', seriesId:'0', usesUsMetarTenths:true },
};

// Fixed colors by threshold value (same temp → same color across all days)
const PALETTE = ['#22c55e','#6366f1','#ef4444','#f59e0b','#ec4899','#06b6d4','#f97316','#a855f7','#84cc16','#14b8a6','#fb923c','#e879f9'];
const _threshColors = {}; // cityId → Map(threshold → color)
function tempUnit() { return city.usesUsMetarTenths ? 'F' : 'C'; }
function tempUnitLabel() { return `°${tempUnit()}`; }
function tempFromCelsius(tempC) {
  if (!Number.isFinite(tempC)) return null;
  if (tempUnit() === 'F') return Math.round((tempC * 9) / 5 + 32);
  return tempC;
}
function formatTempFromCelsius(tempC) {
  const value = tempFromCelsius(tempC);
  return value == null ? '—' : `${value}${tempUnitLabel()}`;
}
function thresholdColor(cityId, threshold) {
  if (!_threshColors[cityId]) _threshColors[cityId] = new Map();
  const map = _threshColors[cityId];
  if (!map.has(threshold)) {
    const sorted = [...map.keys(), threshold].sort((a,b)=>a-b);
    sorted.forEach((t,i) => map.set(t, PALETTE[i % PALETTE.length]));
  }
  return map.get(threshold);
}
const PAD = { top: 16, right: 16, bottom: 36, left: 44 }; // day view
const PAD_RIGHT_METAR = 48;
// ── State ─────────────────────────────────────────────────────────────────────
let city         = CITIES[FIXED_CITY] || CITIES.beijing;
let selDate      = '';
let markets      = [];
let dayStart     = 0, dayEnd = 0;
let isToday      = false;
let ws           = null;
let chartCtx     = null, overlayCtx = null;
let metarVisible = false, metarPts = [];
let viewStart    = 0, viewEnd = 0;
let panState     = null;
const MIN_ZOOM_SPAN = 15 * 60;
// Historic METAR archive loaded from local JSON files (key: station → [{t,temp}])
const historicMetar = {};

function rPad() { return metarVisible && metarPts.length ? PAD_RIGHT_METAR : PAD.right; }
function maxViewEnd() { return dayEnd ? dayEnd + 7200 : 0; }
function viewSpan() { return Math.max(viewEnd - viewStart, MIN_ZOOM_SPAN); }
function isZoomed() { return dayStart && (viewStart !== dayStart || viewEnd !== maxViewEnd()); }

function updateZoomButtons() {
  const resetBtn = document.getElementById('zoomResetBtn');
  if (!resetBtn) return;
  const fullSpan = maxViewEnd() - dayStart;
  const span = viewSpan();
  const zoomed = isZoomed();
  resetBtn.disabled = !zoomed;
  resetBtn.textContent = zoomed && span > 0 ? `${Math.max(1, fullSpan / span).toFixed(1)}x` : '1x';
}

function setViewRange(start, end, redraw = true) {
  if (!dayStart || !dayEnd) return;
  const minStart = dayStart;
  const maxEnd = maxViewEnd();
  const maxSpan = maxEnd - minStart;
  const nextSpan = Math.max(MIN_ZOOM_SPAN, Math.min(end - start, maxSpan));
  let nextStart = start;
  let nextEnd = start + nextSpan;

  if (nextStart < minStart) {
    nextStart = minStart;
    nextEnd = nextStart + nextSpan;
  }
  if (nextEnd > maxEnd) {
    nextEnd = maxEnd;
    nextStart = nextEnd - nextSpan;
  }

  viewStart = Math.round(nextStart);
  viewEnd = Math.round(nextEnd);
  updateZoomButtons();
  if (redraw) drawDayChart();
}

function resetZoom(redraw = true) {
  if (!dayStart || !dayEnd) return;
  viewStart = dayStart;
  viewEnd = maxViewEnd();
  updateZoomButtons();
  if (redraw) drawDayChart();
}

function zoomChart(factor, anchorTs = viewStart + viewSpan() / 2) {
  if (!dayStart || !dayEnd) return;
  const span = viewSpan();
  const nextSpan = span * factor;
  const anchorRatio = (anchorTs - viewStart) / span;
  setViewRange(anchorTs - nextSpan * anchorRatio, anchorTs + nextSpan * (1 - anchorRatio));
}

function xOfTs(ts, cW) {
  return PAD.left + ((ts - viewStart) / viewSpan()) * cW;
}

function tsOfX(x, cW) {
  return viewStart + ((x - PAD.left) / cW) * viewSpan();
}

function formatAxisTime(ts) {
  const d = new Date(ts * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  if (viewSpan() <= 6 * 3600) return `${hh}:${mm}`;
  if (ts < dayStart || ts > dayEnd) {
    const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
    return `${month} ${d.getUTCDate()}`;
  }
  return `${hh}:00`;
}

function timeTicks() {
  const span = viewSpan();
  const steps = [15 * 60, 30 * 60, 60 * 60, 2 * 3600, 4 * 3600, 6 * 3600, 12 * 3600, 24 * 3600];
  const step = steps.find(s => span / s <= 8) || steps[steps.length - 1];
  const ticks = [];
  for (let ts = Math.ceil(viewStart / step) * step; ts <= viewEnd; ts += step) ticks.push(ts);
  return ticks;
}

// ── Date utils ────────────────────────────────────────────────────────────────
function todayIso(c = city)     { return new Date().toLocaleDateString('en-CA', { timeZone: c.timezone }); }
function yesterdayIso(c = city) { return new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: c.timezone }); }

function dateToSlug(c, iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: c.timezone, year:'numeric', month:'long', day:'numeric' });
  const p   = Object.fromEntries(fmt.formatToParts(new Date(Date.UTC(y,m-1,d,12))).map(x => [x.type, x.value]));
  return `${c.slugPrefix}-${p.month.toLowerCase()}-${parseInt(p.day,10)}-${p.year}`;
}

function getDayBounds(iso) {
  const ms = new Date(iso + 'T00:00:00Z').getTime();
  return { startTs: Math.floor(ms/1000), endTs: Math.floor(ms/1000) + 86400 };
}

function fmtPct(p) { if (p == null) return '—'; return (p*100).toFixed(p<0.01?2:1)+'%'; }
function fmtHour(ts, tz) { return new Date(ts*1000).toLocaleTimeString('en-GB',{timeZone:tz,hour:'2-digit',minute:'2-digit'}); }

// ── City tabs ─────────────────────────────────────────────────────────────────
function initCityTabs() {
  const el = document.getElementById('cityTabs');
  if (FIXED_CITY) {
    el.style.display = 'none';
    return;
  }
  Object.values(CITIES).forEach(c => {
    const btn = document.createElement('button');
    btn.className = 'tab' + (c.id===city.id?' active':'');
    btn.textContent = c.name;
    btn.onclick = () => { city=c; el.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b===btn)); triggerLoad(); };
    el.appendChild(btn);
  });
}

function triggerLoad() {
  const v = document.getElementById('datePicker').value;
  if (v) loadDay(v);
}

// ── METAR toggle ──────────────────────────────────────────────────────────────
async function toggleMetar() {
  metarVisible = !metarVisible;
  document.getElementById('metarBtn').classList.toggle('active', metarVisible);
  if (metarVisible && dayStart) await fetchMetar();
  drawDayChart();
  renderLegend();
}

// ── Status ────────────────────────────────────────────────────────────────────
function setStatus(msg, err=false, live=false) {
  const el = document.getElementById('statusBar');
  el.className = 'status-bar'+(err?' error':'');
  el.innerHTML = live ? `<div class="live-dot"></div>${msg}` : msg;
}
function showLoader(on) { document.getElementById('loader').className='loader'+(on?'':' hidden'); }

// ── Day-view market helpers ───────────────────────────────────────────────────
function eligibleMarkets() { return markets.filter(m=>Math.max(m.currentPrice||0,...m.history.map(h=>h.p),0)>=MIN_DISPLAY); }
function visibleMarkets()  { return eligibleMarkets().filter(m=>!m.hidden); }
function toggleMarket(idx) { if(markets[idx]){markets[idx].hidden=!markets[idx].hidden;drawDayChart();renderLegend();} }

// ── Legend (day view only) ────────────────────────────────────────────────────
function renderLegend() {
  const el = document.getElementById('legend');
  const eligible = eligibleMarkets();
  if (!eligible.length && !metarPts.length) {
    el.innerHTML = markets.length ? '<span class="leg-empty">No data</span>' : '<span class="leg-empty">No data loaded</span>';
    return;
  }
  const mktHtml = eligible.map(m => {
    const dim = m.hidden ? ' dim' : '';
    const col = m.hidden ? 'var(--muted)' : m.color;
    return `<div class="leg-item${dim}" onclick="toggleMarket(${m._idx})">
      <div class="leg-dot" style="background:${m.color}"></div>
      <span class="leg-label">${m.label}</span>
      <span class="leg-price" style="color:${col}">${fmtPct(m.currentPrice)}</span>
    </div>`;
  }).join('');
  let metarHtml = '';
  if (metarPts.length) {
    const last = metarPts[metarPts.length-1];
    metarHtml = `<div class="leg-item${!metarVisible?' dim':''}" onclick="toggleMetar()">
      <div class="leg-dot" style="background:${METAR_COLOR};border-radius:3px;"></div>
      <span class="leg-label">METAR</span>
      <span class="leg-price" style="color:${METAR_COLOR}">${formatTempFromCelsius(last.temp)}</span>
    </div>`;
  }
  el.innerHTML = mktHtml + metarHtml;
}

// ── Load: day ─────────────────────────────────────────────────────────────────
async function loadDay(iso) {
  selDate=iso; isToday=iso===todayIso();
  if(ws){ws.close();ws=null;} markets=[]; metarPts=[];
  document.getElementById('loadBtn').disabled=true;
  showLoader(true); setStatus(`Loading ${iso}…`); renderLegend();

  try {
    const event = await fetchEvent(city, iso);
    if(!event?.markets?.length) throw new Error(`No market found for ${dateToSlug(city,iso)}`);

    const {startTs,endTs} = getDayBounds(iso);
    dayStart=startTs; dayEnd=endTs;
    resetZoom(false);

    const raw = event.markets.map(m=>{
      const tids=JSON.parse(m.clobTokenIds);
      return {label:m.groupItemTitle,threshold:Number(m.groupItemThreshold),yesTokenId:tids[0],
              history:[],currentPrice:null,color:'',hidden:false,_idx:0};
    }).sort((a,b)=>a.threshold-b.threshold);

    const n=raw.length;
    raw.forEach((m,i)=>{m.color=thresholdColor(city.id, m.threshold);m._idx=i;});

    await Promise.all(raw.map(async m=>{
      try{
        const r=await fetch(`${CLOB_API}/prices-history?market=${m.yesTokenId}&startTs=${startTs}&endTs=${endTs}&fidelity=10`);
        if(r.ok){const d=await r.json();m.history=Array.isArray(d.history)?d.history:[];}
      }catch{}
    }));
    markets=raw;

    if(isToday){await fetchCurrentPrices();connectWS();}
    else{markets.forEach(m=>{if(m.history.length)m.currentPrice=m.history[m.history.length-1].p;});}
    if(metarVisible) await fetchMetar();

    const total=markets.reduce((s,m)=>s+m.history.length,0);
    setStatus(`${event.title||iso} · ${markets.length} markets · ${total} data points`,false,isToday);
    drawDayChart(); renderLegend();
  } catch(e) { setStatus(e.message,true); }

  showLoader(false); document.getElementById('loadBtn').disabled=false;
}

// ── Gamma event fetch ─────────────────────────────────────────────────────────
async function fetchEvent(c, iso) {
  const slug=dateToSlug(c,iso);
  try{const r=await fetch(`${GAMMA_API}/events?slug=${slug}`);if(r.ok){const a=await r.json();if(a[0])return a[0];}}catch{}
  try {
    const [y,m,d]=iso.split('-').map(Number);
    const matchesDate = (e) => {
      const end = new Date(e.endDate);
      return end.getUTCFullYear()===y && end.getUTCMonth()+1===m && end.getUTCDate()===d;
    };

    const limit = 50;
    for (let offset = 0; offset < 200; offset += limit) {
      const r = await fetch(`${GAMMA_API}/events?seriesSlug=${c.seriesSlug}&limit=${limit}&offset=${offset}`);
      if (!r.ok) break;
      const arr = await r.json();
      if (!Array.isArray(arr) || !arr.length) break;
      const found = arr.find(matchesDate);
      if (found) return found;
      if (arr.length < limit) break;
    }
  } catch {}
  return null;
}

async function fetchCurrentPrices() {
  if(!markets.length) return;
  try{
    const r=await fetch(`${CLOB_API}/last-trades-prices`,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(markets.map(m => ({ token_id: m.yesTokenId })))});
    if(r.ok){const list=await r.json();list.forEach(({token_id,price})=>{const m=markets.find(x=>x.yesTokenId===token_id);if(m)m.currentPrice=parseFloat(price);});}
  }catch{}
}

// ── METAR ─────────────────────────────────────────────────────────────────────
function parseUsMetarTenths(rawOb) {
  if (!rawOb) return null;
  const match = rawOb.match(/\bT([01])(\d{3})([01])(\d{3})\b/);
  if (!match) return null;
  const parseSignedTenths = (sign, digits) => (sign === '1' ? -1 : 1) * (parseInt(digits, 10) / 10);
  return {
    tempC: parseSignedTenths(match[1], match[2]),
    dewpC: parseSignedTenths(match[3], match[4]),
  };
}

function parseMetarObs(obs) {
  const timeValue = obs.obsTime || obs.reportTime;
  const t = typeof timeValue === 'number' ? timeValue
    : Math.floor(new Date(String(timeValue).includes('T') ? timeValue : timeValue + 'Z').getTime() / 1000);
  const precise = city.usesUsMetarTenths ? parseUsMetarTenths(obs.rawOb) : null;
  return { t, temp: precise?.tempC ?? obs.temp ?? null };
}

async function fetchMetar() {
  const station = city.metar;
  if (!station || !dayStart) { metarPts = []; return; }

  // Use archive if it covers this day
  if (historicMetar[station]) {
    metarPts = historicMetar[station]
      .filter(pt => pt.t >= dayStart && pt.t < dayEnd + 7200);
    if (metarPts.length) return;
  }

  const hours = Math.min(Math.ceil((Date.now() / 1000 - dayStart) / 3600) + 4, 168);
  try {
    const r = await fetch(`/api/metar?station=${station}&hours=${hours}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    metarPts = data.map(parseMetarObs)
      .filter(pt => pt.temp != null && pt.t >= dayStart && pt.t < dayEnd + 7200)
      .sort((a, b) => a.t - b.t);
  } catch { metarPts = []; }
}

function metarTRange() {
  const temps=metarPts.map(p=>tempFromCelsius(p.temp)).filter(t => t != null);
  const lo=Math.floor(Math.min(...temps))-1, hi=Math.ceil(Math.max(...temps))+1;
  return{lo,hi,range:hi-lo||1};
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connectWS() {
  if(!markets.length) return;
  ws=new WebSocket(WS_URL);
  ws.addEventListener('open',()=>ws.send(JSON.stringify({assets_ids:markets.map(m=>m.yesTokenId),type:'market',custom_feature_enabled:true})));
  ws.addEventListener('message',e=>{
    let msgs;try{msgs=JSON.parse(e.data);}catch{return;}
    if(!Array.isArray(msgs))msgs=[msgs];
    let changed=false;const nowTs=Math.floor(Date.now()/1000);
    msgs.forEach(msg=>{
      if(!msg.asset_id||msg.price==null)return;
      const m=markets.find(x=>x.yesTokenId===msg.asset_id);if(!m)return;
      const p=parseFloat(msg.price);if(isNaN(p))return;
      m.currentPrice=p;
      const last=m.history[m.history.length-1];
      if(!last||nowTs-last.t>30)m.history.push({t:nowTs,p});else m.history[m.history.length-1]={t:nowTs,p};
      changed=true;
    });
    if(changed){drawDayChart();renderLegend();}
  });
  ws.addEventListener('close',()=>{ws=null;if(isToday&&selDate===todayIso())setTimeout(connectWS,5000);});
}

// ── Canvas helpers ────────────────────────────────────────────────────────────
function sizeCanvas(canvas) {
  const dpr=window.devicePixelRatio||1;
  const w=canvas.clientWidth,h=canvas.clientHeight;
  canvas.width=w*dpr;canvas.height=h*dpr;
  const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);
  return{ctx,w,h};
}

// ── Draw: day chart ───────────────────────────────────────────────────────────
function drawDayChart() {
  const canvas=document.getElementById('chart');
  const{ctx,w:W,h:H}=sizeCanvas(canvas);
  chartCtx=ctx;
  const pr=rPad();
  const cW=W-PAD.left-pr, cH=H-PAD.top-PAD.bottom;

  ctx.fillStyle='#0d0f14';ctx.fillRect(0,0,W,H);

  ctx.strokeStyle='#252836';ctx.lineWidth=1;ctx.setLineDash([]);
  for(let p=0;p<=100;p+=10){const y=PAD.top+(1-p/100)*cH;ctx.beginPath();ctx.moveTo(PAD.left,y);ctx.lineTo(PAD.left+cW,y);ctx.stroke();}
  timeTicks().forEach(ts=>{const x=xOfTs(ts,cW);ctx.beginPath();ctx.moveTo(x,PAD.top);ctx.lineTo(x,PAD.top+cH);ctx.stroke();});

  ctx.fillStyle='#8b92a9';ctx.font='10px Inter,system-ui,sans-serif';
  ctx.textAlign='right';ctx.textBaseline='middle';
  for(let p=0;p<=100;p+=20)ctx.fillText(p+'%',PAD.left-6,PAD.top+(1-p/100)*cH);
  ctx.textAlign='center';ctx.textBaseline='top';
  timeTicks().forEach(ts=>ctx.fillText(formatAxisTime(ts),xOfTs(ts,cW),PAD.top+cH+8));
  ctx.fillStyle='#4a5068';ctx.textAlign='right';ctx.textBaseline='bottom';
  ctx.fillText('UTC',PAD.left-6,PAD.top+cH+32);

  if(!markets.length||!dayStart)return;

  visibleMarkets().forEach(m=>{
    const pts=m.history.filter(pt=>pt.t>=viewStart&&pt.t<=viewEnd)
      .map(pt=>({x:xOfTs(pt.t,cW),y:PAD.top+(1-Math.max(0,Math.min(1,pt.p)))*cH}));
    if(!pts.length)return;
    ctx.strokeStyle=m.color;ctx.lineWidth=2;ctx.lineJoin='round';ctx.setLineDash([]);ctx.globalAlpha=0.85;
    ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i].x,pts[i].y);
    ctx.stroke();ctx.globalAlpha=1;
  });

  if(isToday){
    const nowTs=Math.floor(Date.now()/1000);
    if(nowTs>=viewStart&&nowTs<=viewEnd){
      const x=xOfTs(nowTs,cW);
      ctx.strokeStyle='rgba(255,255,255,0.12)';ctx.lineWidth=1;ctx.setLineDash([4,4]);
      ctx.beginPath();ctx.moveTo(x,PAD.top);ctx.lineTo(x,PAD.top+cH);ctx.stroke();ctx.setLineDash([]);
    }
  }

  if(metarVisible&&metarPts.length){
    const{lo,hi,range}=metarTRange();
    const tToY=t=>PAD.top+(1-(t-lo)/range)*cH;
    const tToX=t=>xOfTs(t,cW);
    ctx.fillStyle=METAR_COLOR;ctx.font='10px Inter,system-ui,sans-serif';
    ctx.textAlign='left';ctx.textBaseline='middle';
    const step=(hi-lo)<=6?1:2;
    for(let t=lo;t<=hi;t+=step)ctx.fillText(`${t}${tempUnitLabel()}`,PAD.left+cW+6,tToY(t));
    ctx.fillStyle='rgba(56,189,248,0.5)';ctx.font='9px Inter,system-ui,sans-serif';
    ctx.textBaseline='bottom';ctx.fillText(tempUnitLabel(),PAD.left+cW+6,PAD.top+cH+32);
    ctx.strokeStyle='rgba(56,189,248,0.15)';ctx.lineWidth=1;ctx.setLineDash([]);
    ctx.beginPath();ctx.moveTo(PAD.left+cW,PAD.top);ctx.lineTo(PAD.left+cW,PAD.top+cH);ctx.stroke();
    ctx.strokeStyle=METAR_COLOR;ctx.lineWidth=2;ctx.lineJoin='round';ctx.setLineDash([6,3]);ctx.globalAlpha=0.9;
    ctx.beginPath();
    metarPts.filter(pt=>pt.t>=viewStart&&pt.t<=viewEnd)
      .forEach((pt,i)=>{const x=tToX(pt.t),y=tToY(tempFromCelsius(pt.temp));if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});
    ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1;
  }
}

// ── Overlay ───────────────────────────────────────────────────────────────────
function initOverlay() {
  const canvas=document.getElementById('overlay');
  canvas.addEventListener('mousemove',onMouseMove);
  canvas.addEventListener('mouseleave',onMouseLeave);
  canvas.addEventListener('wheel',onChartWheel,{passive:false});
  canvas.addEventListener('pointerdown',onChartPointerDown);
  canvas.addEventListener('pointermove',onChartPointerMove);
  canvas.addEventListener('pointerup',onChartPointerUp);
  canvas.addEventListener('pointercancel',onChartPointerUp);
}

function onMouseLeave() {
  const canvas=document.getElementById('overlay');
  if(overlayCtx)overlayCtx.clearRect(0,0,canvas.width,canvas.height);
  document.getElementById('tooltip').style.display='none';
}

function onMouseMove(e) {
  if(!markets.length||!dayStart)return;
  const canvas=document.getElementById('overlay');
  const dpr=window.devicePixelRatio||1;
  const cw=canvas.clientWidth,ch=canvas.clientHeight;
  if(canvas.width!==cw*dpr||canvas.height!==ch*dpr){canvas.width=cw*dpr;canvas.height=ch*dpr;overlayCtx=canvas.getContext('2d');overlayCtx.scale(dpr,dpr);}
  if(!overlayCtx){overlayCtx=canvas.getContext('2d');overlayCtx.scale(dpr,dpr);}

  const pr=rPad();
  const W=cw,H=ch,cW=W-PAD.left-pr,cH=H-PAD.top-PAD.bottom;
  const rect=canvas.getBoundingClientRect();
  const mx=e.clientX-rect.left,my=e.clientY-rect.top;
  overlayCtx.clearRect(0,0,W,H);

  if(mx<PAD.left||mx>PAD.left+cW||my<PAD.top||my>PAD.top+cH){document.getElementById('tooltip').style.display='none';return;}

  const hoverTs=tsOfX(mx,cW);

  overlayCtx.strokeStyle='rgba(255,255,255,0.18)';overlayCtx.lineWidth=1;overlayCtx.setLineDash([3,3]);
  overlayCtx.beginPath();overlayCtx.moveTo(mx,PAD.top);overlayCtx.lineTo(mx,PAD.top+cH);overlayCtx.stroke();
  overlayCtx.setLineDash([]);

  const rows=[];
  visibleMarkets().forEach(m=>{
    const pts=m.history.filter(pt=>pt.t>=viewStart&&pt.t<=viewEnd);
    if(!pts.length)return;
    let best=pts[0],bestD=Infinity;
    pts.forEach(pt=>{const d=Math.abs(pt.t-hoverTs);if(d<bestD){bestD=d;best=pt;}});
    const px=xOfTs(best.t,cW);
    const py=PAD.top+(1-Math.max(0,Math.min(1,best.p)))*cH;
    overlayCtx.beginPath();overlayCtx.arc(px,py,4,0,Math.PI*2);
    overlayCtx.fillStyle=m.color;overlayCtx.fill();
    overlayCtx.strokeStyle='rgba(255,255,255,0.8)';overlayCtx.lineWidth=1.5;overlayCtx.stroke();
    rows.push({color:m.color,label:m.label,value:fmtPct(best.p),ts:best.t});
  });

  if(metarVisible&&metarPts.length){
    const{lo,hi,range}=metarTRange();
    const visibleMetar=metarPts.filter(pt=>pt.t>=viewStart&&pt.t<=viewEnd);
    let best=visibleMetar[0],bestD=Infinity;
    visibleMetar.forEach(pt=>{const d=Math.abs(pt.t-hoverTs);if(d<bestD){bestD=d;best=pt;}});
    if(best){
      const px=xOfTs(best.t,cW);
      const py=PAD.top+(1-(tempFromCelsius(best.temp)-lo)/range)*cH;
      overlayCtx.beginPath();overlayCtx.arc(px,py,4,0,Math.PI*2);
      overlayCtx.fillStyle=METAR_COLOR;overlayCtx.fill();
      overlayCtx.strokeStyle='rgba(255,255,255,0.8)';overlayCtx.lineWidth=1.5;overlayCtx.stroke();
      rows.push({color:METAR_COLOR,label:'Temp',value:formatTempFromCelsius(best.temp),ts:best.t});
    }
  }

  if(!rows.length){document.getElementById('tooltip').style.display='none';return;}

  const refTs=rows[0].ts;
  const tzName=city.timezone.split('/').pop().replace('_',' ');
  const sorted=[...rows].sort((a,b)=>a.label==='Temp'?1:b.label==='Temp'?-1:0);

  const tip=document.getElementById('tooltip');
  tip.innerHTML=`<div class="tt-time">${fmtHour(refTs,city.timezone)} ${tzName}</div>${sorted.map(r=>`<div class="tt-row"><div class="tt-dot" style="background:${r.color}"></div><span class="tt-name">${r.label}</span><span class="tt-val" style="color:${r.color}">${r.value}</span></div>`).join('')}`;
  tip.style.display='block';
  const tipW=tip.offsetWidth||150,tipH=tip.offsetHeight||100;
  let tx=mx+14,ty=my-tipH/2;
  if(tx+tipW>W-10)tx=mx-tipW-14;
  if(ty<PAD.top)ty=PAD.top;
  if(ty+tipH>H-PAD.bottom)ty=H-PAD.bottom-tipH;
  tip.style.left=tx+'px';tip.style.top=ty+'px';
}

function onChartWheel(e) {
  if(!dayStart||!markets.length)return;
  const canvas=document.getElementById('overlay');
  const pr=rPad();
  const cW=canvas.clientWidth-PAD.left-pr;
  const cH=canvas.clientHeight-PAD.top-PAD.bottom;
  const rect=canvas.getBoundingClientRect();
  const mx=e.clientX-rect.left,my=e.clientY-rect.top;
  if(mx<PAD.left||mx>PAD.left+cW||my<PAD.top||my>PAD.top+cH)return;
  e.preventDefault();
  zoomChart(e.deltaY < 0 ? 0.75 : 1.33, tsOfX(mx,cW));
  onMouseMove(e);
}

function chartPoint(e) {
  const canvas=document.getElementById('overlay');
  const pr=rPad();
  const cW=canvas.clientWidth-PAD.left-pr;
  const cH=canvas.clientHeight-PAD.top-PAD.bottom;
  const rect=canvas.getBoundingClientRect();
  return { canvas, cW, cH, mx:e.clientX-rect.left, my:e.clientY-rect.top };
}

function isInsideChartPoint(pt) {
  return pt.mx>=PAD.left&&pt.mx<=PAD.left+pt.cW&&pt.my>=PAD.top&&pt.my<=PAD.top+pt.cH;
}

function onChartPointerDown(e) {
  if(!dayStart||!markets.length||e.button!==0)return;
  const pt=chartPoint(e);
  if(!isInsideChartPoint(pt))return;
  panState={pointerId:e.pointerId,startX:pt.mx,startViewStart:viewStart,startViewEnd:viewEnd,moved:false};
  pt.canvas.setPointerCapture(e.pointerId);
  pt.canvas.classList.add('is-panning');
}

function onChartPointerMove(e) {
  if(!panState||e.pointerId!==panState.pointerId)return;
  const pt=chartPoint(e);
  const span=panState.startViewEnd-panState.startViewStart;
  const deltaTs=((pt.mx-panState.startX)/pt.cW)*span;
  if(Math.abs(pt.mx-panState.startX)>2)panState.moved=true;
  setViewRange(panState.startViewStart-deltaTs,panState.startViewEnd-deltaTs);
  onMouseMove(e);
}

function onChartPointerUp(e) {
  if(!panState||e.pointerId!==panState.pointerId)return;
  const canvas=document.getElementById('overlay');
  if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
  canvas.classList.remove('is-panning');
  panState=null;
}

// ── Init ──────────────────────────────────────────────────────────────────────
function init() {
  const dp=document.getElementById('datePicker');
  dp.value=FIXED_DATE || todayIso(); dp.max=todayIso();

  if (EMBED) document.querySelector('.nav-link').style.display = 'none';
  if (FIXED_CITY) document.querySelector('header h1').textContent = `Price History - ${city.name}`;

  document.getElementById('loadBtn').onclick=triggerLoad;
  document.getElementById('metarBtn').onclick=toggleMetar;
  document.getElementById('zoomInBtn').onclick=()=>zoomChart(0.75);
  document.getElementById('zoomOutBtn').onclick=()=>zoomChart(1.33);
  document.getElementById('zoomResetBtn').onclick=()=>resetZoom();
  dp.addEventListener('keydown',e=>{if(e.key==='Enter'&&dp.value)loadDay(dp.value);});

  initCityTabs();
  initOverlay();
  window.addEventListener('resize',()=>{if(markets.length)drawDayChart();});

  // Load historic METAR archives (non-blocking)
  Object.values(CITIES).forEach(c => { if (c.metar) loadHistoricMetar(c.metar); });

  loadDay(dp.value);
}

async function loadHistoricMetar(station) {
  try {
    const r = await fetch(`/data/metar-${station}.json`);
    if (!r.ok) return;
    const raw = await r.json(); // [[t, temp], ...]
    historicMetar[station] = raw.map(([t, temp]) => ({t, temp}));
    console.log(`[metar] loaded archive ${station}: ${raw.length} records`);
  } catch(e) { console.warn('[metar] archive load failed', station, e.message); }
}

init();
