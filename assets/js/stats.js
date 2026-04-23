    function todayIso() {
      return new Date().toLocaleDateString('en-CA', { timeZone: 'UTC' });
    }

    function shiftIso(iso, days) {
      const [y, m, d] = iso.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d + days, 12));
      return dt.toLocaleDateString('en-CA', { timeZone: 'UTC' });
    }

    function buildSrc(city, iso) {
      return `/stats-city.html?embed=1&city=${encodeURIComponent(city)}&date=${encodeURIComponent(iso)}`;
    }

    function loadFrames() {
      const picker = document.getElementById('datePicker');
      const iso = picker.value || todayIso();
      document.getElementById('frame-beijing').src = buildSrc('beijing', iso);
      document.getElementById('frame-london').src = buildSrc('london', iso);
      document.getElementById('frame-paris').src = buildSrc('paris', iso);
      document.getElementById('frame-nyc').src = buildSrc('nyc', iso);
      document.getElementById('frame-dallas').src = buildSrc('dallas', iso);
      document.getElementById('statusBar').textContent = `Loaded ${iso} for Beijing, London, Paris, New York, and Dallas.`;
    }

    function init() {
      const dp = document.getElementById('datePicker');
      dp.value = todayIso();
      dp.min = shiftIso(todayIso(), -29);
      dp.max = todayIso();
      document.getElementById('loadBtn').onclick = loadFrames;
      dp.addEventListener('keydown', e => {
        if (e.key === 'Enter') loadFrames();
      });
      loadFrames();
    }

    init();
