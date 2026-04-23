const pct = (value) => (value == null ? '\u2014' : (value * 100).toFixed(value < 0.01 ? 2 : 1) + '%');
const deg = (value) => (value == null ? '\u2014' : value.toFixed(0) + tempUnitLabel());

function activeTempUnit() {
  return activeCity.marketUnit === 'F' ? 'F' : 'C';
}

function tempUnitLabel() {
  return `\u00B0${activeTempUnit()}`;
}

function tempFromCelsius(tempC, { decimals = 0, settle = false } = {}) {
  if (!Number.isFinite(tempC)) return null;
  if (activeTempUnit() === 'F') {
    const fahrenheit = (tempC * 9) / 5 + 32;
    if (settle) return Math.round(fahrenheit);
    if (decimals == null) return fahrenheit;
    return Number(fahrenheit.toFixed(decimals));
  }
  if (settle) return Math.round(tempC);
  if (decimals == null) return tempC;
  return Number(tempC.toFixed(decimals));
}

function formatTempFromCelsius(tempC, { decimals = 0, settle = false } = {}) {
  const value = tempFromCelsius(tempC, { decimals, settle });
  return value == null ? '\u2014' : `${value}${tempUnitLabel()}`;
}

function timeAgo(ts) {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 5) return 'now';
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

let lastUpdTs = null;

function markUpdated() {
  lastUpdTs = Date.now();
  document.getElementById('lastUpd').textContent = 'now';
}

setInterval(() => {
  if (lastUpdTs) {
    document.getElementById('lastUpd').textContent = timeAgo(lastUpdTs);
  }
}, 5000);

function fmtMetarAge(ts) {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return 'updated just now';
  const minutes = Math.floor(seconds / 60);
  return `updated ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
}

setInterval(() => {
  if (metarObsTime) {
    document.getElementById('metarUpd').textContent = fmtMetarAge(metarObsTime);
  }
}, 30000);

function tickLondonClock() {
  const time = new Date().toLocaleTimeString('en-GB', {
    timeZone: activeCity.timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  document.getElementById('londonTime').textContent = `${time} ${activeCity.name.slice(0, 3).toUpperCase()}`;
}

tickLondonClock();
setInterval(tickLondonClock, 1000);

function setWs(state) {
  document.getElementById('wsDot').className = `ws-dot ${state}`;
}
