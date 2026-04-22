    const { h, render } = preact;
    const { useState, useEffect, useCallback, useRef } = preactHooks;
    const html = htm.bind(h);

    const LAT = 51.5053;
    const LON = 0.0553;
    const TZ = 'Europe/London';
    const STATION = 'EGLC';
    const HOURLY_VARS = 'temperature_2m,wind_speed_10m,cloud_cover,precipitation_probability';
    const DAILY_VARS = 'sunrise,sunset';

    const MODELS = [
      { id: 'ukmo_uk_deterministic_2km', label: 'UKV 2km', color: '#60a5fa', note: 'UK Met Office local high-res' },
      { id: 'ecmwf_ifs025', label: 'ECMWF IFS', color: '#34d399', note: 'ECMWF 0.25° global' },
      { id: 'icon_eu', label: 'ICON-EU', color: '#f97316', note: 'DWD Europe 7km' },
    ];

    function londonNowParts(date = new Date()) {
      return {
        dateKey: date.toLocaleDateString('en-CA', { timeZone: TZ }),
        timeLabel: date.toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }),
        hour: parseInt(date.toLocaleString('en-GB', { timeZone: TZ, hour: 'numeric', hour12: false }), 10),
        minute: parseInt(date.toLocaleString('en-GB', { timeZone: TZ, minute: 'numeric' }), 10)
      };
    }

    function dayTitle(dateKey) {
      const parts = dateKey.split('-');
      if (parts.length !== 3) return dateKey;
      return `${parts[2]}.${parts[1]}`;
    }

    function calcBias(wind, cloud, isDay, hour) {
      let bias = 0.6;
      if (isDay) {
        const sf = Math.max(0, (100 - cloud) / 100);
        const wd = Math.max(0.2, 1 - wind / 25);
        bias += sf * wd * 1.8;
      } else {
        bias += Math.max(0, (100 - cloud) / 100) * 0.8;
      }
      if (wind > 15) bias -= 0.4;
      if (cloud > 80) bias -= 0.3;
      if (isDay && hour >= 12 && hour <= 16 && cloud < 50) bias += 0.4;
      bias += 0.3;
      return Math.round(Math.max(0, Math.min(bias, 4)) * 10) / 10;
    }

    function buildDaylightMap(daily) {
      const times = daily && daily.time ? daily.time : [];
      const sunrise = daily && daily.sunrise ? daily.sunrise : [];
      const sunset = daily && daily.sunset ? daily.sunset : [];
      const map = {};
      times.forEach((dateKey, i) => {
        const sunriseH = sunrise[i] ? parseInt(String(sunrise[i]).slice(11, 13), 10) : 6;
        const sunsetH = sunset[i] ? parseInt(String(sunset[i]).slice(11, 13), 10) : 19;
        map[dateKey] = { sunriseH, sunsetH };
      });
      return map;
    }

    function parseModelData(hourly, modelId) {
      const times = hourly.time || [];
      const temps = hourly[`temperature_2m_${modelId}`] || hourly.temperature_2m || [];
      const winds = hourly[`wind_speed_10m_${modelId}`] || hourly.wind_speed_10m || [];
      const clouds = hourly[`cloud_cover_${modelId}`] || hourly.cloud_cover || [];
      const pops = hourly[`precipitation_probability_${modelId}`] || hourly.precipitation_probability || [];
      return times.map((time, i) => ({
        dateKey: time.slice(0, 10),
        hour: parseInt(time.slice(11, 13), 10),
        label: time.slice(11, 16),
        temp: temps[i] ?? null,
        wind: winds[i] ?? null,
        cloud: clouds[i] ?? null,
        pop: pops[i] ?? null
      }));
    }

    function modelPeak(rows) {
      const validRows = rows.filter(row => row && row.temp != null);
      if (!validRows.length) return null;
      return validRows.reduce((max, row) => row.temp > max.temp ? row : max, validRows[0]);
    }

    function buildAverageSeries(referenceRows, rowsByModel) {
      return referenceRows.map((row, i) => {
        const sourceRows = MODELS.map(model => (rowsByModel[model.id] || [])[i]).filter(Boolean);
        const temps = sourceRows.map(row => row.temp).filter(temp => temp != null);
        const winds = sourceRows.map(row => row.wind).filter(wind => wind != null);
        const clouds = sourceRows.map(row => row.cloud).filter(cloud => cloud != null);
        const pops = sourceRows.map(row => row.pop).filter(pop => pop != null);
        return {
          dateKey: row.dateKey,
          hour: row.hour,
          label: row.label,
          temp: temps.length ? Math.round((temps.reduce((sum, temp) => sum + temp, 0) / temps.length) * 10) / 10 : null,
          wind: winds.length ? Math.round((winds.reduce((sum, wind) => sum + wind, 0) / winds.length) * 10) / 10 : null,
          cloud: clouds.length ? Math.round((clouds.reduce((sum, cloud) => sum + cloud, 0) / clouds.length) * 10) / 10 : null,
          pop: pops.length ? Math.round((pops.reduce((sum, pop) => sum + pop, 0) / pops.length) * 10) / 10 : null,
          count: temps.length
        };
      });
    }

    function attachBias(rows, daylightMap) {
      return (Array.isArray(rows) ? rows : []).map(row => {
        const daylight = daylightMap[row.dateKey] || { sunriseH: 6, sunsetH: 19 };
        const isDay = row.hour >= daylight.sunriseH && row.hour < daylight.sunsetH;
        const wind = row.wind ?? 0;
        const cloud = row.cloud ?? 0;
        const bias = calcBias(wind, cloud, isDay, row.hour);
        return {
          ...row,
          isDay,
          bias,
          corrected: row.temp != null ? Math.round((row.temp + bias) * 10) / 10 : null,
        };
      });
    }

    function buildConsensus(peaks) {
      if (!peaks.length) return null;
      const sortedTemps = peaks.map(item => item.peak.temp).slice().sort((a, b) => a - b);
      const mid = Math.floor(sortedTemps.length / 2);
      const anchor = sortedTemps.length % 2
        ? sortedTemps[mid]
        : Math.round(((sortedTemps[mid - 1] + sortedTemps[mid]) / 2) * 10) / 10;
      const agreeing = peaks.filter(item => Math.abs(item.peak.temp - anchor) <= 1);
      return { anchor, agreeing, total: peaks.length, min: sortedTemps[0], max: sortedTemps[sortedTemps.length - 1] };
    }

    function consensusTone(consensus) {
      if (!consensus || !consensus.total) return null;
      const ratio = consensus.agreeing.length / consensus.total;
      if (ratio >= 0.8) return { label: 'Strong agreement', borderColor: '#16a34a', color: '#4ade80' };
      if (ratio >= 0.5) return { label: 'Partial agreement', borderColor: '#ca8a04', color: '#facc15' };
      return { label: 'Low agreement', borderColor: '#7f1d1d', color: '#f87171' };
    }

    function parseMetarRows(raw) {
      const obs = (Array.isArray(raw) ? raw : [])
        .filter(r => r && r.temp != null && r.reportTime)
        .map(r => ({
          time: new Date(r.reportTime),
          temp: Number(r.temp),
        }))
        .filter(r => Number.isFinite(r.temp) && !Number.isNaN(r.time.getTime()))
        .sort((a, b) => a.time - b.time);
      const todayKey = londonNowParts().dateKey;
      return obs
        .map(row => {
          const parts = londonNowParts(row.time);
          return {
            ...row,
            dateKey: parts.dateKey,
            hour: parts.hour,
            minute: parts.minute,
            hourFrac: parts.hour + parts.minute / 60,
            label: parts.timeLabel,
          };
        })
        .filter(row => row.dateKey === todayKey);
    }

    function buildModelChangePoints(modelRows) {
      const modelRound = v => (v >= 0 ? Math.floor(v + 0.5) : Math.ceil(v - 0.5));
      const modelSeries = (Array.isArray(modelRows) ? modelRows : [])
        .filter(row => row && row.temp != null && Number.isFinite(row.hourFrac))
        .map(row => ({
          hourFrac: row.hourFrac,
          temp: row.temp,
          bias: row.bias ?? 0,
          corrected: row.corrected ?? row.temp,
        }))
        .sort((a, b) => a.hourFrac - b.hourFrac);

      if (modelSeries.length < 2) return [];

      const valueAt = frac => {
        if (frac <= modelSeries[0].hourFrac) return modelSeries[0];
        if (frac >= modelSeries[modelSeries.length - 1].hourFrac) return modelSeries[modelSeries.length - 1];
        for (let i = 1; i < modelSeries.length; i += 1) {
          const left = modelSeries[i - 1];
          const right = modelSeries[i];
          if (frac <= right.hourFrac) {
            const span = Math.max(right.hourFrac - left.hourFrac, 1e-6);
            const t = (frac - left.hourFrac) / span;
            return {
              hourFrac: frac,
              temp: left.temp + (right.temp - left.temp) * t,
              bias: (left.bias ?? 0) + (((right.bias ?? 0) - (left.bias ?? 0)) * t),
              corrected: (left.corrected ?? left.temp) + (((right.corrected ?? right.temp) - (left.corrected ?? left.temp)) * t),
            };
          }
        }
        return modelSeries[modelSeries.length - 1];
      };

      const checkpoints = [];
      const startMinutes = Math.ceil(modelSeries[0].hourFrac * 60);
      const endMinutes = Math.floor(modelSeries[modelSeries.length - 1].hourFrac * 60);
      for (let hour = Math.floor(startMinutes / 60); hour <= Math.ceil(endMinutes / 60); hour += 1) {
        [20, 50].forEach(minute => {
          const totalMinutes = hour * 60 + minute;
          if (totalMinutes < startMinutes || totalMinutes > endMinutes) return;
          checkpoints.push(totalMinutes / 60);
        });
      }

      if (!checkpoints.length) return [];

      const points = [];
      let prevRounded = modelRound(valueAt(checkpoints[0]).corrected);

      for (let i = 1; i < checkpoints.length; i += 1) {
        const row = valueAt(checkpoints[i]);
        const rounded = modelRound(row.corrected);
        if (rounded === prevRounded) {
          continue;
        }
        const totalMinutes = Math.round(row.hourFrac * 60);
        const hour = Math.floor(totalMinutes / 60) % 24;
        const minute = ((totalMinutes % 60) + 60) % 60;
        points.push({
          hourFrac: row.hourFrac,
          temp: row.temp,
          bias: row.bias ?? 0,
          corrected: row.corrected ?? row.temp,
          modelTemp: rounded,
          label: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
        });
        prevRounded = rounded;
      }

      return points;
    }

    function AvgChart({ rows, nowMarker }) {
      if (!rows.length) return null;
      const validRows = rows.filter(row => row.temp != null);
      if (!validRows.length) return null;

      const W = 860;
      const H = 240;
      const PAD = { top: 18, right: 18, bottom: 30, left: 38 };
      const innerW = W - PAD.left - PAD.right;
      const innerH = H - PAD.top - PAD.bottom;
      const yMin = Math.floor(Math.min(...validRows.map(row => row.temp)) - 1);
      const yMax = Math.ceil(Math.max(...validRows.map(row => row.temp)) + 1);
      const xScale = i => PAD.left + (i / Math.max(rows.length - 1, 1)) * innerW;
      const yScale = temp => PAD.top + innerH - ((temp - yMin) / Math.max(yMax - yMin, 1)) * innerH;
      const dayBreaks = rows.map((row, i) => i > 0 && row.dateKey !== rows[i - 1].dateKey ? i : null).filter(i => i != null);
      const points = rows.map((row, i) => row.temp != null ? `${xScale(i)},${yScale(row.temp)}` : null).filter(Boolean).join(' ');

      return html`
        <div>
          <svg viewBox="0 0 ${W} ${H}" style=${{ width: '100%', display: 'block' }}>
            ${Array.from({ length: yMax - yMin + 1 }, (_, idx) => yMin + idx).map(value => html`
              <g key=${value}>
                <line x1=${PAD.left} x2=${PAD.left + innerW} y1=${yScale(value)} y2=${yScale(value)} stroke="#16202f" stroke-width="1" />
                <text x=${PAD.left - 6} y=${yScale(value) + 4} text-anchor="end" font-size="9" fill="#425066">${value}°C</text>
              </g>
            `)}
            ${dayBreaks.map(i => html`
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
              <g>
                <line x1=${xScale(nowMarker.index)} x2=${xScale(nowMarker.index)} y1=${PAD.top} y2=${PAD.top + innerH} stroke="#60a5fa" stroke-width="1.5" stroke-dasharray="5 4" />
              </g>
            ` : null}
          </svg>
        </div>
      `;
    }

    function TodayOverlayChart({ modelRows, metarRows, nowMarker, modelLabel, trackLabel, modelColor, showRealMetar = true, showBias = true }) {
      const [hover, setHover] = useState(null);
      const [zoom, setZoom] = useState({ start: 0, end: 24 });
      const [dragging, setDragging] = useState(false);
      const dragRef = useRef(null);

      if (!modelRows.length && !metarRows.length) return null;

      const validModelRows = modelRows
        .filter(row => row && row.temp != null)
        .map(row => ({ ...row, hourFrac: row.hour + (row.minute || 0) / 60 }));
      const validMetarRows = metarRows
        .filter(row => row && row.temp != null && Number.isFinite(row.hourFrac));
      const validCorrectedRows = validModelRows.filter(row => row.corrected != null).map(row => ({ ...row, temp: row.corrected }));
      const plottedRows = showBias ? validCorrectedRows : validModelRows;
      const validRows = [...validModelRows, ...(showBias ? validCorrectedRows : []), ...validMetarRows];
      if (!validModelRows.length) return null;

      const W = 860;
      const H = 340;
      const PAD = { top: 18, right: 18, bottom: 34, left: 38 };
      const innerW = W - PAD.left - PAD.right;
      const innerH = H - PAD.top - PAD.bottom;
      const yMin = Math.floor(Math.min(...validRows.map(row => row.temp)) - 1);
      const yMax = Math.ceil(Math.max(...validRows.map(row => row.temp)) + 1);
      const dataMin = Math.min(...validModelRows.map(row => row.hourFrac));
      const dataMax = Math.max(...validModelRows.map(row => row.hourFrac));
      const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
      const viewStart = clamp(zoom.start, dataMin, Math.max(dataMax - 0.1, dataMin));
      const viewEnd = clamp(zoom.end, viewStart + 0.1, dataMax);
      const viewSpan = Math.max(viewEnd - viewStart, 0.1);
      const xScale = frac => PAD.left + ((frac - viewStart) / viewSpan) * innerW;
      const yScale = temp => PAD.top + innerH - ((temp - yMin) / Math.max(yMax - yMin, 1)) * innerH;
      const visibleModelRows = validModelRows.filter(row => row.hourFrac >= viewStart - 0.5 && row.hourFrac <= viewEnd + 0.5);
      const visibleCorrectedRows = validModelRows.filter(row => row.corrected != null && row.hourFrac >= viewStart - 0.5 && row.hourFrac <= viewEnd + 0.5);
      const visiblePlottedRows = showBias ? visibleCorrectedRows : visibleModelRows;
      const visibleMetarRows = validMetarRows.filter(row => row.hourFrac >= viewStart - 0.5 && row.hourFrac <= viewEnd + 0.5);
      const visibleModelChangePoints = buildModelChangePoints(showBias ? validModelRows : validModelRows.map(row => ({ ...row, corrected: row.temp, bias: 0 }))).filter(pt => pt.hourFrac >= viewStart - 0.5 && pt.hourFrac <= viewEnd + 0.5);
      const modelPoints = visibleModelRows.map(row => `${xScale(row.hourFrac)},${yScale(row.temp)}`).join(' ');
      const correctedPoints = visibleCorrectedRows.map(row => `${xScale(row.hourFrac)},${yScale(row.corrected)}`).join(' ');
      const metarPoints = visibleMetarRows.map(row => `${xScale(row.hourFrac)},${yScale(row.temp)}`).join(' ');

      const formatClock = hour => {
        const totalMinutes = Math.round(hour * 60);
        const hh = String(Math.floor(((totalMinutes / 60) % 24 + 24) % 24)).padStart(2, '0');
        const mm = String(((totalMinutes % 60) + 60) % 60).padStart(2, '0');
        return `${hh}:${mm}`;
      };

      const resetZoom = () => setZoom({ start: dataMin, end: dataMax });
      const modelSeries = validModelRows.map(row => ({ x: row.hourFrac, temp: row.temp, corrected: row.corrected, bias: row.bias, label: row.label }));
      const metarSeries = validMetarRows.map(row => ({ x: row.hourFrac, temp: row.temp, label: row.label }));

      const hoverModel = hover ? (() => {
        if (!modelSeries.length) return null;
        const sorted = modelSeries.slice().sort((a, b) => a.x - b.x);
        if (hover.hour <= sorted[0].x) return { x: hover.hour, temp: sorted[0].temp, corrected: sorted[0].corrected, bias: sorted[0].bias, label: sorted[0].label };
        if (hover.hour >= sorted[sorted.length - 1].x) {
          const last = sorted[sorted.length - 1];
          return { x: hover.hour, temp: last.temp, corrected: last.corrected, bias: last.bias, label: last.label };
        }
        for (let i = 1; i < sorted.length; i += 1) {
          const left = sorted[i - 1];
          const right = sorted[i];
          if (hover.hour <= right.x) {
            const span = Math.max(right.x - left.x, 1e-6);
            const t = (hover.hour - left.x) / span;
            return {
              x: hover.hour,
              temp: left.temp + (right.temp - left.temp) * t,
              corrected: (left.corrected ?? left.temp) + (((right.corrected ?? right.temp) - (left.corrected ?? left.temp)) * t),
              bias: (left.bias ?? 0) + (((right.bias ?? 0) - (left.bias ?? 0)) * t),
              label: formatClock(hover.hour),
            };
          }
        }
        return null;
      })() : null;

      const hoverMetar = showRealMetar && hover ? (() => {
        if (!metarSeries.length) return null;
        const nearest = metarSeries.reduce((best, row) => {
          if (!best) return row;
          return Math.abs(row.x - hover.hour) < Math.abs(best.x - hover.hour) ? row : best;
        }, null);
        return nearest && Math.abs(nearest.x - hover.hour) <= 0.75 ? nearest : null;
      })() : null;

      const hoverX = hover ? xScale(hover.hour) : null;
      const hoverModelY = hoverModel ? yScale(hoverModel.temp) : null;
      const hoverCorrectedY = hoverModel && hoverModel.corrected != null ? yScale(showBias ? hoverModel.corrected : hoverModel.temp) : null;
      const hoverMetarY = hoverMetar ? yScale(hoverMetar.temp) : null;

      useEffect(() => {
        if (!dragging) return;
        const prevUserSelect = document.body.style.userSelect;
        const prevWebkitUserSelect = document.body.style.webkitUserSelect;
        document.body.style.userSelect = 'none';
        document.body.style.webkitUserSelect = 'none';
        const handleMove = e => {
          if (!dragRef.current) return;
          const { startX, start, end, width } = dragRef.current;
          const span = end - start;
          if (span >= (dataMax - dataMin) - 1e-6) return;
          const deltaHr = -((e.clientX - startX) / Math.max(width, 1)) * span;
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
      }, [dragging, dataMin, dataMax]);

      return html`
        <div>
          <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 8, fontSize: 10, color: '#64748b', flexWrap: 'wrap' }}>
            <div>Drag to pan · wheel to zoom · double click to reset</div>
            <button type="button" onClick=${resetZoom} style=${{ ...S.modeBtn, padding: '4px 10px' }}>Reset zoom</button>
          </div>
          <div
            style=${{ position: 'relative' }}
            onMouseMove=${e => {
              const rect = e.currentTarget.getBoundingClientRect();
              const px = clamp(e.clientX - rect.left, 0, rect.width);
              const py = clamp(e.clientY - rect.top, 0, rect.height);
              const hour = clamp(viewStart + ((px - PAD.left) / Math.max(innerW, 1)) * viewSpan, viewStart, viewEnd);
              if (dragging) return;
              setHover({ hour, x: px, y: py, width: rect.width, height: rect.height });
            }}
            onMouseLeave=${() => setHover(null)}
          >
            <svg
              viewBox="0 0 ${W} ${H}"
              style=${{ width: '100%', display: 'block', overflow: 'hidden', cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none' }}
              onMouseDown=${e => {
                if (e.button !== 0) return;
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                dragRef.current = { startX: e.clientX, width: rect.width, start: viewStart, end: viewEnd };
                setDragging(true);
              }}
              onWheel=${e => {
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                const px = clamp(e.clientX - rect.left, 0, rect.width);
                if (px < PAD.left || px > rect.width - PAD.right) return;
                const totalSpan = Math.max(dataMax - dataMin, 0.5);
                const zoomFactor = e.deltaY > 0 ? 1.18 : 0.85;
                const nextSpan = clamp(viewSpan * zoomFactor, 1.5, totalSpan);
                const rel = (px - PAD.left) / Math.max(innerW, 1);
                let nextStart = viewStart + (viewSpan - nextSpan) * rel;
                nextStart = clamp(nextStart, dataMin, Math.max(dataMax - nextSpan, dataMin));
                setZoom({ start: nextStart, end: nextStart + nextSpan });
              }}
              onDoubleClick=${resetZoom}
            >
              ${Array.from({ length: yMax - yMin + 1 }, (_, idx) => yMin + idx).map(value => html`
                <g key=${value}>
                  <line x1=${PAD.left} x2=${PAD.left + innerW} y1=${yScale(value)} y2=${yScale(value)} stroke="#16202f" stroke-width="1" />
                  <text x=${PAD.left - 6} y=${yScale(value) + 4} text-anchor="end" font-size="9" fill="#425066">${value}°C</text>
                </g>
              `)}
              ${Array.from({ length: Math.floor(viewEnd) - Math.ceil(viewStart) + 1 }, (_, idx) => Math.ceil(viewStart) + idx).filter(h => h % 2 === 0).map(h => html`
                <line key=${`t-${h}`} x1=${xScale(h)} x2=${xScale(h)} y1=${PAD.top} y2=${PAD.top + innerH} stroke="#223046" stroke-width="1" stroke-dasharray="4 4" />
              `)}
              ${Array.from({ length: Math.max(Math.floor(viewEnd) - Math.ceil(viewStart) + 1, 0) }, (_, idx) => Math.ceil(viewStart) + idx).filter(h => h % 2 === 0).map(h => html`
                <text key=${`l-${h}`} x=${xScale(h)} y=${H - 6} text-anchor="middle" font-size="9" fill="#4b5563">${String(h).padStart(2, '0')}:00</text>
              `)}
              ${showRealMetar ? html`
                <polyline points=${metarPoints} fill="none" stroke="rgba(148,163,184,0.85)" stroke-width="2" stroke-dasharray="5 4" />
              ` : null}
              <polyline points=${modelPoints} fill="none" stroke="#64748b" stroke-width="1.75" stroke-dasharray="5 4" />
              ${showBias ? html`<polyline points=${correctedPoints} fill="none" stroke=${modelColor || '#f97316'} stroke-width="2.75" />` : null}
              ${visibleModelChangePoints.map((pt, i) => html`
                <g key=${`mc-${i}`}>
                  <circle cx=${xScale(pt.hourFrac)} cy=${yScale(showBias ? (pt.corrected ?? pt.temp) : pt.temp)} r="4.25" fill="#22c55e" stroke="#0c1017" stroke-width="2" />
                  <text
                    x=${xScale(pt.hourFrac)}
                    y=${yScale(showBias ? (pt.corrected ?? pt.temp) : pt.temp) + (i % 2 === 0 ? -8 : 13)}
                    text-anchor="middle"
                    font-size="8"
                    fill="#86efac"
                    stroke="#0c1017"
                    stroke-width="2.2"
                    paint-order="stroke"
                  >${pt.modelTemp}°C</text>
                </g>
              `)}
              ${visiblePlottedRows.map((row, i) => html`
                <circle key=${`${row.dateKey}-${row.label}-dot-${i}`} cx=${xScale(row.hourFrac)} cy=${yScale(showBias ? (row.corrected ?? row.temp) : row.temp)} r="3.5" fill=${modelColor || '#f97316'} stroke="#0c1017" stroke-width="2" />
              `)}
              ${showRealMetar ? visibleMetarRows.map((row, i) => html`
                <circle key=${`m-${i}`} cx=${xScale(row.hourFrac)} cy=${yScale(row.temp)} r="3" fill="rgba(148,163,184,0.9)" stroke="#0c1017" stroke-width="2" />
              `) : null}
              ${hoverX != null ? html`
                <line x1=${hoverX} x2=${hoverX} y1=${PAD.top} y2=${PAD.top + innerH} stroke="#fbbf24" stroke-width="1.2" stroke-dasharray="4 4" opacity="0.7" />
              ` : null}
              ${hoverModelY != null ? html`
                <circle cx=${hoverX} cy=${hoverModelY} r="4.5" fill="#64748b" stroke="#f8fafc" stroke-width="2" />
              ` : null}
              ${hoverCorrectedY != null ? html`
                <circle cx=${hoverX} cy=${hoverCorrectedY} r="5.5" fill=${modelColor || '#f97316'} stroke="#f8fafc" stroke-width="2" />
              ` : null}
              ${hoverMetarY != null ? html`
                <circle cx=${hoverX} cy=${hoverMetarY} r="5" fill="rgba(148,163,184,0.95)" stroke="#f8fafc" stroke-width="2" />
              ` : null}
              ${nowMarker ? html`
                <g>
                  <line x1=${xScale(nowMarker.index)} x2=${xScale(nowMarker.index)} y1=${PAD.top} y2=${PAD.top + innerH} stroke="#60a5fa" stroke-width="1.5" stroke-dasharray="5 4" />
                </g>
              ` : null}
            </svg>
            ${hover && hoverModel ? html`
              <div style=${{
                position: 'absolute',
                left: clamp(hover.x + 14, 10, Math.max(hover.width - 182, 10)),
                top: clamp(hover.y - 64, 10, Math.max(hover.height - 96, 10)),
                minWidth: 160,
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
              <div style=${{ marginTop: 4, fontSize: 12, color: '#cbd5e1' }}>Raw: ${hoverModel.temp.toFixed(1)}°C</div>
              <div style=${{ marginTop: 2, fontSize: 12, color: '#f59e0b' }}>Bias: ${showBias ? '+' : 'off · +'}${(hoverModel.bias ?? 0).toFixed(1)}°C</div>
              <div style=${{ marginTop: 2, fontSize: 12, color: modelColor || '#fdba74' }}>${modelLabel}: ${(showBias ? (hoverModel.corrected ?? hoverModel.temp) : hoverModel.temp).toFixed(1)}°C</div>
              ${hoverMetar ? html`
                <div style=${{ marginTop: 2, fontSize: 11, color: '#cbd5e1' }}>METAR: ${hoverMetar.temp.toFixed(1)}°C</div>
              ` : null}
              </div>
            ` : null}
          </div>
        </div>
      `;
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
          background: active ? '#1a2540' : 'transparent'
        }}>${label}</a>
      `;
    }

    function App() {
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState(null);
      const [lastFetch, setLastFetch] = useState(null);
      const [rowsByModel, setRowsByModel] = useState({});
      const [daylightMap, setDaylightMap] = useState({});
      const [metarRows, setMetarRows] = useState([]);
      const [showRealMetar, setShowRealMetar] = useState(true);
      const [showBias, setShowBias] = useState(true);
      const [todayMode, setTodayMode] = useState('average');
      const [nowTick, setNowTick] = useState(() => new Date());
      const [activeDateKey, setActiveDateKey] = useState(() => londonNowParts().dateKey);

      const doFetch = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
          const modelsUrl = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&hourly=${HOURLY_VARS}&daily=${DAILY_VARS}&timezone=auto&forecast_days=3&models=${MODELS.map(model => model.id).join(',')}`;
          const [modelsResponse, metarResponse] = await Promise.all([
            fetch(modelsUrl),
            fetch(`/api/metar?station=${STATION}`).catch(() => null),
          ]);
          if (!modelsResponse.ok) throw new Error(`HTTP ${modelsResponse.status}`);
          const modelsJson = await modelsResponse.json();
          const hourly = modelsJson && modelsJson.hourly ? modelsJson.hourly : {};
          const daily = modelsJson && modelsJson.daily ? modelsJson.daily : {};
          const nextRows = {};
          MODELS.forEach(model => {
            nextRows[model.id] = parseModelData(hourly, model.id);
          });
          setRowsByModel(nextRows);
          setDaylightMap(buildDaylightMap(daily));
          if (metarResponse && metarResponse.ok) {
            const raw = await metarResponse.json();
            setMetarRows(parseMetarRows(raw));
          } else {
            setMetarRows([]);
          }
          setLastFetch(new Date());
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

      useEffect(() => {
        const id = setInterval(() => setNowTick(new Date()), 60 * 1000);
        return () => clearInterval(id);
      }, []);

      useEffect(() => {
        const nextDateKey = londonNowParts(nowTick).dateKey;
        if (nextDateKey !== activeDateKey) {
          setActiveDateKey(nextDateKey);
          doFetch();
        }
      }, [nowTick, activeDateKey, doFetch]);

      if (loading && !Object.keys(rowsByModel).length) {
        return html`<div style=${S.wrap}><div style=${S.loading}>Loading London forecast...</div></div>`;
      }

      if (error && !Object.keys(rowsByModel).length) {
        return html`
          <div style=${S.wrap}>
            <div style=${S.errBox}>
              <div style=${{ fontSize: 14, marginBottom: 8 }}>Failed to load forecast data</div>
              <div style=${{ fontSize: 11, color: '#94a3b8', marginBottom: 10 }}>${error}</div>
              <button onClick=${doFetch} style=${S.retryBtn}>Retry</button>
            </div>
          </div>
        `;
      }

      const nowParts = londonNowParts(nowTick);
      const referenceRows = MODELS.map(model => rowsByModel[model.id] || []).find(rows => rows.length) || [];
      const dayKeys = Array.from(new Set(referenceRows.map(row => row.dateKey))).slice(0, 3);
      const datedRows = referenceRows.map(row => ({ ...row, dayTitle: dayTitle(row.dateKey) }));
      const avgSeries = attachBias(
        buildAverageSeries(datedRows, rowsByModel).map(row => ({ ...row, dayTitle: dayTitle(row.dateKey) })),
        daylightMap
      );
      const todayAvgSeries = avgSeries.filter(row => row.dateKey === nowParts.dateKey);
      const currentModel = MODELS.find(model => model.id === todayMode);
      const currentModelRows = currentModel
        ? attachBias(
            (rowsByModel[currentModel.id] || []).map(row => ({ ...row, dayTitle: dayTitle(row.dateKey) })),
            daylightMap
          ).filter(row => row.dateKey === nowParts.dateKey)
        : [];
      const selectedTodayRows = todayMode === 'average' ? todayAvgSeries : currentModelRows.length ? currentModelRows : todayAvgSeries;
      const selectedTodayLabel = todayMode === 'average' ? 'Average' : (currentModel ? currentModel.label : 'Average');
      const selectedTodayTrack = todayMode === 'average' ? 'AVERAGE TRACK' : `${selectedTodayLabel.toUpperCase()} TRACK`;
      const selectedTodayColor = todayMode === 'average' ? '#f97316' : (currentModel ? currentModel.color : '#f97316');
      const selectedStartIdx = selectedTodayRows.findIndex(row => row.hour === nowParts.hour);
      const selectedNowMarker = selectedStartIdx >= 0 ? { index: selectedStartIdx + nowParts.minute / 60, label: nowParts.timeLabel } : null;
      const nowStartIdx = avgSeries.findIndex(row => row.dateKey === nowParts.dateKey && row.hour === nowParts.hour);
      const nowMarker = nowStartIdx >= 0 ? { index: nowStartIdx + nowParts.minute / 60, label: nowParts.timeLabel } : null;
      const dailyCards = dayKeys.map(dateKey => {
        const peaks = MODELS.map(model => ({
          model,
          peak: modelPeak((rowsByModel[model.id] || []).filter(row => row.dateKey === dateKey))
        })).filter(item => item.peak);
        const consensus = buildConsensus(peaks);
        const avgPeakDay = modelPeak(avgSeries.filter(row => row.dateKey === dateKey));
        const wettestDayHour = datedRows.filter(row => row.dateKey === dateKey).reduce((max, row) => {
          if (!max) return row;
          return (row.pop ?? -1) > (max.pop ?? -1) ? row : max;
        }, null);
        return {
          dateKey,
          title: dayTitle(dateKey),
          peaks,
          consensus,
          consensusTone: consensusTone(consensus),
          avgPeak: avgPeakDay,
          wettestHour: wettestDayHour
        };
      });

      return html`
        <div style=${S.wrap}>
          <div style=${{ display: 'flex', gap: 8, marginBottom: 16, paddingBottom: 10, borderBottom: '1px solid #1a2030', flexWrap: 'wrap' }}>
            ${navLink('/', 'Polydash', false)}
            ${navLink('/weth/seoul-forecast.html', 'Seoul Forecast', false)}
            ${navLink('/weth/forecast.html', 'London Forecast', true)}
            ${navLink('/weth/paris-forecast.html', 'Paris Forecast', false)}
            ${navLink('/weth/usa-forecast.html', 'USA Forecast', false)}
          </div>

          <div style=${S.header}>
            <div>
              <div style=${S.h1}>LONDON FORECAST</div>
              <div style=${S.sub}>EGLC / London City · ${LAT.toFixed(4)}, ${LON.toFixed(4)}</div>
              <div style=${{ ...S.sub, marginTop: 6, maxWidth: 'none' }}>
                UKV 2km · ECMWF IFS · ICON-EU
              </div>
              <div style=${{ ...S.sub, marginTop: 6 }}>
                Average and consensus now use only the three remaining London models.
              </div>
            </div>
            <button onClick=${doFetch} style=${S.refreshBtn}>↻</button>
          </div>

          <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8, marginBottom: 14 }}>
            ${dailyCards.map(day => html`
              <div key=${day.dateKey} style=${S.kpi}>
                <div style=${S.kpiLabel}>${day.title.toUpperCase()}</div>
                <div style=${{ ...S.kpiVal, color: '#f97316' }}>${day.avgPeak ? `${day.avgPeak.temp}°C` : '—'}</div>
                <div style=${S.kpiSub}>average peak at ${day.avgPeak ? day.avgPeak.label : '—'}</div>
              </div>
            `)}
          </div>

          <div style=${{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.55fr) minmax(300px, 1fr)', gap: 8, marginBottom: 14 }}>
            <div style=${{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style=${S.card}>
                <div style=${S.cardTitle}>AVERAGE TRACK</div>
                <div style=${{ fontSize: 10, color: '#64748b', marginBottom: 10 }}>3 days · mean of ${MODELS.length} London-capable models</div>
                <${AvgChart} rows=${avgSeries} nowMarker=${nowMarker} />
              </div>

              <div style=${S.card}>
                <div style=${S.cardTitle}>TODAY TRACK</div>
                <div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                  <div style=${{ fontSize: 10, color: '#64748b' }}>Today only</div>
                  <div style=${{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button
                      onClick=${() => setShowRealMetar(v => !v)}
                      style=${{ ...S.modeBtn, ...(showRealMetar ? S.modeBtnActive : {}) }}
                    >
                      Real METAR
                    </button>
                    <button
                      onClick=${() => setShowBias(v => !v)}
                      style=${{ ...S.modeBtn, ...(showBias ? S.modeBtnActive : {}) }}
                    >
                      Bias ${showBias ? 'On' : 'Off'}
                    </button>
                    <button onClick=${() => setTodayMode('average')} style=${{ ...S.modeBtn, ...(todayMode === 'average' ? S.modeBtnActive : {}) }}>Average</button>
                    ${MODELS.map(model => html`
                      <button
                        key=${model.id}
                        onClick=${() => setTodayMode(model.id)}
                        style=${{
                          ...S.modeBtn,
                          ...(todayMode === model.id ? { ...S.modeBtnActive, borderColor: model.color, color: model.color } : {})
                        }}
                      >
                        ${model.label}
                      </button>
                    `)}
                  </div>
                </div>
                <${TodayOverlayChart}
                  modelRows=${selectedTodayRows}
                  metarRows=${metarRows}
                  nowMarker=${selectedNowMarker}
                  modelLabel=${selectedTodayLabel}
                  trackLabel=${selectedTodayTrack}
                  modelColor=${selectedTodayColor}
                  showRealMetar=${showRealMetar}
                  showBias=${showBias}
                />
              </div>
            </div>

            <div style=${S.card}>
              <div style=${S.cardTitle}>CONSENSUS · 3 DAYS</div>
              <div style=${{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                ${dailyCards.map(day => html`
                  <div key=${day.dateKey} style=${S.dayConsensusCard}>
                    <div style=${S.dayConsensusHeader}>
                      <span style=${{ color: '#e2e8f0', fontWeight: 700 }}>${day.title}</span>
                    </div>
                    <div style=${S.consensusBig}>${day.consensus ? `${day.consensus.agreeing.length}/${day.consensus.total}` : '—'}</div>
                    <div style=${S.consensusSub}>${day.consensus ? `models within ±1°C of median max ${day.consensus.anchor}°C` : 'No model data'}</div>
                    <div style=${{ ...S.consensusPill, borderColor: day.consensusTone ? day.consensusTone.borderColor : '#1a2030', color: day.consensusTone ? day.consensusTone.color : '#94a3b8' }}>
                      ${day.consensusTone ? day.consensusTone.label : 'No signal'}
                    </div>
                    <div style=${{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      ${day.peaks.map(({ model, peak }) => {
                        const agrees = day.consensus ? Math.abs(peak.temp - day.consensus.anchor) <= 1 : false;
                        return html`
                          <div key=${model.id} style=${S.consensusRow}>
                            <span style=${{ color: model.color, fontWeight: 700, minWidth: 84, flexShrink: 0 }}>${model.label}</span>
                            <span style=${{ color: agrees ? '#4ade80' : '#94a3b8', textAlign: 'right' }}>${peak.temp}°C at ${peak.label}${agrees ? ' · agree' : ''}</span>
                          </div>
                        `;
                      })}
                    </div>
                    <div style=${{ marginTop: 10, fontSize: 10, color: '#4b5563' }}>
                      ${day.consensus ? `Spread ${day.consensus.min}°C to ${day.consensus.max}°C · wettest hour ${day.wettestHour ? `${day.wettestHour.label} (${day.wettestHour.pop ?? 0}%)` : '—'}` : ''}
                    </div>
                  </div>
                `)}
              </div>
            </div>
          </div>

          <div style=${{ textAlign: 'center', fontSize: 9, color: '#1e293b', marginTop: 10 }}>
            ${lastFetch ? `Updated: ${lastFetch.toLocaleTimeString('ru-RU', { timeZone: TZ })} London` : ''}
            ${error ? ` · Last refresh error: ${error}` : ''}
          </div>
        </div>
      `;
    }

    const S = {
      wrap: { fontFamily: "'IBM Plex Mono','Courier New',monospace", background: '#0c1017', color: '#8b95a5', minHeight: '100vh', padding: 16, boxSizing: 'border-box' },
      header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 },
      h1: { fontSize: 17, fontWeight: 700, color: '#e8ecf1', letterSpacing: 2 },
      sub: { fontSize: 10, color: '#3e4a5c', marginTop: 2, maxWidth: 560 },
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
      loading: { padding: 40, textAlign: 'center', color: '#4b5563', fontSize: 13 },
      errBox: { background: '#10141e', border: '1px solid #5c1a1a', borderRadius: 7, padding: 20, textAlign: 'center', color: '#f87171', marginTop: 40 },
      retryBtn: { background: '#1a0a0a', border: '1px solid #7f1d1d', color: '#f87171', padding: '8px 16px', borderRadius: 5, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' },
      modeBtn: { background: '#10141e', border: '1px solid #1a2030', color: '#64748b', padding: '5px 10px', borderRadius: 999, cursor: 'pointer', fontSize: 10, fontFamily: 'inherit' },
      modeBtnActive: { background: '#172033', borderColor: '#2563eb', color: '#93c5fd' },
    };

    render(html`<${App} />`, document.getElementById('root'));
