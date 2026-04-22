async function loadMarketsForDay(offset) {
  const slug = dateSlug(offset);
  const state = dayState[offset];

  let event = null;
  const direct = await fetch(`${GAMMA_API}/events/slug/${encodeURIComponent(slug)}`);
  if (direct.ok) {
    event = await direct.json();
  }
  if (!event) {
    const legacy = await fetch(`${GAMMA_API}/events?slug=${slug}`);
    if (legacy.ok) {
      const arr = await legacy.json();
      event = arr[0] ?? null;
    }
  }
  if (!event) {
    const seriesRes = await fetch(`${GAMMA_API}/events?seriesSlug=${activeCity.seriesSlug}&limit=5&active=true`);
    if (seriesRes.ok) {
      const arr = await seriesRes.json();
      const targetDay = cityDateParts(offset).day;
      event = arr.find((item) => new Date(item.endDate).getDate() === targetDay) ?? null;
    }
  }
  if (!event) throw new Error(`No event found for day +${offset}`);

  state.markets = event.markets.map((market) => {
    const tokenIds = JSON.parse(market.clobTokenIds);
    const outcomePrices = JSON.parse(market.outcomePrices);
    return {
      id: market.id,
      label: market.groupItemTitle,
      threshold: Number(market.groupItemThreshold),
      yesTokenId: tokenIds[0],
      outcomePriceYes: parseFloat(outcomePrices[0]),
      bestBid: market.bestBid ?? null,
      bestAsk: market.bestAsk ?? null,
      lastTradePrice: market.lastTradePrice ?? null,
    };
  });

  for (const market of state.markets) {
    state.prices[market.yesTokenId] = {
      bestBid: market.bestBid,
      bestAsk: market.bestAsk,
      lastTrade: market.lastTradePrice,
    };
  }

  state.loaded = true;

  if (state.clobTimer) clearInterval(state.clobTimer);
  state.clobTimer = setInterval(() => refreshClobPricesForDay(offset), CLOB_REFRESH_MS);

  if (offset === viewDay) {
    applyDayToUI(offset, event.title);
  }

  if (offset === 0) {
    document.title = `${event.title} \u2014 Polymarket`;
    document.getElementById('pageTitle').textContent = event.title;
    subscribeWS();
  }

  return event;
}

function applyDayToUI(offset, title) {
  document.getElementById('mktBody').innerHTML = '';
  if (offset === 0) {
    document.title = `${title} \u2014 Polymarket`;
    document.getElementById('pageTitle').textContent = title;
  }
  markUpdated();
  renderTable();
}

async function loadMarkets() {
  await loadMarketsForDay(0);
  updateTabLabels();
  loadMarketsForDay(1).then(updateTabLabels).catch(() => {
    document.getElementById('tabTomorrow').textContent = `${londonDateLabel(1)} \u2014`;
  });
}

async function refreshClobPricesForDay(offset) {
  const state = dayState[offset];
  if (!state.markets.length) return;
  try {
    const ids = state.markets.map((market) => market.yesTokenId);
    const body = JSON.stringify({ token_ids: ids });
    const headers = { 'Content-Type': 'application/json' };
    const tradeBody = JSON.stringify(ids.map((token_id) => ({ token_id })));

    const [midRes, lastRes] = await Promise.all([
      fetch(`${CLOB_API}/midpoints`, { method: 'POST', headers, body }),
      fetch(`${CLOB_API}/last-trades-prices`, { method: 'POST', headers, body: tradeBody }),
    ]);

    if (midRes.ok) {
      const mids = await midRes.json();
      for (const item of Array.isArray(mids) ? mids : mids.mid ? [mids] : []) {
        if (!state.prices[item.token_id]) state.prices[item.token_id] = {};
        state.prices[item.token_id].mid = parseFloat(item.mid ?? item.price);
      }
    }
    if (lastRes.ok) {
      const trades = await lastRes.json();
      for (const item of Array.isArray(trades) ? trades : trades.last_trade_price ? [trades] : []) {
        if (!state.prices[item.token_id]) state.prices[item.token_id] = {};
        state.prices[item.token_id].lastTrade = parseFloat(item.price);
      }
    }
    if (offset === viewDay) {
      renderTable();
      markUpdated();
    }
  } catch (error) {
    console.warn(`CLOB refresh day+${offset}:`, error.message);
  }
}

function subscribeWS() {
  if (ws) {
    ws.onclose = null;
    ws.close();
  }
  setWs('connecting');
  ws = new WebSocket(WSS_URL);

  ws.onopen = () => {
    setWs('connected');
    wsRetryDelay = 2000;
    ws.send(
      JSON.stringify({
        assets_ids: dayState[0].markets.map((market) => market.yesTokenId),
        type: 'market',
        custom_feature_enabled: true,
      }),
    );
    ws._ping = setInterval(() => ws.readyState === 1 && ws.send('PING'), 10000);
  };

  ws.onmessage = (event) => {
    if (event.data === 'PONG') return;
    try {
      handleWsMsg(JSON.parse(event.data));
    } catch (_) {}
  };

  ws.onerror = () => setWs('error');
  ws.onclose = () => {
    clearInterval(ws._ping);
    setWs('error');
    setTimeout(subscribeWS, wsRetryDelay);
    wsRetryDelay = Math.min(wsRetryDelay * 1.5, 30000);
  };
}

