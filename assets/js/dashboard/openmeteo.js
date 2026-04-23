function cityTodayKey(timezone, date = new Date()) {
  return date.toLocaleDateString('en-CA', { timeZone: timezone });
}

function parseHourlyRows(hourly, dateKey) {
  const times = hourly.time || [];
  const temps = hourly.temperature_2m || [];
  const rain = hourly.precipitation || [];
  const rainProb = hourly.precipitation_probability || [];
  const windSpeed = hourly.wind_speed_10m || [];
  const windDir = hourly.wind_direction_10m || [];

  return times
    .map((time, index) => {
      if (!time.startsWith(dateKey)) return null;
      const temp = temps[index];
      if (typeof temp !== 'number') return null;
      const hour = parseInt(time.substring(11, 13), 10);
      const minute = parseInt(time.substring(14, 16), 10);
      return {
        time,
        hour,
        minute,
        hourFrac: hour + minute / 60,
        label: time.substring(11, 16),
        temp,
        rain: typeof rain[index] === 'number' ? rain[index] : 0,
        rainProb: typeof rainProb[index] === 'number' ? rainProb[index] : null,
        windSpeed: typeof windSpeed[index] === 'number' ? windSpeed[index] : null,
        windDir: typeof windDir[index] === 'number' ? windDir[index] : null,
      };
    })
    .filter(Boolean);
}

function buildHourlyState(hourly, timezone, sourceLabel) {
  const dateKey = cityTodayKey(timezone);
  return {
    dateKey,
    rows: parseHourlyRows(hourly, dateKey),
    sourceLabel,
  };
}

function omDisplayTemp(tempC) {
  return tempFromCelsius(tempC, { decimals: activeTempUnit() === 'F' ? 1 : 1 });
}

function setOmMode(mode) {
  omMode = mode === 'average' ? 'average' : 'best';
  setOmHeader();
  if (activeCity.omKind === 'hourly' && hourlyOmState) drawOmChart();
}

function setOmHeader() {
  const title = document.getElementById('omTitle');
  const badge = document.getElementById('omBadge');
  const switchWrap = document.getElementById('omSwitch');
  const bestBtn = document.getElementById('omModeBest');
  const avgBtn = document.getElementById('omModeAvg');
  if (!title || !badge) return;
  title.textContent = 'Open-Meteo';
  badge.textContent = activeCity.omBadge || 'OM';
  if (switchWrap) switchWrap.style.display = 'none';
  if (bestBtn && avgBtn) {
    bestBtn.className = 'om-mode-btn';
    avgBtn.className = 'om-mode-btn';
  }
}

