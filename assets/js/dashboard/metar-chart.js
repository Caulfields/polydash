function cityDateStr(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: activeCity.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

async function loadMetar() {
  try {
    const res = await fetch(`/api/metar?station=${activeCity.metar}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();

    const obs = raw
      .filter((row) => row.temp != null)
      .map((row) => ({
        time: new Date(row.reportTime),
        temp: row.temp,
        dewp: row.dewp,
        wspd: row.wspd,
        wdir: row.wdir,
        rawOb: row.rawOb,
        weather: parseMetarWeather(row.rawOb),
      }))
      .sort((a, b) => a.time - b.time);

    const todayStr = cityDateStr(new Date());
    const yesterdayStr = cityDateStr(new Date(Date.now() - 86400000));

    metarToday = obs.filter((item) => cityDateStr(item.time) === todayStr);
    metarYesterday = obs.filter((item) => cityDateStr(item.time) === yesterdayStr);
    metarObsTime = metarToday.length ? metarToday[metarToday.length - 1].time.getTime() : Date.now();

    document.getElementById('chartTitle').textContent = `${activeCity.metar} Temperature Today`;
    updateMetarUI();
    drawChart();
    document.getElementById('metarUpd').textContent = fmtMetarAge(metarObsTime);
  } catch (error) {
    console.warn('METAR fetch:', error.message);
    document.getElementById('metarRaw').textContent = 'METAR unavailable';
  }
}

function parseMetarWeather(rawOb) {
  if (!rawOb) return '\u2014';
  const tokens = rawOb.split(' ');

  const wxMap = {
    TSRA: 'thunderstorm with rain',
    TSSN: 'thunderstorm with snow',
    TSGS: 'thunderstorm with hail',
    TS: 'thunderstorm',
    '+RA': 'heavy rain',
    RA: 'rain',
    '-RA': 'light rain',
    '+SN': 'heavy snow',
    SN: 'snow',
    '-SN': 'light snow',
    RASN: 'rain and snow',
    SNRA: 'snow and rain',
    '+DZ': 'heavy drizzle',
    DZ: 'drizzle',
    '-DZ': 'light drizzle',
    FZRA: 'freezing rain',
    FZDZ: 'freezing drizzle',
    '+GR': 'heavy hail',
    GR: 'hail',
    GS: 'small hail',
    BLSN: 'blowing snow',
    DRSN: 'drifting snow',
    FG: 'fog',
    FZFG: 'freezing fog',
    MIFG: 'shallow fog',
    BR: 'mist',
    HZ: 'haze',
    FU: 'smoke',
    DU: 'dust',
    SA: 'sand',
    SQ: 'squalls',
    FC: 'funnel cloud',
  };

  const skyPriority = { FEW: 1, SCT: 2, BKN: 3, OVC: 4 };
  const skyLabel = {
    FEW: 'mostly clear',
    SCT: 'partly cloudy',
    BKN: 'cloudy',
    OVC: 'overcast',
  };

  for (const token of tokens) {
    if (wxMap[token]) return wxMap[token];
  }

  for (const token of tokens) {
    if (/^(SKC|CLR|NSC|NCD|CAVOK)$/.test(token)) return 'clear';
  }

  let bestPriority = 0;
  let bestLabel = null;
  for (const token of tokens) {
    const match = token.match(/^(FEW|SCT|BKN|OVC)\d{3}/);
    if (match && skyPriority[match[1]] > bestPriority) {
      bestPriority = skyPriority[match[1]];
      bestLabel = skyLabel[match[1]];
    }
  }
  return bestLabel || '\u2014';
}

function updateMetarUI() {
  if (!metarToday.length) return;
  const latest = metarToday[metarToday.length - 1];

  document.getElementById('tempNow').innerHTML = `${latest.temp}<span class="temp-unit">\u00B0C</span>`;
  document.getElementById('metarRaw').textContent = latest.rawOb;
  document.getElementById('cfWeather').textContent = parseMetarWeather(latest.rawOb);
  document.getElementById('cfWind').textContent =
    (latest.wdir === 'VRB' ? 'VRB' : latest.wdir != null ? `${latest.wdir}\u00B0` : '\u2014') +
    (latest.wspd != null ? ` ${latest.wspd}kt` : '');

  const temps = metarToday.map((item) => item.temp);
  document.getElementById('cfMin').textContent = `${Math.min(...temps)}\u00B0C`;
  document.getElementById('cfMax').textContent = `${Math.max(...temps)}\u00B0C`;
}

function cityTimeParts(date) {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: activeCity.timezone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
}

function toHourFrac(date) {
  const parts = cityTimeParts(date);
  return parseInt(parts.hour, 10) + parseInt(parts.minute, 10) / 60 + parseInt(parts.second, 10) / 3600;
}

function drawChart() {
  const canvas = document.getElementById('tempChart');
  const wrap = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const width = wrap.clientWidth;
  const height = wrap.clientHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  if (!metarToday.length) {
    ctx.fillStyle = 'rgba(139,146,169,0.4)';
    ctx.font = '12px Inter,system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No METAR data', width / 2, height / 2);
    return;
  }

  const pad = { top: 14, right: 20, bottom: 28, left: 36 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const xOfHr = (hour) => pad.left + (hour / 24) * chartWidth;

  const allTemps = [...metarToday.map((item) => item.temp), ...metarYesterday.map((item) => item.temp)];
  const rawMin = Math.min(...allTemps);
  const rawMax = Math.max(...allTemps);
  const yPad = Math.max(1, Math.round((rawMax - rawMin) * 0.15));
  const yMin = rawMin - yPad;
  const yMax = rawMax + yPad;
  const yOf = (value) => pad.top + (1 - (value - yMin) / (yMax - yMin)) * chartHeight;

  ctx.lineWidth = 1;
  const step = rawMax - rawMin <= 6 ? 1 : 2;
  for (let temp = Math.ceil(yMin); temp <= Math.floor(yMax); temp += step) {
    const y = yOf(temp);
    ctx.strokeStyle = 'rgba(37,40,54,0.9)';
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + chartWidth, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(139,146,169,0.55)';
    ctx.font = '10px Inter,system-ui,sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${temp}\u00B0`, pad.left - 4, y + 3.5);
  }

  ctx.fillStyle = 'rgba(139,146,169,0.6)';
  ctx.font = '10px Inter,system-ui,sans-serif';
  ctx.textAlign = 'center';
  for (let hour = 0; hour <= 24; hour += 2) {
    const x = xOfHr(hour);
    ctx.fillText(`${hour.toString().padStart(2, '0')}:00`, x, height - pad.bottom + 13);
    ctx.strokeStyle = 'rgba(37,40,54,0.5)';
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + chartHeight);
    ctx.stroke();
  }

  if (metarToday.length) {
    const curTemp = metarToday[metarToday.length - 1].temp;
    const active = THRESH_TEMPS.filter((temp) => temp <= curTemp).pop() ?? THRESH_TEMPS[0];
    const label = active === 12 ? '\u226412\u00B0C' : active === 22 ? '\u226522\u00B0C' : `${active}\u00B0C`;
    const y = yOf(active);
    const nowX = xOfHr(toHourFrac(metarToday[metarToday.length - 1].time));
    if (y >= pad.top && y <= pad.top + chartHeight) {
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.beginPath();
      ctx.moveTo(nowX, y);
      ctx.lineTo(pad.left + chartWidth, y);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '10px Inter,system-ui,sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(label, pad.left + 4, y - 3);
    }
  }

  if (metarYesterday.length >= 2) {
    ctx.save();
    ctx.setLineDash([3, 5]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(139,146,169,0.4)';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    metarYesterday.forEach((item, index) => {
      const x = xOfHr(toHourFrac(item.time));
      const y = yOf(item.temp);
      index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();

    const last = metarYesterday[metarYesterday.length - 1];
    ctx.fillStyle = 'rgba(139,146,169,0.5)';
    ctx.font = '9px Inter,system-ui,sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('yday', xOfHr(toHourFrac(last.time)) + 3, yOf(last.temp) + 3);
  }

  if (metarToday.length >= 1) {
    const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartHeight);
    gradient.addColorStop(0, 'rgba(249,115,22,0.30)');
    gradient.addColorStop(0.7, 'rgba(249,115,22,0.06)');
    gradient.addColorStop(1, 'rgba(249,115,22,0)');

    ctx.beginPath();
    metarToday.forEach((item, index) => {
      const x = xOfHr(toHourFrac(item.time));
      const y = yOf(item.temp);
      index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    const lastX = xOfHr(toHourFrac(metarToday[metarToday.length - 1].time));
    const firstX = xOfHr(toHourFrac(metarToday[0].time));
    ctx.lineTo(lastX, pad.top + chartHeight);
    ctx.lineTo(firstX, pad.top + chartHeight);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#f97316';
    ctx.lineJoin = 'round';
    metarToday.forEach((item, index) => {
      const x = xOfHr(toHourFrac(item.time));
      const y = yOf(item.temp);
      index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    for (const item of metarToday) {
      const minutes = item.time.getMinutes();
      if (minutes !== 0 && minutes !== 30) continue;
      const x = xOfHr(toHourFrac(item.time));
      const y = yOf(item.temp);
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#f97316';
      ctx.fill();
    }

    const latest = metarToday[metarToday.length - 1];
    const latestX = xOfHr(toHourFrac(latest.time));
    const latestY = yOf(latest.temp);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px Inter,system-ui,sans-serif';
    ctx.textAlign = latestX > width - pad.right - 40 ? 'right' : 'left';
    ctx.fillText(`${latest.temp}\u00B0C`, latestX + (ctx.textAlign === 'left' ? 6 : -6), latestY - 6);
  }

  const overlay = document.getElementById('tempChartOverlay');
  overlay.width = width * dpr;
  overlay.height = height * dpr;
  overlay.style.width = `${width}px`;
  overlay.style.height = `${height}px`;

  chartState = { PAD: pad, cW: chartWidth, cH: chartHeight, W: width, H: height, xOfHr, yOf, dpr };
}

function buildLegend() {
  document.getElementById('chartLegend').innerHTML =
    '<div class="legend-item"><div class="legend-dot" style="background:#f97316"></div><span>Today</span></div>' +
    '<div class="legend-item"><div class="legend-dot" style="background:rgba(139,146,169,0.5);border-top:1px dashed rgba(139,146,169,0.5);height:0"></div><span>Yesterday</span></div>';
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(drawChart, 80);
});

function setupChartMouse() {
  const overlay = document.getElementById('tempChartOverlay');
  const tooltip = document.getElementById('chartTooltip');

  overlay.addEventListener('mousemove', (event) => {
    if (!chartState) return;
    const { PAD, cW, cH, W, xOfHr, yOf, dpr } = chartState;

    const rect = overlay.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const hoverHr = ((mouseX - PAD.left) / cW) * 24;

    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    if (mouseX < PAD.left || mouseX > PAD.left + cW || mouseY < PAD.top || mouseY > PAD.top + cH) {
      tooltip.classList.remove('visible');
      return;
    }

    let nearestToday = null;
    let minDist = Infinity;
    for (const item of metarToday) {
      const dist = Math.abs(toHourFrac(item.time) - hoverHr);
      if (dist < minDist) {
        minDist = dist;
        nearestToday = item;
      }
    }

    let nearestYday = null;
    let minDistY = Infinity;
    for (const item of metarYesterday) {
      const dist = Math.abs(toHourFrac(item.time) - hoverHr);
      if (dist < minDistY) {
        minDistY = dist;
        nearestYday = item;
      }
    }

    if (!nearestToday || minDist > 0.6) {
      tooltip.classList.remove('visible');
      return;
    }

    const snapX = xOfHr(toHourFrac(nearestToday.time));
    const snapY = yOf(nearestToday.temp);

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath();
    ctx.moveTo(snapX, PAD.top);
    ctx.lineTo(snapX, PAD.top + cH);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(snapX, snapY, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#f97316';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (nearestYday && minDistY < 0.6) {
      const ydayY = yOf(nearestYday.temp);
      ctx.beginPath();
      ctx.arc(snapX, ydayY, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(139,146,169,0.6)';
      ctx.fill();
    }

    ctx.restore();

    const timeParts = cityTimeParts(nearestToday.time);
    document.getElementById('ttTime').textContent = `${timeParts.hour}:${timeParts.minute} ${activeCity.name.slice(0, 3).toUpperCase()}`;
    document.getElementById('ttTemp').textContent = `${nearestToday.temp}\u00B0C`;
    document.getElementById('ttWx').textContent = nearestToday.weather || '';

    const tipW = 100;
    let tipX = mouseX + 14;
    let tipY = mouseY - 44;
    if (tipX + tipW > W) tipX = mouseX - tipW - 14;
    if (tipY < 4) tipY = mouseY + 14;

    tooltip.style.left = `${tipX}px`;
    tooltip.style.top = `${tipY}px`;
    tooltip.classList.add('visible');
  });

  overlay.addEventListener('mouseleave', () => {
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    tooltip.classList.remove('visible');
  });
}