function handleWsMsg(msg) {
  const prices = dayState[0].prices;
  const changed = [];

  if (msg.event_type === 'price_change') {
    for (const change of msg.price_changes ?? []) {
      if (!prices[change.asset_id]) prices[change.asset_id] = {};
      if (change.side === 'BUY') prices[change.asset_id].bestBid = parseFloat(change.best_bid ?? change.price);
      if (change.side === 'SELL') prices[change.asset_id].bestAsk = parseFloat(change.best_ask ?? change.price);
      changed.push(change.asset_id);
    }
  } else if (msg.event_type === 'last_trade_price') {
    if (!prices[msg.asset_id]) prices[msg.asset_id] = {};
    prices[msg.asset_id].lastTrade = parseFloat(msg.price);
    changed.push(msg.asset_id);
  } else if (msg.event_type === 'best_bid_ask') {
    if (!prices[msg.asset_id]) prices[msg.asset_id] = {};
    prices[msg.asset_id].bestBid = parseFloat(msg.best_bid);
    prices[msg.asset_id].bestAsk = parseFloat(msg.best_ask);
    changed.push(msg.asset_id);
  } else if (msg.event_type === 'book') {
    if (!prices[msg.asset_id]) prices[msg.asset_id] = {};
    const bids = msg.bids ?? [];
    const asks = msg.asks ?? [];
    if (bids.length) prices[msg.asset_id].bestBid = parseFloat(bids[bids.length - 1].price);
    if (asks.length) prices[msg.asset_id].bestAsk = parseFloat(asks[0].price);
    changed.push(msg.asset_id);
  }

  if (changed.length && viewDay === 0) {
    renderTable(changed);
    markUpdated();
  }
}

function getMid(market) {
  const prices = getPrices()[market.yesTokenId] ?? {};
  const bid = prices.bestBid ?? market.bestBid;
  const ask = prices.bestAsk ?? market.bestAsk;
  if (bid != null && ask != null) return (bid + ask) / 2;
  return prices.mid ?? prices.lastTrade ?? market.lastTradePrice ?? market.outcomePriceYes ?? 0;
}

function renderTable(changedIds) {
  const sort = document.getElementById('sortSel').value;
  const sorted = [...getMarkets()].sort((a, b) => {
    if (sort === 'price_desc') return getMid(b) - getMid(a);
    if (sort === 'price_asc') return getMid(a) - getMid(b);
    return a.threshold - b.threshold;
  });

  const tbody = document.getElementById('mktBody');

  for (const market of sorted) {
    const prices = getPrices()[market.yesTokenId] ?? {};
    const last = prices.lastTrade ?? market.lastTradePrice;
    const mid = getMid(market);

    const prevPrices = getPrevPrices();
    const prevMid = prevPrices[market.yesTokenId];
    const moved = prevMid != null && Math.abs(mid - prevMid) > 0.00005;
    const up = moved && mid > prevMid;
    prevPrices[market.yesTokenId] = mid;

    const todayMax = viewDay === 0 && metarToday.length ? Math.max(...metarToday.map((item) => item.temp)) : -Infinity;
    const threshTemp = parseInt(market.label, 10) || 99;
    const isLastMarket = market.label.includes('or above');
    const eliminated = viewDay === 0 && !isLastMarket && todayMax > threshTemp;

    const color = eliminated
      ? 'var(--blue)'
      : mid > 0.5
        ? 'var(--green)'
        : mid > 0.1
          ? 'var(--yellow)'
          : 'var(--red)';
    const barWidth = Math.min(mid * 100, 100).toFixed(1);

    let row = document.getElementById(`r${market.id}`);
    if (!row) {
      row = document.createElement('tr');
      row.id = `r${market.id}`;
      tbody.appendChild(row);
    }

    row.classList.toggle('row-eliminated', eliminated);
    row.innerHTML = `
      <td><span class="outcome-name">${market.label}</span></td>
      <td class="r prob-cell">
        <div class="prob-wrap">
          <div class="prob-top">
            <span class="prob-val" style="color:${color}">${pct(mid)}</span>
          </div>
          <div class="prob-bar"><div class="prob-bar-fill" style="width:${barWidth}%;background:${color}"></div></div>
        </div>
      </td>
      <td class="r"><span class="last-price" style="color:var(--dim)">${last != null ? pct(last) : '\u2014'}</span></td>
    `;

    if (moved && changedIds?.includes(market.yesTokenId)) {
      row.classList.remove('fg', 'fr');
      void row.offsetWidth;
      row.classList.add(up ? 'fg' : 'fr');
      setTimeout(() => row.classList.remove('fg', 'fr'), 750);
    }
  }

  for (const market of sorted) {
    const row = document.getElementById(`r${market.id}`);
    if (row) tbody.appendChild(row);
  }
}

document.getElementById('sortSel').addEventListener('change', () => renderTable());

function updateTabLabels() {
  document.getElementById('tabToday').textContent = londonDateLabel(0);
  document.getElementById('tabTomorrow').textContent = londonDateLabel(1) + (dayState[1].loaded ? '' : ' ...');
}

function switchDay(offset) {
  if (viewDay === offset) return;
  viewDay = offset;

  document.getElementById('tabToday').classList.toggle('active', offset === 0);
  document.getElementById('tabTomorrow').classList.toggle('active', offset === 1);
  document.getElementById('mktBody').innerHTML = '';

  if (!dayState[offset].loaded) {
    document.getElementById('mktBody').innerHTML =
      '<tr><td><div class="sk" style="width:70px"></div></td><td></td><td></td></tr>'.repeat(5);
    return;
  }

  renderTable();
}