function drawHourlyOmChart() {
  const canvas = document.getElementById('omChart');
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

  const state = hourlyOmState;
  const rows = state?.rows || [];
  if (!state || !rows.length) {
    ctx.fillStyle = 'rgba(139,146,169,0.4)';
    ctx.font = '12px Inter,system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`No ${activeCity.name} data`, width / 2, height / 2);
    return;
  }

  const pad = { top: 14, right: 16, bottom: 28, left: 38 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const xOfHr = (hour) => pad.left + (hour / 24) * chartWidth;
  const tempsDisplay = rows.map((row) => omDisplayTemp(row.temp));
  const yMin0 = Math.min(...tempsDisplay);
  const yMax0 = Math.max(...tempsDisplay);
  const yMin = Math.floor(yMin0 - 1);
  const yMax = Math.ceil(yMax0 + 1);
  const yOf = (value) => pad.top + (1 - (value - yMin) / Math.max(yMax - yMin, 1)) * chartHeight;
  const rMax = Math.max(0.5, ...rows.map((row) => row.rain || 0));
  const rainH = chartHeight * 0.25;
  const rainBase = pad.top + chartHeight;

  for (let temp = yMin; temp <= yMax; temp++) {
    const y = yOf(temp);
    ctx.strokeStyle = 'rgba(37,40,54,0.9)';
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + chartWidth, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(139,146,169,0.55)';
    ctx.font = '10px Inter,system-ui,sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${temp}${tempUnitLabel()}`, pad.left - 4, y + 3.5);
  }

  ctx.fillStyle = 'rgba(139,146,169,0.6)';
  ctx.font = '10px Inter,system-ui,sans-serif';
  ctx.textAlign = 'center';
  for (let hour = 0; hour <= 24; hour += 3) {
    const x = xOfHr(hour);
    ctx.fillText(`${hour.toString().padStart(2, '0')}:00`, x, height - pad.bottom + 13);
    ctx.strokeStyle = 'rgba(37,40,54,0.4)';
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + chartHeight);
    ctx.stroke();
  }

  const barW = Math.max(2, chartWidth / 24 - 2);
  rows.forEach((row) => {
    if ((row.rain || 0) <= 0) return;
    const x = xOfHr(row.hourFrac) - barW / 2;
    const barHeight = Math.min((row.rain / rMax) * rainH, rainH);
    ctx.fillStyle = 'rgba(56,189,248,0.35)';
    ctx.fillRect(x, rainBase - barHeight, barW, barHeight);
  });

  ctx.strokeStyle = '#f97316';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  rows.forEach((row, index) => {
    const x = xOfHr(row.hourFrac);
    const y = yOf(omDisplayTemp(row.temp));
    index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartHeight);
  gradient.addColorStop(0, 'rgba(249,115,22,0.20)');
  gradient.addColorStop(1, 'rgba(249,115,22,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  rows.forEach((row, index) => {
    const x = xOfHr(row.hourFrac);
    const y = yOf(omDisplayTemp(row.temp));
    index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(xOfHr(rows[rows.length - 1].hourFrac), pad.top + chartHeight);
  ctx.lineTo(xOfHr(rows[0].hourFrac), pad.top + chartHeight);
  ctx.closePath();
  ctx.fill();

  rows.forEach((row) => {
    const x = xOfHr(row.hourFrac);
    const y = yOf(omDisplayTemp(row.temp));
    ctx.fillStyle = '#f97316';
    ctx.beginPath();
    ctx.arc(x, y, 2.8, 0, Math.PI * 2);
    ctx.fill();
  });

  const arrowY = pad.top + 6;
  rows.forEach((row) => {
    if (row.minute !== 0 || row.hour % 3 !== 0 || row.windDir == null) return;
    const x = xOfHr(row.hourFrac);
    ctx.save();
    ctx.translate(x, arrowY);
    ctx.rotate((row.windDir * Math.PI) / 180);
    ctx.strokeStyle = 'rgba(139,146,169,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 5);
    ctx.lineTo(0, -5);
    ctx.moveTo(-2.5, -1);
    ctx.lineTo(0, -5);
    ctx.lineTo(2.5, -1);
    ctx.stroke();
    ctx.restore();
    if (row.windSpeed != null) {
      ctx.fillStyle = 'rgba(139,146,169,0.45)';
      ctx.font = '8px Inter,system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(Math.round(row.windSpeed), x, arrowY + 14);
    }
  });

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: activeCity.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const nowHr = parseInt(parts.find((part) => part.type === 'hour').value, 10)
    + parseInt(parts.find((part) => part.type === 'minute').value, 10) / 60;
  const nowX = xOfHr(nowHr);
  if (nowX >= pad.left && nowX <= pad.left + chartWidth) {
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(99,102,241,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(nowX, pad.top);
    ctx.lineTo(nowX, pad.top + chartHeight);
    ctx.stroke();
    ctx.restore();
  }

  canvas._omGeom = {
    mode: 'hourly',
    PAD: pad,
    cW: chartWidth,
    rows,
    rMax,
    rainH,
    selectedLabel: state?.sourceLabel || activeCity.omSourceLabel || 'Open-Meteo',
  };
}

function drawOmChart() {
  if (activeCity.omKind === 'hourly') {
    drawHourlyOmChart();
    return;
  }

  const canvas = document.getElementById('omChart');
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

  if (!omData || !omData.minutely_15) {
    ctx.fillStyle = 'rgba(139,146,169,0.4)';
    ctx.font = '12px Inter,system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No data', width / 2, height / 2);
    return;
  }

  const h = omData.minutely_15;
  const temps = h.temperature_2m;
  const displayTemps = temps.map((temp) => omDisplayTemp(temp));
  const rain = h.precipitation;
  const wSpd = h.wind_speed_10m;
  const wDir = h.wind_direction_10m;
  const times = h.time;

  const pad = { top: 14, right: 16, bottom: 28, left: 38 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const hourFrac = (index) => parseInt(times[index].substring(11, 13), 10) + parseInt(times[index].substring(14, 16), 10) / 60;
  const xOfHr = (hour) => pad.left + (hour / 24) * chartWidth;

  const tMin0 = Math.min(...displayTemps);
  const tMax0 = Math.max(...displayTemps);
  const tPad = Math.max(1, Math.round((tMax0 - tMin0) * 0.2));
  const tMin = tMin0 - tPad;
  const tMax = tMax0 + tPad;
  const yOfT = (value) => pad.top + (1 - (value - tMin) / (tMax - tMin)) * chartHeight;

  const rMax = Math.max(0.5, ...rain);
  const rainH = chartHeight * 0.25;
  const rainBase = pad.top + chartHeight;

  ctx.lineWidth = 1;
  const step = tMax0 - tMin0 <= 6 ? 1 : 2;
  for (let temp = Math.ceil(tMin); temp <= Math.floor(tMax); temp += step) {
    const y = yOfT(temp);
    ctx.strokeStyle = 'rgba(37,40,54,0.9)';
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + chartWidth, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(139,146,169,0.55)';
    ctx.font = '10px Inter,system-ui,sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${temp}${tempUnitLabel()}`, pad.left - 4, y + 3.5);
  }

  ctx.fillStyle = 'rgba(139,146,169,0.6)';
  ctx.font = '10px Inter,system-ui,sans-serif';
  ctx.textAlign = 'center';
  for (let hour = 0; hour <= 24; hour += 3) {
    const x = xOfHr(hour);
    ctx.fillText(`${hour.toString().padStart(2, '0')}:00`, x, height - pad.bottom + 13);
    ctx.strokeStyle = 'rgba(37,40,54,0.4)';
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + chartHeight);
    ctx.stroke();
  }

  const barW = Math.max(2, chartWidth / 24 - 2);
  for (let index = 0; index < times.length; index++) {
    const hour = hourFrac(index);
    const value = rain[index];
    if (value <= 0) continue;
    const x = xOfHr(hour) - barW / 2;
    const barHeight = Math.min((value / rMax) * rainH, rainH);
    ctx.fillStyle = 'rgba(56,189,248,0.35)';
    ctx.fillRect(x, rainBase - barHeight, barW, barHeight);
  }

  if (temps.length >= 2) {
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    temps.forEach((temp, index) => {
      const x = xOfHr(hourFrac(index));
      const y = yOfT(displayTemps[index]);
      index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartHeight);
    gradient.addColorStop(0, 'rgba(96,165,250,0.20)');
    gradient.addColorStop(1, 'rgba(96,165,250,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    temps.forEach((temp, index) => {
      const x = xOfHr(hourFrac(index));
      const y = yOfT(displayTemps[index]);
      index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    const lastX = xOfHr(hourFrac(temps.length - 1));
    ctx.lineTo(lastX, pad.top + chartHeight);
    ctx.lineTo(xOfHr(hourFrac(0)), pad.top + chartHeight);
    ctx.closePath();
    ctx.fill();
  }

  const arrowY = pad.top + 6;
  for (let index = 0; index < times.length; index++) {
    const hour = hourFrac(index);
    if (hour % 3 !== 0) continue;
    const x = xOfHr(hour);
    ctx.save();
    ctx.translate(x, arrowY);
    ctx.rotate((wDir[index] * Math.PI) / 180);
    ctx.strokeStyle = 'rgba(139,146,169,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 5);
    ctx.lineTo(0, -5);
    ctx.moveTo(-2.5, -1);
    ctx.lineTo(0, -5);
    ctx.lineTo(2.5, -1);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(139,146,169,0.45)';
    ctx.font = '8px Inter,system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(Math.round(wSpd[index]), x, arrowY + 14);
  }

  const nowParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: activeCity.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const nowHr = parseInt(nowParts.find((part) => part.type === 'hour').value, 10)
    + parseInt(nowParts.find((part) => part.type === 'minute').value, 10) / 60;
  const nowX = xOfHr(nowHr);
  if (nowX >= pad.left && nowX <= pad.left + chartWidth) {
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(99,102,241,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(nowX, pad.top);
    ctx.lineTo(nowX, pad.top + chartHeight);
    ctx.stroke();
    ctx.restore();
  }

  canvas._omGeom = { mode: 'minutely', PAD: pad, cW: chartWidth, cH: chartHeight, temps, rain, wSpd, wDir, times, tMin, tMax, rMax, rainH, hourFrac };
}

setInterval(() => {
  if (omData) drawOmChart();
}, 60000);

(function setupOmHover() {
  const canvas = document.getElementById('omChart');
  const tip = document.getElementById('omTooltip');

  canvas.addEventListener('mousemove', (event) => {
    const geom = canvas._omGeom;
    if (!geom) return;

    if (geom.mode === 'hourly') {
      const rect = canvas.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      let best = geom.rows[0];
      let bestD = Infinity;
      geom.rows.forEach((row) => {
        const x = geom.PAD.left + (row.hourFrac / 24) * geom.cW;
        const distance = Math.abs(mx - x);
        if (distance < bestD) {
          bestD = distance;
          best = row;
        }
      });
      document.getElementById('omTtTime').textContent = `${best.label} ${activeCity.name}`;
      document.getElementById('omTtTemp').textContent = `${omDisplayTemp(best.temp).toFixed(1)}${tempUnitLabel()}`;
      document.getElementById('omTtWind').textContent =
        best.windSpeed != null && best.windDir != null
          ? `${Math.round(best.windSpeed)} km/h ${windDir(best.windDir)} \u00B7 ${geom.selectedLabel}`
          : geom.selectedLabel;
      document.getElementById('omTtRain').textContent =
        best.rain > 0
          ? `${best.rain.toFixed(1)} mm${best.rainProb != null ? ` \u00B7 ${Math.round(best.rainProb)}%` : ''}`
          : best.rainProb != null
            ? `${Math.round(best.rainProb)}% precip`
            : '';
      tip.style.left = `${Math.min(mx + 10, canvas.clientWidth - 150)}px`;
      tip.style.top = '8px';
      tip.classList.add('visible');
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    let bestI = 0;
    let bestD = Infinity;
    for (let index = 0; index < geom.times.length; index++) {
      const x = geom.PAD.left + (geom.hourFrac(index) / 24) * geom.cW;
      const distance = Math.abs(mx - x);
      if (distance < bestD) {
        bestD = distance;
        bestI = index;
      }
    }

    const timeStr = geom.times[bestI];
    document.getElementById('omTtTime').textContent = `${timeStr.substring(11, 13)}:${timeStr.substring(14, 16)}`;
    document.getElementById('omTtTemp').textContent = `${omDisplayTemp(geom.temps[bestI]).toFixed(1)}${tempUnitLabel()}`;
    document.getElementById('omTtWind').textContent = `${geom.wSpd[bestI]} km/h ${windDir(geom.wDir[bestI])}`;
    document.getElementById('omTtRain').textContent = geom.rain[bestI] > 0 ? `${geom.rain[bestI]} mm` : '';

    const x = geom.PAD.left + (geom.hourFrac(bestI) / 24) * geom.cW;
    tip.style.left = `${Math.min(x + 10, canvas.clientWidth - 120)}px`;
    tip.style.top = '8px';
    tip.classList.add('visible');
  });

  canvas.addEventListener('mouseleave', () => tip.classList.remove('visible'));
})();

function windDir(degValue) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(degValue / 22.5) % 16];
}

async function fetchOpenMeteo() {
  try {
    setOmHeader();
    document.getElementById('omLoading').style.display = '';
    document.getElementById('omLoading').textContent = 'Loading...';
    const res = await fetch(activeCity.omApi);
    if (!res.ok) throw new Error(res.status);
    omData = await res.json();
    hourlyOmState = activeCity.omKind === 'hourly'
      ? buildHourlyState(omData.hourly || {}, activeCity.timezone, activeCity.omSourceLabel)
      : null;
    document.getElementById('omLoading').style.display = 'none';
    setOmHeader();
    drawOmChart();
  } catch (error) {
    console.warn('Open-Meteo fetch:', error.message);
    document.getElementById('omLoading').textContent = 'Open-Meteo unavailable';
  }
}

fetchOpenMeteo();
setInterval(fetchOpenMeteo, OM_REFRESH);
window.addEventListener('resize', () => {
  if (omData) drawOmChart();
});
