async function initUserAddress() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    USER_ADDRESS = data.address || '';
    if (USER_ADDRESS) {
      const short = USER_ADDRESS.slice(0, 6) + '...' + USER_ADDRESS.slice(-4);
      document.getElementById('userName').textContent = short;
      document.getElementById('userAvatar').textContent = USER_ADDRESS.slice(2, 3).toUpperCase();
    } else {
      document.getElementById('userPositions').innerHTML =
        '<div style="padding:16px;text-align:center;color:var(--muted);font-size:11px">No USER_ADDRESS configured.<br>Set it in Vercel environment variables.</div>';
    }
  } catch (error) {
    console.warn('initUserAddress:', error.message);
  }
}

setInterval(() => {
  if (userUpdatedTs) {
    document.getElementById('userUpdated').textContent = `Updated ${timeAgo(userUpdatedTs)}`;
  }
}, 10000);

async function loadUserPositions() {
  if (!USER_ADDRESS) return;
  try {
    const res = await fetch(
      `/api/data/positions?user=${USER_ADDRESS}&sizeThreshold=0.1&limit=100&sortBy=CURRENT&sortDirection=DESC`,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const positions = await res.json();
    const filteredPositions = positions.filter((position) => {
      const title = (position.title || '').toLowerCase();
      return title.includes(activeCity.name.toLowerCase());
    });

    const totalValue = filteredPositions.reduce((sum, position) => sum + (position.currentValue ?? 0), 0);
    const totalPnl = filteredPositions.reduce((sum, position) => sum + (position.cashPnl ?? 0), 0);

    document.getElementById('userValue').textContent = `$${totalValue.toFixed(2)}`;
    document.getElementById('userPosCount').textContent = filteredPositions.length;

    const pnlEl = document.getElementById('userPnl');
    pnlEl.textContent = `${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`;
    pnlEl.className = `user-pnl ${totalPnl >= 0 ? 'pos' : 'neg'}`;

    renderUserPositions(filteredPositions);
    userUpdatedTs = Date.now();
    document.getElementById('userUpdated').textContent = 'Updated just now';
  } catch (error) {
    console.warn('User positions:', error.message);
    document.getElementById('userPositions').innerHTML =
      '<div style="padding:16px;text-align:center;color:var(--muted);font-size:11px">Failed to load</div>';
  }
}

function renderUserPositions(positions) {
  const container = document.getElementById('userPositions');
  if (!positions.length) {
    container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--muted);font-size:11px">No open positions</div>';
    return;
  }

  container.innerHTML = positions
    .map((position) => {
      const isYes = position.outcome === 'Yes';
      const pnlSign = position.cashPnl >= 0 ? '+' : '';
      const pnlCls = position.cashPnl >= 0 ? 'pos' : 'neg';
      const barW = Math.min((position.curPrice ?? 0) * 100, 100).toFixed(1);
      const barCol = isYes ? 'var(--green)' : 'var(--red)';
      const avgFmt = position.avgPrice != null ? (position.avgPrice * 100).toFixed(1) + '\u00A2' : '\u2014';
      const curFmt = position.curPrice != null ? (position.curPrice * 100).toFixed(1) + '\u00A2' : '\u2014';

      return `<div class="user-pos-row">
      <div class="user-pos-top">
        <span class="user-pos-title" title="${position.title}">${position.title}</span>
        <span class="user-pos-outcome ${isYes ? 'yes' : 'no'}">${position.outcome}</span>
      </div>
      <div class="user-pos-bar"><div class="user-pos-bar-fill" style="width:${barW}%;background:${barCol}"></div></div>
      <div class="user-pos-bottom">
        <span>${avgFmt} avg \u2192 <span class="user-pos-price">${curFmt}</span></span>
        <span class="user-pos-pnl ${pnlCls}">${pnlSign}$${position.cashPnl.toFixed(2)}</span>
      </div>
    </div>`;
    })
    .join('');
}
