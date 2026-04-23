const { h, render } = preact;
const { useState, useEffect, useCallback, useRef } = preactHooks;
const html = htm.bind(h);

const HOURLY_VARS = 'temperature_2m,wind_speed_10m,cloud_cover,precipitation_probability';
const DAILY_VARS = 'temperature_2m_max,temperature_2m_min';

const SOURCES = [
  {
    id: 'noaa',
    label: 'NOAA Seamless',
    color: '#60a5fa',
    buildUrl: (city) => `https://api.open-meteo.com/v1/gfs?latitude=${city.lat}&longitude=${city.lon}&hourly=${HOURLY_VARS}&daily=${DAILY_VARS}&timezone=${encodeURIComponent(city.timezone)}&forecast_days=3`,
  },
  {
    id: 'ecmwf',
    label: 'ECMWF IFS',
    color: '#34d399',
    buildUrl: (city) => `https://api.open-meteo.com/v1/ecmwf?latitude=${city.lat}&longitude=${city.lon}&hourly=${HOURLY_VARS}&daily=${DAILY_VARS}&timezone=${encodeURIComponent(city.timezone)}&forecast_days=3`,
  },
  {
    id: 'best',
    label: 'Best Match',
    color: '#f59e0b',
    buildUrl: (city) => `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&hourly=${HOURLY_VARS}&daily=${DAILY_VARS}&timezone=${encodeURIComponent(city.timezone)}&forecast_days=3`,
  },
];

const CITIES = [
  {
    id: 'nyc',
    name: 'New York',
    station: 'KLGA',
    airport: 'LaGuardia',
    timezone: 'America/New_York',
    lat: 40.774722,
    lon: -73.871944,
    slugPrefix: 'highest-temperature-in-nyc-on',
  },
  {
    id: 'dallas',
    name: 'Dallas',
    station: 'KDAL',
    airport: 'Dallas Love Field',
    timezone: 'America/Chicago',
    lat: 32.847222,
    lon: -96.851667,
    slugPrefix: 'highest-temperature-in-dallas-on',
  },
];

function cityNowParts(timezone, date = new Date()) {
  return {
    dateKey: date.toLocaleDateString('en-CA', { timeZone: timezone }),
    timeLabel: date.toLocaleTimeString('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }),
    hour: parseInt(date.toLocaleString('en-GB', { timeZone: timezone, hour: 'numeric', hour12: false }), 10),
    minute: parseInt(date.toLocaleString('en-GB', { timeZone: timezone, minute: 'numeric' }), 10),
  };
}

function dayTitle(dateKey) {
  const parts = dateKey.split('-');
  if (parts.length !== 3) return dateKey;
  return `${parts[2]}.${parts[1]}`;
}

function cToF(tempC) {
  return (tempC * 9) / 5 + 32;
}

function formatTemp(value, decimals = 1) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(decimals)}°F`;
}

function formatIntTemp(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${Math.round(value)}°F`;
}

