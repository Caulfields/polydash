    const { h, render } = preact;
    const { useState, useEffect, useCallback } = preactHooks;
    const html = htm.bind(h);

    const MODEL = {
      id: 'gfs',
      label: 'GFS',
      note: 'одна модель для всех городов'
    };

    const CITIES = [
      { id: 'nyc', name: 'New York', state: 'NY', timezone: 'America/New_York', lat: 40.7128, lon: -74.0060 },
      { id: 'bos', name: 'Boston', state: 'MA', timezone: 'America/New_York', lat: 42.3601, lon: -71.0589 },
      { id: 'dc', name: 'Washington', state: 'DC', timezone: 'America/New_York', lat: 38.9072, lon: -77.0369 },
      { id: 'atl', name: 'Atlanta', state: 'GA', timezone: 'America/New_York', lat: 33.7490, lon: -84.3880 },
      { id: 'mia', name: 'Miami', state: 'FL', timezone: 'America/New_York', lat: 25.7617, lon: -80.1918 },
      { id: 'chi', name: "Chicago O'Hare", state: 'IL', timezone: 'America/Chicago', lat: 41.9769403, lon: -87.9081497 },
      { id: 'dal', name: 'Dallas', state: 'TX', timezone: 'America/Chicago', lat: 32.7767, lon: -96.7970 },
      { id: 'hou', name: 'Houston', state: 'TX', timezone: 'America/Chicago', lat: 29.7604, lon: -95.3698 },
      { id: 'den', name: 'Denver', state: 'CO', timezone: 'America/Denver', lat: 39.7392, lon: -104.9903 },
      { id: 'phx', name: 'Phoenix', state: 'AZ', timezone: 'America/Phoenix', lat: 33.4484, lon: -112.0740 },
      { id: 'sea', name: 'Seattle', state: 'WA', timezone: 'America/Los_Angeles', lat: 47.6062, lon: -122.3321 },
      { id: 'sf',  name: 'San Francisco', state: 'CA', timezone: 'America/Los_Angeles', lat: 37.7749, lon: -122.4194 }
    ];

    const MODEL_COLOR = '#60a5fa';
    const ACCENT = '#f59e0b';
    const SUB = '#7c8aa1';

    const fmtTime = (date, tz) => new Intl.DateTimeFormat('ru-RU', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);

    const fmtDate = (date, tz) => new Intl.DateTimeFormat('ru-RU', {
      timeZone: tz,
      weekday: 'short',
      day: '2-digit',
      month: 'short'
    }).format(date);

    const fmtHour = (date, tz) => new Intl.DateTimeFormat('ru-RU', {
      timeZone: tz,
      hour: '2-digit'
    }).format(date);

    function cityHourFraction(tz, date = new Date()) {
      const hour = parseInt(new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: 'numeric',
        hour12: false
      }).format(date), 10);
      const minute = parseInt(new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        minute: 'numeric'
      }).format(date), 10);
      return hour + minute / 60;
    }

    function pickCurrentRow(rows, tz) {
      if (!rows.length) return null;
      const now = new Date();
      const today = now.toLocaleDateString('en-CA', { timeZone: tz });
      const hour = parseInt(new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: 'numeric',
        hour12: false
      }).format(now), 10);
      return rows.find(row => row.dateKey === today && row.hour === hour) || rows[0];
    }

    function buildRows(hourly) {
      const times = hourly.time || [];
      const temps = hourly.temperature_2m || [];
      const winds = hourly.wind_speed_10m || [];
      const clouds = hourly.cloud_cover || [];
      const pops = hourly.precipitation_probability || [];
      return times.slice(0, 24).map((time, i) => ({
        dateKey: time.slice(0, 10),
        hour: parseInt(time.slice(11, 13), 10),
        label: time.slice(11, 16),
        temp: temps[i] ?? null,
        wind: winds[i] ?? null,
        cloud: clouds[i] ?? null,
        pop: pops[i] ?? null
      }));
    }

    function linePath(rows, width, height, pad) {
      const valid = rows.filter(row => row.temp != null);
      if (!valid.length) return '';
      const temps = valid.map(row => row.temp);
      const min = Math.floor(Math.min(...temps) - 1);
      const max = Math.ceil(Math.max(...temps) + 1);
      const innerW = width - pad.left - pad.right;
      const innerH = height - pad.top - pad.bottom;
      const x = idx => pad.left + (idx / Math.max(rows.length - 1, 1)) * innerW;
      const y = temp => pad.top + innerH - ((temp - min) / Math.max(max - min, 1)) * innerH;
      return rows.map((row, i) => row.temp != null ? `${x(i)},${y(row.temp)}` : null).filter(Boolean).join(' ');
    }

    function MiniChart({ rows, nowFrac = null }) {
      if (!rows.length) return null;
      const valid = rows.filter(row => row.temp != null);
      if (!valid.length) return null;
      const W = 560;
      const H = 380;
      const PAD = { top: 24, right: 22, bottom: 38, left: 36 };
      const temps = valid.map(row => row.temp);
      const min = Math.floor(Math.min(...temps) - 1);
      const max = Math.ceil(Math.max(...temps) + 1);
      const innerW = W - PAD.left - PAD.right;
      const innerH = H - PAD.top - PAD.bottom;
      const x = idx => PAD.left + (idx / Math.max(rows.length - 1, 1)) * innerW;
      const y = temp => PAD.top + innerH - ((temp - min) / Math.max(max - min, 1)) * innerH;
      const points = linePath(rows, W, H, PAD);

      return html`
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style=${{ width:'100%', height:'380px', display:'block' }}>
          ${Array.from({ length: max - min + 1 }, (_, idx) => min + idx).map(v => html`
            <g key=${v}>
              <line x1=${PAD.left} x2=${PAD.left + innerW} y1=${y(v)} y2=${y(v)} stroke="#152033" stroke-width="1" />
              <text x=${PAD.left - 4} y=${y(v) + 3.5} text-anchor="end" font-size="9" fill="#55657f">${v}°</text>
            </g>
          `)}
          ${nowFrac != null ? html`
            <g>
              <line x1=${PAD.left + (Math.max(0, Math.min(24, nowFrac)) / 24) * innerW} x2=${PAD.left + (Math.max(0, Math.min(24, nowFrac)) / 24) * innerW} y1=${PAD.top} y2=${PAD.top + innerH} stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="5 4" />
              <text x=${PAD.left + (Math.max(0, Math.min(24, nowFrac)) / 24) * innerW} y=${PAD.top + 10} text-anchor="middle" font-size="9" fill="#f59e0b">now</text>
            </g>
          ` : null}
          <polyline points=${points} fill="none" stroke=${MODEL_COLOR} stroke-width="2.5" />
          ${rows.map((row, i) => row.temp != null ? html`
            <circle key=${row.label} cx=${x(i)} cy=${y(row.temp)} r="3" fill=${MODEL_COLOR} stroke="#0b1220" stroke-width="2" />
          ` : null)}
          ${rows.filter((_, i) => i % 6 === 0).map((row, i) => {
            const idx = rows.indexOf(row);
            return html`<text key=${row.label + i} x=${x(idx)} y=${H - 5} text-anchor="middle" font-size="9" fill="#55657f">${row.label}</text>`;
          })}
        </svg>
      `;
    }

    function navLink(href, label, active) {
      return html`
        <a href=${href} style=${{
          textDecoration:'none',
          color: active ? '#dbeafe' : '#8b95a5',
          border: `1px solid ${active ? '#2563eb' : '#1c2536'}`,
          background: active ? 'rgba(37,99,235,0.16)' : 'rgba(11,18,32,0.7)',
          padding: '6px 10px',
          borderRadius: 6,
          fontSize: 10,
          letterSpacing: 0.4
        }}>${label}</a>
      `;
    }

    function CityCard({ city, data, selected, onSelect }) {
      const statusColor = data?.error ? '#f87171' : data?.rows?.length ? MODEL_COLOR : '#64748b';
      return html`
        <button onClick=${() => onSelect(city.id)} style=${{
          textAlign:'left',
          width:'100%',
          minHeight: 110,
          background: selected ? 'rgba(37,99,235,0.10)' : 'rgba(10,15,24,0.85)',
          border: `1px solid ${selected ? '#2b5fd9' : '#1c2536'}`,
          borderRadius: 14,
          padding: 16,
          color: '#d8e1ee',
          cursor: 'pointer',
          boxShadow: selected ? '0 0 0 1px rgba(96,165,250,0.2) inset' : 'none',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between'
        }}>
          <div style=${{ display:'flex', justifyContent:'space-between', gap:10, alignItems:'baseline' }}>
            <div>
              <div style=${{ fontSize:16, fontWeight:700, letterSpacing:0.4 }}>${city.name}</div>
              <div style=${{ fontSize:11, color:'#7c8aa1', marginTop:4 }}>${city.state} · ${fmtTime(new Date(), city.timezone)} · ${fmtDate(new Date(), city.timezone)}</div>
            </div>
            <div style=${{ color: statusColor, fontSize:11, fontWeight:700, textAlign:'right' }}>
              ${data?.error ? 'ошибка' : MODEL.label}
            </div>
          </div>

          <div style=${{ marginTop: 16, display:'flex', justifyContent:'space-between', alignItems:'center', color:'#7c8aa1', fontSize:11 }}>
            <span>${data?.rows?.length ? 'Open city' : 'Loading forecast'}</span>
            <span>${selected ? 'Selected' : ''}</span>
          </div>
        </button>
      `;
    }

    function App() {
      const [cities, setCities] = useState([]);
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState(null);
      const [selectedId, setSelectedId] = useState(CITIES[0].id);
      const [lastFetch, setLastFetch] = useState(null);
      const [nowTick, setNowTick] = useState(() => new Date());

      const loadCities = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
          const settled = await Promise.allSettled(CITIES.map(async city => {
            const url = `https://api.open-meteo.com/v1/gfs?latitude=${city.lat}&longitude=${city.lon}&hourly=temperature_2m,wind_speed_10m,cloud_cover,precipitation_probability&temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_days=1&timezone=${encodeURIComponent(city.timezone)}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const json = await response.json();
            return { ...city, rows: buildRows(json.hourly || {}), source: json };
          }));
          const results = settled.map((item, index) => item.status === 'fulfilled'
            ? item.value
            : { ...CITIES[index], rows: [], error: item.reason?.message || 'Fetch failed' });
          setCities(results);
          setLastFetch(new Date());
          const failures = results.filter(city => city.error).length;
          setError(failures ? `${failures} городов не загрузились` : null);
          setSelectedId(prev => results.some(city => city.id === prev) ? prev : (results[0]?.id || CITIES[0].id));
        } catch (e) {
          setError(e.message || 'Fetch failed');
        }
        setLoading(false);
      }, []);

      useEffect(() => {
        loadCities();
        const id = setInterval(loadCities, 10 * 60 * 1000);
        return () => clearInterval(id);
      }, [loadCities]);

      useEffect(() => {
        const id = setInterval(() => setNowTick(new Date()), 60 * 1000);
        return () => clearInterval(id);
      }, []);

      const cityDataMap = cities.reduce((acc, city) => (acc[city.id] = city, acc), {});
      const selectedCity = CITIES.find(city => city.id === selectedId) || CITIES[0];
      const selectedData = cityDataMap[selectedCity.id];
      const rows = selectedData?.rows || [];
      const current = rows.length ? pickCurrentRow(rows, selectedCity.timezone) : null;
      const nowFrac = cityHourFraction(selectedCity.timezone, nowTick);
      const totalLoaded = cities.filter(city => city.rows && city.rows.length).length;
      const warmest = cities.filter(city => city.rows && city.rows.length).reduce((best, city) => {
        const cur = pickCurrentRow(city.rows, city.timezone);
        if (!cur || cur.temp == null) return best;
        if (!best || cur.temp > best.temp) return { city, temp: cur.temp };
        return best;
      }, null);
      const coldest = cities.filter(city => city.rows && city.rows.length).reduce((best, city) => {
        const cur = pickCurrentRow(city.rows, city.timezone);
        if (!cur || cur.temp == null) return best;
        if (!best || cur.temp < best.temp) return { city, temp: cur.temp };
        return best;
      }, null);

      const hourlyTable = rows.slice(0, 12);

      return html`
        <div style=${{ maxWidth: 1480, margin: '0 auto', padding: 16 }}>
          <div style=${{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap' }}>
            ${navLink('/', '← Polydash', false)}
            ${navLink('/weth/forecast.html', 'London Forecast', false)}
            ${navLink('/weth/paris-forecast.html', 'Paris Forecast', false)}
            ${navLink('/weth/seoul-forecast.html', 'Seoul Forecast', false)}
            ${navLink('/weth/usa-forecast.html', 'USA Forecast', true)}
          </div>

          <div style=${{
            display:'grid',
            gridTemplateColumns:'1.5fr 1fr',
            gap:14,
            alignItems:'stretch',
            marginBottom: 16
          }}>
            <div style=${panel()}>
              <div style=${{ display:'flex', justifyContent:'space-between', gap:12, alignItems:'start', flexWrap:'wrap' }}>
                <div>
                  <div style=${{ fontSize:12, color:'#7c8aa1', letterSpacing:1.6, marginBottom:6 }}>USA GFS FORECAST DRAFT</div>
                  <div style=${{ fontSize:30, fontWeight:800, letterSpacing:1, color:'#f8fafc' }}>Много городов, одна модель</div>
                  <div style=${{ fontSize:12, color:'#8b95a5', marginTop:8, maxWidth:760, lineHeight:1.6 }}>
                    Пока это черновик. Все города США считаются одной моделью Open-Meteo, без региональной логики.
                    Потом ты дашь правила, и я соберу нужную структуру.
                  </div>
                </div>
                <button onClick=${loadCities} style=${refreshBtn()}>↻</button>
              </div>
              <div style=${{ display:'flex', gap:8, flexWrap:'wrap', marginTop:14 }}>
                <span style=${badge('#1f2937', '#60a5fa')}>Модель: ${MODEL.label}</span>
                <span style=${badge('#1f2937', '#f59e0b')}>Городов: ${CITIES.length}</span>
                <span style=${badge('#1f2937', '#22c55e')}>Загружено: ${totalLoaded}</span>
              </div>
            </div>

            <div style=${panel()}>
              <div style=${{ fontSize: 11, color: '#7c8aa1', marginBottom: 10, letterSpacing: 1.2 }}>SUMMARY</div>
              <div style=${summaryRow()}>
                <span style=${summaryLabel()}>Теплее всего</span>
                <span style=${summaryValue('#f8fafc')}>${warmest ? `${warmest.city.name} ${Math.round(warmest.temp)}°C` : '—'}</span>
              </div>
              <div style=${summaryRow()}>
                <span style=${summaryLabel()}>Холоднее всего</span>
                <span style=${summaryValue('#f8fafc')}>${coldest ? `${coldest.city.name} ${Math.round(coldest.temp)}°C` : '—'}</span>
              </div>
              <div style=${summaryRow()}>
                <span style=${summaryLabel()}>Обновление</span>
                <span style=${summaryValue('#dbeafe')}>${lastFetch ? fmtTime(lastFetch, 'America/New_York') + ' ET' : '—'}</span>
              </div>
            </div>
          </div>

          ${error && !totalLoaded ? html`
            <div style=${errorBox()}>
              <div style=${{ fontSize: 16, marginBottom: 8 }}>Не удалось загрузить данные</div>
              <div style=${{ fontSize: 11, color: '#94a3b8' }}>${error}</div>
            </div>
          ` : null}

          <div style=${{
            display:'grid',
            gridTemplateColumns:'repeat(3, minmax(0, 1fr))',
            gap:12
          }}>
            ${CITIES.map(city => html`
              <${CityCard}
                key=${city.id}
                city=${city}
                data=${cityDataMap[city.id]}
                selected=${selectedId === city.id}
                onSelect=${setSelectedId}
              />
            `)}
          </div>

          <div style=${{ marginTop: 16, ...panel() }}>
            <div style=${{ display:'flex', justifyContent:'space-between', gap:12, flexWrap:'wrap', marginBottom: 12 }}>
              <div>
                <div style=${{ fontSize: 11, color:'#7c8aa1', letterSpacing: 1.2 }}>SELECTED CITY</div>
                <div style=${{ fontSize: 30, fontWeight: 800, color:'#f8fafc', marginTop: 4 }}>
                  ${selectedCity.name}, ${selectedCity.state}
                </div>
              </div>
              <div style=${{ textAlign:'right', color:'#8b95a5', fontSize:10 }}>
                <div>${MODEL.label}</div>
                <div>${selectedCity.timezone}</div>
              </div>
            </div>

            ${selectedData ? html`
              <div style=${{ display:'grid', gridTemplateColumns:'1.15fr 0.85fr', gap:14, minHeight:500 }}>
                <div style=${{ ...subPanel(), minHeight:500 }}>
                  <div style=${{ marginBottom: 10, fontSize: 11, color:'#7c8aa1' }}>24-часовой ход температуры</div>
                  <${MiniChart} rows=${rows} nowFrac=${nowFrac} />
                </div>
                <div style=${{ ...subPanel(), minHeight:500, display:'flex', flexDirection:'column', justifyContent:'space-between' }}>
                  <div style=${metricRow()}>
                    <span style=${summaryLabel()}>Сейчас</span>
                    <span style=${summaryValue('#f8fafc')}>${current?.temp != null ? `${Math.round(current.temp)}°C` : '—'}</span>
                  </div>
                  <div style=${metricRow()}>
                    <span style=${summaryLabel()}>Ветер</span>
                    <span style=${summaryValue('#dbeafe')}>${current?.wind != null ? `${Math.round(current.wind)} м/с` : '—'}</span>
                  </div>
                  <div style=${metricRow()}>
                    <span style=${summaryLabel()}>Облачность</span>
                    <span style=${summaryValue('#dbeafe')}>${current?.cloud != null ? `${Math.round(current.cloud)}%` : '—'}</span>
                  </div>
                  <div style=${metricRow()}>
                    <span style=${summaryLabel()}>Осадки</span>
                    <span style=${summaryValue('#dbeafe')}>${current?.pop != null ? `${Math.round(current.pop)}%` : '—'}</span>
                  </div>
                  <div style=${metricRow()}>
                    <span style=${summaryLabel()}>Текущее время</span>
                    <span style=${summaryValue('#dbeafe')}>${fmtTime(new Date(), selectedCity.timezone)}</span>
                  </div>
                </div>
              </div>

              <div style=${{ marginTop: 16, overflowX:'auto' }}>
                <table style=${{ width:'100%', borderCollapse:'collapse', fontSize: 11 }}>
                  <thead>
                    <tr>
                      <th style=${th()}>Час</th>
                      <th style=${th()}>T</th>
                      <th style=${th()}>Ветер</th>
                      <th style=${th()}>Обл.</th>
                      <th style=${th()}>Осадки</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${hourlyTable.map(row => html`
                      <tr key=${row.label} style=${{ borderBottom:'1px solid #162033' }}>
                        <td style=${td()}><strong style=${{ color:'#dbeafe' }}>${row.label}</strong></td>
                        <td style=${td()}>${row.temp != null ? `${Math.round(row.temp)}°C` : '—'}</td>
                        <td style=${td()}>${row.wind != null ? `${Math.round(row.wind)} м/с` : '—'}</td>
                        <td style=${td()}>${row.cloud != null ? `${Math.round(row.cloud)}%` : '—'}</td>
                        <td style=${td()}>${row.pop != null ? `${Math.round(row.pop)}%` : '—'}</td>
                      </tr>
                    `)}
                  </tbody>
                </table>
              </div>
            ` : html`
              <div style=${{ padding: 24, color:'#7c8aa1', fontSize:12 }}>Данные по выбранному городу ещё загружаются.</div>
            `}
          </div>
        </div>
      `;
    }

    function panel() {
      return {
        background: 'rgba(10,15,24,0.82)',
        border: '1px solid #1c2536',
        borderRadius: 18,
        padding: 18,
        boxShadow: '0 20px 50px rgba(0,0,0,0.24)'
      };
    }

    function subPanel() {
      return {
        background: 'rgba(11,18,32,0.85)',
        border: '1px solid #1c2536',
        borderRadius: 14,
        padding: 18
      };
    }

    function summaryRow() {
      return {
        display:'flex',
        justifyContent:'space-between',
        gap:12,
        alignItems:'center',
        padding:'9px 0',
        borderBottom:'1px solid #162033'
      };
    }

    function summaryLabel() {
      return { fontSize: 12, color: SUB };
    }

    function summaryValue(color) {
      return { fontSize: 22, color, fontWeight: 700 };
    }

    function metricRow() {
      return {
        display:'flex',
        justifyContent:'space-between',
        gap:12,
        alignItems:'center',
        padding:'14px 0',
        borderBottom:'1px solid #162033'
      };
    }

    function th() {
      return { textAlign:'left', color: SUB, fontSize: 10, padding:'8px 4px', borderBottom:'1px solid #162033' };
    }

    function td() {
      return { padding:'10px 4px', color:'#9fb0c9', fontSize: 12 };
    }

    function badge(bg, color) {
      return {
        background: bg,
        color,
        border: '1px solid #1c2536',
        borderRadius: 999,
        padding: '5px 10px',
        fontSize: 10
      };
    }

    function refreshBtn() {
      return {
        width: 42,
        height: 42,
        borderRadius: 12,
        border: '1px solid #1c2536',
        background: 'rgba(11,18,32,0.9)',
        color: '#dbeafe',
        cursor: 'pointer',
        fontSize: 16
      };
    }

    function errorBox() {
      return {
        background: 'rgba(127,29,29,0.16)',
        border: '1px solid #7f1d1d',
        borderRadius: 14,
        padding: 16,
        color: '#fecaca',
        marginBottom: 16
      };
    }

    render(html`<${App} />`, document.getElementById('root'));
