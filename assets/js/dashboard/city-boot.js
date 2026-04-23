function switchCity(cityId) {
  if (activeCity.id === cityId) return;
  activeCity = CITIES[cityId];

  Object.keys(CITIES).forEach((id) => {
    document.getElementById(`cityTab-${id}`)?.classList.toggle('active', id === cityId);
  });

  viewDay = 0;
  dayState = [makeDayState(), makeDayState()];
  metarToday = [];
  metarYesterday = [];
  metarObsTime = null;
  chartState = null;
  hourlyOmState = null;
  omData = null;

  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }

  document.getElementById('mktBody').innerHTML = '';
  document.getElementById('tabToday').classList.add('active');
  document.getElementById('tabTomorrow').classList.remove('active');
  document.getElementById('tempNow').innerHTML = `\u2014<span class="temp-unit">${tempUnitLabel()}</span>`;
  document.getElementById('metarRaw').textContent = 'loading...';
  document.getElementById('chartTitle').textContent = `${activeCity.metar} Temperature Today`;
  document.getElementById('cfMin').textContent = '\u2014';
  document.getElementById('cfMax').textContent = '\u2014';
  document.getElementById('cfWeather').textContent = '\u2014';
  document.getElementById('cfWind').textContent = '\u2014';
  document.getElementById('metarUpd').textContent = '\u2014';

  const overlay = document.getElementById('tempChartOverlay');
  if (overlay) {
    overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
  }

  loadUserPositions();
  fetchOpenMeteo();

  Promise.all([loadMarkets(), loadMetar()]).catch(console.error);
}

buildLegend();
updateTabLabels();
setupChartMouse();

initUserAddress().then(() => {
  loadUserPositions();
  setInterval(loadUserPositions, USER_REFRESH);
});

Promise.all([loadMarkets(), loadMetar()]).catch((error) => {
  console.error(error);
  document.getElementById('mktBody').innerHTML = `
    <tr><td colspan="3">
      <div class="err">
        <div>${error.message}</div>
        <button class="retry-btn" onclick="location.reload()">Retry</button>
      </div>
    </td></tr>`;
});

setInterval(loadMetar, METAR_REFRESH_MS);

setInterval(() => {
  const newDay = cityDateParts(0).day;
  if (newDay !== currentDay) {
    currentDay = newDay;
    viewDay = 0;
    for (const state of dayState) {
      if (state.clobTimer) clearInterval(state.clobTimer);
      state.markets = [];
      state.prices = {};
      state.prevPrices = {};
      state.loaded = false;
      state.clobTimer = null;
    }
    metarToday = [];
    metarYesterday = [];
    metarObsTime = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
      ws = null;
    }
    document.getElementById('mktBody').innerHTML = '';
    document.getElementById('tabToday').classList.add('active');
    document.getElementById('tabTomorrow').classList.remove('active');
    Promise.all([loadMarkets(), loadMetar()]).catch(console.error);
  }
}, 60000);