function pct(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(value < 0.01 ? 2 : 1)}%`;
}

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

function parseModelData(hourly, timezone) {
  const times = hourly.time || [];
  const temps = hourly.temperature_2m || [];
  const winds = hourly.wind_speed_10m || [];
  const clouds = hourly.cloud_cover || [];
  const pops = hourly.precipitation_probability || [];
  return times.map((time, i) => ({
    dateKey: time.slice(0, 10),
    hour: parseInt(time.slice(11, 13), 10),
    label: time.slice(11, 16),
    temp: temps[i] != null ? Math.round(cToF(temps[i]) * 10) / 10 : null,
    wind: winds[i] ?? null,
    cloud: clouds[i] ?? null,
    pop: pops[i] ?? null,
    timezone,
  }));
}

function parseDailyRows(daily) {
  const times = daily.time || [];
  const maxTemps = daily.temperature_2m_max || [];
  const minTemps = daily.temperature_2m_min || [];
  return times.map((dateKey, i) => ({
    dateKey,
    title: dayTitle(dateKey),
    max: maxTemps[i] != null ? Math.round(cToF(maxTemps[i])) : null,
    min: minTemps[i] != null ? Math.round(cToF(minTemps[i])) : null,
  }));
}

function parseMetarRows(raw, city) {
  const todayKey = cityNowParts(city.timezone).dateKey;
  return (Array.isArray(raw) ? raw : [])
    .filter((row) => row && row.rawOb && (row.reportTime || row.obsTime))
    .map((row) => {
      const exact = parseUsMetarTenths(row.rawOb);
      const tempC = exact?.tempC ?? row.temp;
      const time = new Date(row.reportTime || row.obsTime);
      if (!Number.isFinite(tempC) || Number.isNaN(time.getTime())) return null;
      const parts = cityNowParts(city.timezone, time);
      const tempF = cToF(tempC);
      return {
        time,
        dateKey: parts.dateKey,
        hour: parts.hour,
        minute: parts.minute,
        hourFrac: parts.hour + parts.minute / 60,
        label: parts.timeLabel,
        temp: Math.round(tempF * 10) / 10,
        settled: Math.round(tempF),
        rawOb: row.rawOb,
      };
    })
    .filter(Boolean)
    .filter((row) => row.dateKey === todayKey)
    .sort((a, b) => a.time - b.time);
}

function modelPeak(rows) {
  const validRows = rows.filter((row) => row && row.temp != null);
  if (!validRows.length) return null;
  return validRows.reduce((max, row) => (row.temp > max.temp ? row : max), validRows[0]);
}

function buildAverageSeries(referenceRows, rowsBySource) {
  return referenceRows.map((row, i) => {
    const temps = SOURCES.map((source) => (rowsBySource[source.id] || [])[i]?.temp).filter((value) => value != null);
    return {
      dateKey: row.dateKey,
      hour: row.hour,
      label: row.label,
      dayTitle: row.dayTitle,
      temp: temps.length ? Math.round((temps.reduce((sum, value) => sum + value, 0) / temps.length) * 10) / 10 : null,
      count: temps.length,
    };
  });
}

function buildConsensus(peaks) {
  if (!peaks.length) return null;
  const sortedTemps = peaks.map((item) => item.peak.temp).slice().sort((a, b) => a - b);
  const mid = Math.floor(sortedTemps.length / 2);
  const anchor = sortedTemps.length % 2
    ? sortedTemps[mid]
    : Math.round(((sortedTemps[mid - 1] + sortedTemps[mid]) / 2) * 10) / 10;
  const agreeing = peaks.filter((item) => Math.abs(item.peak.temp - anchor) <= 1);
  return { anchor, agreeing, total: peaks.length, min: sortedTemps[0], max: sortedTemps[sortedTemps.length - 1] };
}

function consensusTone(consensus) {
  if (!consensus || !consensus.total) return null;
  const ratio = consensus.agreeing.length / consensus.total;
  if (ratio >= 0.8) return { label: 'Strong agreement', borderColor: '#16a34a', color: '#4ade80' };
  if (ratio >= 0.5) return { label: 'Partial agreement', borderColor: '#ca8a04', color: '#facc15' };
  return { label: 'Low agreement', borderColor: '#7f1d1d', color: '#f87171' };
}

function buildMetarChangePoints(rows) {
  const series = (Array.isArray(rows) ? rows : [])
    .filter((row) => row && row.temp != null && Number.isFinite(row.hourFrac))
    .map((row) => ({ hourFrac: row.hourFrac, temp: row.temp, settled: row.settled }))
    .sort((a, b) => a.hourFrac - b.hourFrac);

  if (series.length < 2) return [];

  const tempAt = (frac) => {
    if (frac <= series[0].hourFrac) return series[0].temp;
    if (frac >= series[series.length - 1].hourFrac) return series[series.length - 1].temp;
    for (let i = 1; i < series.length; i += 1) {
      const left = series[i - 1];
      const right = series[i];
      if (frac <= right.hourFrac) {
        const span = Math.max(right.hourFrac - left.hourFrac, 1e-6);
        const t = (frac - left.hourFrac) / span;
        return left.temp + (right.temp - left.temp) * t;
      }
    }
    return series[series.length - 1].temp;
  };

  const start = Math.ceil(series[0].hourFrac * 2) / 2;
  const end = Math.floor(series[series.length - 1].hourFrac * 2) / 2;
  const points = [];
  let prevRounded = null;

  for (let frac = start; frac <= end + 1e-6; frac += 0.5) {
    const temp = tempAt(frac);
    const rounded = Math.round(temp);
    if (prevRounded === null) {
      prevRounded = rounded;
      continue;
    }
    if (rounded !== prevRounded) {
      const totalMinutes = Math.round(frac * 60);
      const hour = Math.floor(totalMinutes / 60) % 24;
      const minute = ((totalMinutes % 60) + 60) % 60;
      points.push({
        hourFrac: hour + minute / 60,
        temp,
        metarTemp: rounded,
        label: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      });
      prevRounded = rounded;
    }
  }

  return points;
}

function findMetarNearest(rows, targetTime) {
  if (!rows.length) return null;
  let best = rows[0];
  let bestD = Infinity;
  const target = targetTime.getTime();
  for (const row of rows) {
    const d = Math.abs(row.time.getTime() - target);
    if (d < bestD) {
      bestD = d;
      best = row;
    }
  }
  return best;
}

function AvgChart({ rows, nowMarker }) {
  if (!rows.length) return null;
  const validRows = rows.filter((row) => row.temp != null);
  if (!validRows.length) return null;

  const W = 860;
  const H = 240;
  const PAD = { top: 18, right: 18, bottom: 30, left: 44 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const yMin = Math.floor(Math.min(...validRows.map((row) => row.temp)) - 1);
  const yMax = Math.ceil(Math.max(...validRows.map((row) => row.temp)) + 1);
  const xScale = (i) => PAD.left + (i / Math.max(rows.length - 1, 1)) * innerW;
  const yScale = (temp) => PAD.top + innerH - ((temp - yMin) / Math.max(yMax - yMin, 1)) * innerH;
  const dayBreaks = rows.map((row, i) => (i > 0 && row.dateKey !== rows[i - 1].dateKey ? i : null)).filter((i) => i != null);
  const points = rows.map((row, i) => (row.temp != null ? `${xScale(i)},${yScale(row.temp)}` : null)).filter(Boolean).join(' ');

  return html`
    <div>
      <svg viewBox="0 0 ${W} ${H}" style=${{ width: '100%', display: 'block' }}>
        ${Array.from({ length: yMax - yMin + 1 }, (_, idx) => yMin + idx).map((value) => html`
          <g key=${value}>
            <line x1=${PAD.left} x2=${PAD.left + innerW} y1=${yScale(value)} y2=${yScale(value)} stroke="#16202f" stroke-width="1" />
            <text x=${PAD.left - 6} y=${yScale(value) + 4} text-anchor="end" font-size="9" fill="#425066">${value}°F</text>
          </g>
        `)}
        ${dayBreaks.map((i) => html`
          <line key=${`d-${i}`} x1=${xScale(i)} x2=${xScale(i)} y1=${PAD.top} y2=${PAD.top + innerH} stroke="#223046" stroke-width="1" stroke-dasharray="4 4" />
        `)}
        ${rows.map((row, i) => (i === 0 || row.dateKey !== rows[i - 1].dateKey) ? html`
          <text key=${`day-${row.dateKey}`} x=${xScale(i) + 6} y=${PAD.top + 10} font-size="9" fill="#64748b">${row.dayTitle}</text>
        ` : null)}
        ${rows.map((row, i) => i % 6 === 0 ? html`
          <text key=${`${row.dateKey}-${row.label}`} x=${xScale(i)} y=${H - 6} text-anchor="middle" font-size="9" fill="#4b5563">${row.label}</text>
        ` : null)}
        <polyline points=${points} fill="none" stroke="#f97316" stroke-width="2.5" />
        ${rows.map((row, i) => row.temp != null ? html`
          <circle key=${`${row.dateKey}-${row.label}-dot`} cx=${xScale(i)} cy=${yScale(row.temp)} r="3.5" fill="#f97316" stroke="#0c1017" stroke-width="2" />
        ` : null)}
        ${nowMarker ? html`
          <line x1=${xScale(nowMarker.index)} x2=${xScale(nowMarker.index)} y1=${PAD.top} y2=${PAD.top + innerH} stroke="#60a5fa" stroke-width="1.5" stroke-dasharray="5 4" />
        ` : null}
      </svg>
    </div>
  `;
}

function TodayOverlayChart({ modelRows, metarRows, nowMarker, modelLabel, trackLabel, modelColor, showRealMetar = true }) {
  const [hover, setHover] = useState(null);
  const [zoom, setZoom] = useState({ start: 0, end: 24 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef(null);

  if (!modelRows.length && !metarRows.length) return null;

  const validModelRows = modelRows
    .filter((row) => row && row.temp != null)
    .map((row) => ({ ...row, hourFrac: row.hour + (row.minute || 0) / 60 }))
    .sort((a, b) => a.hourFrac - b.hourFrac);
  const validMetarRows = metarRows
    .filter((row) => row && row.temp != null && Number.isFinite(row.hourFrac))
    .sort((a, b) => a.hourFrac - b.hourFrac);
  const validRows = [...validModelRows, ...validMetarRows];
  if (!validModelRows.length) return null;

  const W = 860;
  const H = 340;
  const PAD = { top: 18, right: 18, bottom: 34, left: 44 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const yMin = Math.floor(Math.min(...validRows.map((row) => row.temp)) - 1);
  const yMax = Math.ceil(Math.max(...validRows.map((row) => row.temp)) + 1);
  const dataMin = Math.min(...validModelRows.map((row) => row.hourFrac));
  const dataMax = Math.max(...validModelRows.map((row) => row.hourFrac));
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const viewStart = clamp(zoom.start, dataMin, Math.max(dataMax - 0.1, dataMin));
  const viewEnd = clamp(zoom.end, viewStart + 0.1, dataMax);
  const viewSpan = Math.max(viewEnd - viewStart, 0.1);
  const xScale = (frac) => PAD.left + ((frac - viewStart) / viewSpan) * innerW;
  const yScale = (temp) => PAD.top + innerH - ((temp - yMin) / Math.max(yMax - yMin, 1)) * innerH;
  const visibleModelRows = validModelRows.filter((row) => row.hourFrac >= viewStart - 0.5 && row.hourFrac <= viewEnd + 0.5);
  const visibleMetarRows = validMetarRows.filter((row) => row.hourFrac >= viewStart - 0.5 && row.hourFrac <= viewEnd + 0.5);
  const visibleMetarChangePoints = buildMetarChangePoints(validMetarRows).filter((pt) => pt.hourFrac >= viewStart - 0.5 && pt.hourFrac <= viewEnd + 0.5);
  const modelPoints = visibleModelRows.map((row) => `${xScale(row.hourFrac)},${yScale(row.temp)}`).join(' ');
  const metarPoints = visibleMetarRows.map((row) => `${xScale(row.hourFrac)},${yScale(row.temp)}`).join(' ');

  const formatClock = (hour) => {
    const totalMinutes = Math.round(hour * 60);
    const hh = String(Math.floor(((totalMinutes / 60) % 24 + 24) % 24)).padStart(2, '0');
    const mm = String(((totalMinutes % 60) + 60) % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  };

  const resetZoom = () => setZoom({ start: dataMin, end: dataMax });

  useEffect(() => {
    if (!dragging) return undefined;
    const prevUserSelect = document.body.style.userSelect;
    const prevWebkitUserSelect = document.body.style.webkitUserSelect;
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';

    const handleMove = (event) => {
      if (!dragRef.current) return;
      const { startX, start, end, width } = dragRef.current;
      const span = end - start;
      if (span >= (dataMax - dataMin) - 1e-6) return;
      const deltaHr = -((event.clientX - startX) / Math.max(width, 1)) * span;
      const nextStart = clamp(start + deltaHr, dataMin, dataMax - span);
      setZoom({ start: nextStart, end: nextStart + span });
    };

    const handleUp = () => {
      dragRef.current = null;
      setDragging(false);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      document.body.style.userSelect = prevUserSelect;
      document.body.style.webkitUserSelect = prevWebkitUserSelect;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [dragging, dataMax, dataMin]);

  const hoverModel = hover ? (() => {
    if (!validModelRows.length) return null;
    let best = validModelRows[0];
    let bestD = Infinity;
    validModelRows.forEach((row) => {
      const distance = Math.abs(row.hourFrac - hover.hour);
      if (distance < bestD) {
        bestD = distance;
        best = row;
      }
    });
    return best;
  })() : null;

  const hoverMetar = showRealMetar && hover ? (() => {
    if (!validMetarRows.length) return null;
    let best = validMetarRows[0];
    let bestD = Infinity;
    validMetarRows.forEach((row) => {
      const distance = Math.abs(row.hourFrac - hover.hour);
      if (distance < bestD) {
        bestD = distance;
        best = row;
      }
    });
    return best && bestD <= 0.8 ? best : null;
  })() : null;

  return html`
    <div>
      <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 10, flexWrap: 'wrap' }}>
        <div style=${{ fontSize: 10, color: '#64748b' }}>${trackLabel}</div>
        <div style=${{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick=${resetZoom} style=${S.modeBtn}>Reset Zoom</button>
        </div>
      </div>

      <div
        style=${{ position: 'relative', overflow: 'hidden', borderRadius: 8 }}
        onMouseLeave=${() => setHover(null)}
        onMouseMove=${(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const y = event.clientY - rect.top;
          const frac = viewStart + ((x - PAD.left) / innerW) * viewSpan;
          setHover({ hour: clamp(frac, viewStart, viewEnd), x, y, width: rect.width, height: rect.height });
        }}
        onWheel=${(event) => {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const center = viewStart + ((x - PAD.left) / innerW) * viewSpan;
          const zoomFactor = event.deltaY > 0 ? 1.18 : 0.84;
          const nextSpan = clamp(viewSpan * zoomFactor, 2, dataMax - dataMin);
          const nextStart = clamp(center - (((center - viewStart) / viewSpan) * nextSpan), dataMin, dataMax - nextSpan);
          setZoom({ start: nextStart, end: nextStart + nextSpan });
        }}
        onMouseDown=${(event) => {
          dragRef.current = { startX: event.clientX, start: viewStart, end: viewEnd, width: innerW };
          setDragging(true);
        }}
      >
        <svg viewBox="0 0 ${W} ${H}" style=${{ width: '100%', display: 'block', background: '#0c1017' }}>
          ${Array.from({ length: yMax - yMin + 1 }, (_, idx) => yMin + idx).map((value) => html`
            <g key=${value}>
              <line x1=${PAD.left} x2=${PAD.left + innerW} y1=${yScale(value)} y2=${yScale(value)} stroke="#16202f" stroke-width="1" />
              <text x=${PAD.left - 6} y=${yScale(value) + 4} text-anchor="end" font-size="9" fill="#425066">${value}°F</text>
            </g>
          `)}
          ${Array.from({ length: 25 }, (_, hour) => hour).filter((hour) => hour % 2 === 0).map((hour) => {
            const visible = hour >= viewStart && hour <= viewEnd;
            return visible ? html`
              <g key=${hour}>
                <line x1=${xScale(hour)} x2=${xScale(hour)} y1=${PAD.top} y2=${PAD.top + innerH} stroke="#16202f" stroke-width="1" />
                <text x=${xScale(hour)} y=${H - 6} text-anchor="middle" font-size="9" fill="#4b5563">${String(hour).padStart(2, '0')}:00</text>
              </g>
            ` : null;
          })}
          ${visibleMetarChangePoints.map((point) => html`
            <g key=${point.label}>
              <line x1=${xScale(point.hourFrac)} x2=${xScale(point.hourFrac)} y1=${PAD.top} y2=${PAD.top + innerH} stroke="rgba(148,163,184,0.18)" stroke-width="1" stroke-dasharray="4 4" />
              <text x=${xScale(point.hourFrac)} y=${PAD.top + 12} text-anchor="middle" font-size="9" fill="#94a3b8">${point.metarTemp}F</text>
            </g>
          `)}
          <polyline points=${modelPoints} fill="none" stroke=${modelColor} stroke-width="2.5" />
          ${showRealMetar && visibleMetarRows.length ? html`<polyline points=${metarPoints} fill="none" stroke="#94a3b8" stroke-width="2.2" stroke-dasharray="6 4" />` : null}
          ${visibleModelRows.map((row, index) => html`
            <circle key=${`${row.label}-${index}`} cx=${xScale(row.hourFrac)} cy=${yScale(row.temp)} r="3.5" fill=${modelColor} stroke="#0c1017" stroke-width="2" />
          `)}
          ${showRealMetar ? visibleMetarRows.map((row, index) => html`
            <circle key=${`m-${index}`} cx=${xScale(row.hourFrac)} cy=${yScale(row.temp)} r="3.2" fill="#94a3b8" stroke="#0c1017" stroke-width="2" />
          `) : null}
          ${hover ? html`
            <line x1=${xScale(hover.hour)} x2=${xScale(hover.hour)} y1=${PAD.top} y2=${PAD.top + innerH} stroke="#fbbf24" stroke-width="1.2" stroke-dasharray="4 4" opacity="0.7" />
          ` : null}
          ${hoverModel ? html`
            <circle cx=${xScale(hoverModel.hourFrac)} cy=${yScale(hoverModel.temp)} r="5" fill=${modelColor} stroke="#f8fafc" stroke-width="2" />
          ` : null}
          ${hoverMetar ? html`
            <circle cx=${xScale(hoverMetar.hourFrac)} cy=${yScale(hoverMetar.temp)} r="5" fill="#94a3b8" stroke="#f8fafc" stroke-width="2" />
          ` : null}
          ${nowMarker ? html`
            <line x1=${xScale(nowMarker.index)} x2=${xScale(nowMarker.index)} y1=${PAD.top} y2=${PAD.top + innerH} stroke="#60a5fa" stroke-width="1.5" stroke-dasharray="5 4" />
          ` : null}
        </svg>

        ${hover && hoverModel ? html`
          <div style=${{
            position: 'absolute',
            left: clamp(hover.x + 14, 10, Math.max(hover.width - 196, 10)),
            top: clamp(hover.y - 70, 10, Math.max(hover.height - 108, 10)),
            minWidth: 170,
            background: 'rgba(12,16,23,0.96)',
            border: '1px solid #243040',
            borderRadius: 8,
            padding: '8px 10px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
            pointerEvents: 'none',
            zIndex: 5,
          }}>
            <div style=${{ fontSize: 10, color: '#94a3b8', marginBottom: 4 }}>${trackLabel}</div>
            <div style=${{ fontSize: 12, color: '#f8fafc', fontWeight: 600 }}>${formatClock(hover.hour)}</div>
            <div style=${{ marginTop: 4, fontSize: 12, color: modelColor }}>${modelLabel}: ${formatTemp(hoverModel.temp)}</div>
            ${hoverMetar ? html`<div style=${{ marginTop: 2, fontSize: 11, color: '#cbd5e1' }}>METAR: ${formatTemp(hoverMetar.temp)} · settle ${hoverMetar.settled}F</div>` : null}
          </div>
        ` : null}
      </div>
    </div>
  `;
}

async function fetchEventBySlug(slug) {
  const direct = await fetch(`/api/gamma/events/slug/${encodeURIComponent(slug)}`);
  if (direct.ok) return direct.json();
  const legacy = await fetch(`/api/gamma/events?slug=${encodeURIComponent(slug)}`);
  if (!legacy.ok) return null;
  const rows = await legacy.json();
  return rows[0] ?? null;
}

async function fetchLastTrades(markets) {
  if (!markets.length) return new Map();
  const response = await fetch('/api/clob/last-trades-prices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(markets.map((market) => ({ token_id: market.yesTokenId }))),
  });
  if (!response.ok) return new Map();
  const rows = await response.json();
  return new Map((Array.isArray(rows) ? rows : []).map((row) => [row.token_id, parseFloat(row.price)]));
}

async function loadSource(city, source) {
  const response = await fetch(source.buildUrl(city));
  if (!response.ok) throw new Error(`${source.label} HTTP ${response.status}`);
  const json = await response.json();
  return {
    rows: parseModelData(json.hourly || {}, city.timezone),
    daily: parseDailyRows(json.daily || {}),
  };
}

async function loadCity(city) {
  const now = cityNowParts(city.timezone);
  const dateKey = now.dateKey;
  const [year, month, day] = dateKey.split('-').map(Number);
  const monthName = new Intl.DateTimeFormat('en-US', { timeZone: city.timezone, month: 'long' })
    .format(new Date(Date.UTC(year, month - 1, day, 12)))
    .toLowerCase();
  const slug = `${city.slugPrefix}-${monthName}-${day}-${year}`;

  const [sourceSettled, metarRes, event] = await Promise.all([
    Promise.allSettled(SOURCES.map((source) => loadSource(city, source))),
    fetch(`/api/metar?station=${city.station}`).catch(() => null),
    fetchEventBySlug(slug).catch(() => null),
  ]);

  const rowsBySource = {};
  const dailyBySource = {};
  sourceSettled.forEach((result, index) => {
    const source = SOURCES[index];
    if (result.status === 'fulfilled') {
      rowsBySource[source.id] = result.value.rows.map((row) => ({ ...row, dayTitle: dayTitle(row.dateKey) }));
      dailyBySource[source.id] = result.value.daily;
    } else {
      rowsBySource[source.id] = [];
      dailyBySource[source.id] = [];
    }
  });

  const referenceRows = SOURCES.map((source) => rowsBySource[source.id]).find((rows) => rows.length) || [];
  const avgSeries = buildAverageSeries(referenceRows, rowsBySource);
  const dayKeys = Array.from(new Set(referenceRows.map((row) => row.dateKey))).slice(0, 3);

  const metarRaw = metarRes && metarRes.ok ? await metarRes.json() : [];
  const metarRows = parseMetarRows(metarRaw, city);
  const latestMetar = metarRows[metarRows.length - 1] || null;
  const metarPeak = metarRows.length ? Math.max(...metarRows.map((row) => row.settled)) : null;

  const marketRows = (event?.markets || [])
    .map((market) => {
      const tokenIds = JSON.parse(market.clobTokenIds || '[]');
      const outcomePrices = JSON.parse(market.outcomePrices || '[]');
      return {
        id: market.id,
        label: market.groupItemTitle,
        threshold: Number(market.groupItemThreshold),
        yesTokenId: tokenIds[0],
        impliedYes: parseFloat(outcomePrices[0]),
      };
    })
    .filter((market) => market.yesTokenId)
    .sort((a, b) => a.threshold - b.threshold);

  const lastTrades = await fetchLastTrades(marketRows).catch(() => new Map());
  const markets = marketRows.map((market) => ({
    ...market,
    lastTrade: lastTrades.get(market.yesTokenId) ?? market.impliedYes ?? null,
  }));

  const dailyCards = dayKeys.map((dateKey) => {
    const peaks = SOURCES.map((source) => ({
      source,
      peak: modelPeak((rowsBySource[source.id] || []).filter((row) => row.dateKey === dateKey)),
    })).filter((item) => item.peak);

    const consensus = buildConsensus(peaks);
    const avgPeak = modelPeak(avgSeries.filter((row) => row.dateKey === dateKey));
    const metarNearest = avgPeak && metarRows.length
      ? findMetarNearest(metarRows, new Date(`${dateKey}T${avgPeak.label}:00`))
      : null;

    return {
      dateKey,
      title: dayTitle(dateKey),
      peaks,
      consensus,
      consensusTone: consensusTone(consensus),
      avgPeak,
      metarNearest,
    };
  });

  return {
    ...city,
    dateKey,
    title: event?.title || slug,
    rowsBySource,
    dailyBySource,
    avgSeries,
    metarRows,
    latestMetar,
    metarPeak,
    markets,
    dailyCards,
    now,
  };
}

function navLink(href, label, active) {
  return html`
    <a href=${href} style=${{
      color: active ? '#93c5fd' : '#4b5563',
      fontSize: 10,
      textDecoration: 'none',
      border: `1px solid ${active ? '#2563eb' : '#1a2030'}`,
      padding: '4px 10px',
      borderRadius: 4,
      background: active ? '#1a2540' : 'transparent',
    }}>${label}</a>
  `;
}

function CitySection({ cityState }) {
  const [showRealMetar, setShowRealMetar] = useState(true);
  const [todayMode, setTodayMode] = useState('average');

  const nowParts = cityNowParts(cityState.timezone);
  const todayAvgSeries = cityState.avgSeries.filter((row) => row.dateKey === nowParts.dateKey);
  const currentSource = SOURCES.find((source) => source.id === todayMode);
  const currentSourceRows = currentSource
    ? (cityState.rowsBySource[currentSource.id] || []).filter((row) => row.dateKey === nowParts.dateKey)
    : [];
  const selectedTodayRows = todayMode === 'average' ? todayAvgSeries : (currentSourceRows.length ? currentSourceRows : todayAvgSeries);
  const selectedTodayLabel = todayMode === 'average' ? 'Average' : (currentSource ? currentSource.label : 'Average');
  const selectedTodayTrack = todayMode === 'average' ? 'AVERAGE TRACK' : `${selectedTodayLabel.toUpperCase()} TRACK`;
  const selectedTodayColor = todayMode === 'average' ? '#f97316' : (currentSource ? currentSource.color : '#f97316');
  const selectedStartIdx = selectedTodayRows.findIndex((row) => row.hour === nowParts.hour);
  const selectedNowMarker = selectedStartIdx >= 0 ? { index: selectedStartIdx + nowParts.minute / 60, label: nowParts.timeLabel } : null;
  const nowStartIdx = cityState.avgSeries.findIndex((row) => row.dateKey === nowParts.dateKey && row.hour === nowParts.hour);
  const nowMarker = nowStartIdx >= 0 ? { index: nowStartIdx + nowParts.minute / 60, label: nowParts.timeLabel } : null;

  return html`
    <section style=${S.cityWrap}>
      <div style=${S.header}>
        <div>
          <div style=${S.h1}>${cityState.name.toUpperCase()} FORECAST</div>
        </div>
        <div style=${S.cityMeta}>
          <div>${cityState.now.timeLabel} local</div>
          <div>${cityState.latestMetar ? `METAR ${cityState.latestMetar.label}` : 'No METAR yet'}</div>
        </div>
      </div>

      <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8, marginBottom: 14 }}>
        ${cityState.dailyCards.map((day) => html`
          <div key=${day.dateKey} style=${S.kpi}>
            <div style=${S.kpiLabel}>${day.title.toUpperCase()}</div>
            <div style=${{ ...S.kpiVal, color: '#f97316' }}>${day.avgPeak ? formatTemp(day.avgPeak.temp) : '—'}</div>
            <div style=${S.kpiSub}>average peak at ${day.avgPeak ? day.avgPeak.label : '—'}</div>
          </div>
        `)}
        <div style=${S.kpi}>
          <div style=${S.kpiLabel}>LATEST SETTLEMENT</div>
          <div style=${{ ...S.kpiVal, color: '#60a5fa' }}>${cityState.latestMetar ? `${cityState.latestMetar.settled}F` : '—'}</div>
          <div style=${S.kpiSub}>${cityState.latestMetar ? `${formatTemp(cityState.latestMetar.temp)} exact METAR` : 'Waiting for METAR'}</div>
        </div>
      </div>

      <div style=${{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.55fr) minmax(300px, 1fr)', gap: 8, marginBottom: 14 }}>
        <div style=${{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style=${S.card}>
            <div style=${S.cardTitle}>AVERAGE TRACK</div>
            <${AvgChart} rows=${cityState.avgSeries} nowMarker=${nowMarker} />
          </div>

          <div style=${S.card}>
            <div style=${S.cardTitle}>TODAY TRACK</div>
            <div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
              <div style=${{ fontSize: 10, color: '#64748b' }}>Today only</div>
              <div style=${{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button onClick=${() => setShowRealMetar((v) => !v)} style=${{ ...S.modeBtn, ...(showRealMetar ? S.modeBtnActive : {}) }}>Real METAR</button>
                <button onClick=${() => setTodayMode('average')} style=${{ ...S.modeBtn, ...(todayMode === 'average' ? S.modeBtnActive : {}) }}>Average</button>
                ${SOURCES.map((source) => html`
                  <button
                    key=${source.id}
                    onClick=${() => setTodayMode(source.id)}
                    style=${{
                      ...S.modeBtn,
                      ...(todayMode === source.id ? { ...S.modeBtnActive, borderColor: source.color, color: source.color } : {}),
                    }}
                  >
                    ${source.label}
                  </button>
                `)}
              </div>
            </div>
            <${TodayOverlayChart}
              modelRows=${selectedTodayRows}
              metarRows=${cityState.metarRows}
              nowMarker=${selectedNowMarker}
              modelLabel=${selectedTodayLabel}
              trackLabel=${selectedTodayTrack}
              modelColor=${selectedTodayColor}
              showRealMetar=${showRealMetar}
            />
          </div>
        </div>

        <div style=${S.card}>
          <div style=${S.cardTitle}>CONSENSUS · 3 DAYS</div>
          <div style=${{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            ${cityState.dailyCards.map((day) => html`
              <div key=${day.dateKey} style=${S.dayConsensusCard}>
                <div style=${S.dayConsensusHeader}>
                  <span style=${{ color: '#e2e8f0', fontWeight: 700 }}>${day.title}</span>
                </div>
                <div style=${S.consensusBig}>${day.consensus ? `${day.consensus.agreeing.length}/${day.consensus.total}` : '—'}</div>
                <div style=${{ ...S.consensusPill, borderColor: day.consensusTone ? day.consensusTone.borderColor : '#1a2030', color: day.consensusTone ? day.consensusTone.color : '#94a3b8' }}>
                  ${day.consensusTone ? day.consensusTone.label : 'No signal'}
                </div>
                <div style=${{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  ${day.peaks.map(({ source, peak }) => {
                    const agrees = day.consensus ? Math.abs(peak.temp - day.consensus.anchor) <= 1 : false;
                    return html`
                      <div key=${source.id} style=${S.consensusRow}>
                        <span style=${{ color: source.color, fontWeight: 700, minWidth: 92, flexShrink: 0 }}>${source.label}</span>
                        <span style=${{ color: agrees ? '#4ade80' : '#94a3b8', textAlign: 'right' }}>${formatTemp(peak.temp)} at ${peak.label}${agrees ? ' · agree' : ''}</span>
                      </div>
                    `;
                  })}
                </div>
                <div style=${{ marginTop: 10, fontSize: 10, color: '#4b5563' }}>
                  ${day.consensus ? `Spread ${formatTemp(day.consensus.min)} to ${formatTemp(day.consensus.max)}${day.metarNearest ? ` · nearest METAR ${formatIntTemp(day.metarNearest.settled)} at ${day.metarNearest.label}` : ''}` : ''}
                </div>
              </div>
            `)}
          </div>
        </div>
      </div>

      <div style=${S.card}>
        <div style=${S.cardTitle}>POLYMARKET LADDER</div>
        <div style=${{ display: 'grid', gap: 6 }}>
          ${cityState.markets.map((market) => html`
            <div key=${market.id} style=${S.marketRow}>
              <span style=${{ color: '#e2e8f0' }}>${market.label}</span>
              <span style=${{ color: '#60a5fa', textAlign: 'right' }}>${pct(market.impliedYes)}</span>
              <span style=${{ color: '#94a3b8', textAlign: 'right' }}>${market.lastTrade != null ? pct(market.lastTrade) : '—'}</span>
            </div>
          `)}
          ${!cityState.markets.length ? html`<div style=${{ color: '#64748b', fontSize: 11 }}>No market data.</div>` : null}
        </div>
      </div>

      <div style=${{ textAlign: 'center', fontSize: 9, color: '#1e293b', marginTop: 10 }}>
        ${cityState.title}
      </div>
    </section>
  `;
}

function App() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastFetch, setLastFetch] = useState(null);
  const [cities, setCities] = useState([]);

  const doFetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const settled = await Promise.allSettled(CITIES.map((city) => loadCity(city)));
      const loaded = settled.map((item, index) => (
        item.status === 'fulfilled'
          ? item.value
          : { ...CITIES[index], error: item.reason?.message || 'Fetch failed' }
      ));
      setCities(loaded);
      setLastFetch(new Date());
      if (loaded.every((city) => city.error)) {
        setError('Failed to load USA forecast data');
      }
    } catch (e) {
      setError(e.message || 'Fetch failed');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    doFetch();
    const id = setInterval(doFetch, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [doFetch]);

  if (loading && !cities.length) {
    return html`<div style=${S.wrap}><div style=${S.loading}>Loading USA forecast...</div></div>`;
  }

  if (error && !cities.length) {
    return html`
      <div style=${S.wrap}>
        <div style=${S.errBox}>
          <div style=${{ fontSize: 14, marginBottom: 8 }}>Failed to load USA forecast data</div>
          <div style=${{ fontSize: 11, color: '#94a3b8', marginBottom: 10 }}>${error}</div>
          <button onClick=${doFetch} style=${S.retryBtn}>Retry</button>
        </div>
      </div>
    `;
  }

  return html`
    <div style=${S.wrap}>
      <div style=${{ display: 'flex', gap: 8, marginBottom: 16, paddingBottom: 10, borderBottom: '1px solid #1a2030', flexWrap: 'wrap' }}>
        ${navLink('/', 'Polydash', false)}
        ${navLink('/weth/beijing-forecast.html', 'Beijing Forecast', false)}
        ${navLink('/weth/forecast.html', 'London Forecast', false)}
        ${navLink('/weth/paris-forecast.html', 'Paris Forecast', false)}
        ${navLink('/weth/usa-forecast.html', 'USA Forecast', true)}
      </div>

      <div style=${S.topHeader}>
        <div>
          <div style=${S.h1}>USA FORECAST</div>
          <div style=${S.sub}>Two-city page rebuilt on the same design and interaction model as the London/Paris forecast pages.</div>
        </div>
        <button onClick=${doFetch} style=${S.refreshBtn}>↻</button>
      </div>

      <div style=${{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        ${cities.map((city) => city.error
          ? html`<div key=${city.id} style=${S.errBox}>${city.name}: ${city.error}</div>`
          : html`<${CitySection} key=${city.id} cityState=${city} />`)}
      </div>

      <div style=${{ textAlign: 'center', fontSize: 9, color: '#1e293b', marginTop: 10 }}>
        ${lastFetch ? `Updated: ${lastFetch.toLocaleTimeString('en-GB')} USA` : ''}
        ${error ? ` · Last refresh error: ${error}` : ''}
      </div>
    </div>
  `;
}

const S = {
  wrap: { fontFamily: "'IBM Plex Mono','Courier New',monospace", background: '#0c1017', color: '#8b95a5', minHeight: '100vh', padding: 16, boxSizing: 'border-box' },
  topHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 },
  cityWrap: { background: '#0f141e', border: '1px solid #1a2030', borderRadius: 9, padding: 14 },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' },
  h1: { fontSize: 17, fontWeight: 700, color: '#e8ecf1', letterSpacing: 2 },
  sub: { fontSize: 10, color: '#3e4a5c', marginTop: 2, maxWidth: 760, lineHeight: 1.5 },
  cityMeta: { textAlign: 'right', fontSize: 10, color: '#64748b', lineHeight: 1.6 },
  refreshBtn: { background: '#10141e', border: '1px solid #1a2030', color: '#64748b', width: 36, height: 36, borderRadius: 6, cursor: 'pointer', fontSize: 16, fontFamily: 'inherit' },
  card: { background: '#10141e', border: '1px solid #1a2030', borderRadius: 7, padding: 14, marginBottom: 12 },
  cardTitle: { fontSize: 9, fontWeight: 700, color: '#3e4a5c', letterSpacing: 1.5, marginBottom: 10 },
  kpi: { background: '#10141e', border: '1px solid #1a2030', borderRadius: 7, padding: 10, textAlign: 'center' },
  kpiLabel: { fontSize: 8, fontWeight: 700, color: '#3e4a5c', letterSpacing: 1, marginBottom: 4 },
  kpiVal: { fontSize: 22, fontWeight: 700, color: '#e2e8f0' },
  kpiSub: { fontSize: 9, color: '#4b5563', marginTop: 2 },
  consensusBig: { fontSize: 32, lineHeight: 1, fontWeight: 700, color: '#e2e8f0', marginBottom: 8 },
  consensusSub: { fontSize: 10, color: '#94a3b8' },
  consensusPill: { display: 'inline-block', marginTop: 10, border: '1px solid #1a2030', borderRadius: 999, padding: '5px 10px', fontSize: 10, fontWeight: 700 },
  dayConsensusCard: { border: '1px solid #16202f', borderRadius: 8, padding: 12, background: '#0c1017' },
  dayConsensusHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 },
  consensusRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 11 },
  marketRow: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 80px 80px', gap: 10, alignItems: 'center', fontSize: 11, padding: '6px 0', borderBottom: '1px solid #16202f' },
  loading: { padding: 40, textAlign: 'center', color: '#4b5563', fontSize: 13 },
  errBox: { background: '#10141e', border: '1px solid #5c1a1a', borderRadius: 7, padding: 20, textAlign: 'center', color: '#f87171', marginTop: 12 },
  retryBtn: { background: '#1a0a0a', border: '1px solid #7f1d1d', color: '#f87171', padding: '8px 16px', borderRadius: 5, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' },
  modeBtn: { background: '#10141e', border: '1px solid #1a2030', color: '#64748b', padding: '5px 10px', borderRadius: 999, cursor: 'pointer', fontSize: 10, fontFamily: 'inherit' },
  modeBtnActive: { background: '#172033', borderColor: '#2563eb', color: '#93c5fd' },
};

render(html`<${App} />`, document.getElementById('root'));
