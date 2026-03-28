#!/usr/bin/env node
// Fetches Polymarket London weather price history from Jan 1 2026
// and writes data/analysis/london-2026.csv
//
// Format: date, time_utc, then one column per relevant temperature bracket
// First row of each day = absolute prices; subsequent rows = deltas (+/-).
//
// Usage: node scripts/fetch-analysis.js

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────
const SERIES_ID  = '10006';           // London daily weather
const FROM       = '2026-01-01';
const TO         = new Date().toISOString().slice(0, 10);
const MIN_PRICE  = 0.05;              // exclude brackets that never reached 5%
const SLOT_SEC   = 5 * 60;           // 5-minute slots
const SLOTS_DAY  = 86400 / SLOT_SEC; // 288
const BATCH_SIZE = 10;               // concurrent CLOB requests
const GAMMA_BASE = 'https://gamma-api.polymarket.com';
const CLOB_BASE  = 'https://clob.polymarket.com';
const OUT_FILE   = path.join(__dirname, '..', 'data', 'analysis', 'london-2026.csv');

// ── Parse temperature from market title ───────────────────────────────────────
// "9°C or below"  → { key: "le9",  num: 9,   rank: -0.5 }
// "10°C"          → { key: "10",   num: 10,  rank:  0   }
// "15°C or higher"→ { key: "ge15", num: 15,  rank:  0.5 }
function parseTemp(title) {
  const m = title.match(/(-?\d+)/);
  if (!m) return { key: title.replace(/[^a-z0-9]/gi, '_'), num: 0, rank: 0 };
  const n = parseInt(m[1], 10);
  if (/or below/i.test(title))  return { key: `le${n}`, num: n, rank: -0.5 };
  if (/or higher/i.test(title)) return { key: `ge${n}`, num: n, rank:  0.5 };
  return { key: String(n), num: n, rank: 0 };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

function dayBounds(isoDate) {
  const t = Math.floor(new Date(isoDate + 'T00:00:00Z').getTime() / 1000);
  return { startTs: t, endTs: t + 86400 };
}

function isoDate(event) {
  return new Date(event.endDate).toISOString().slice(0, 10);
}

function fmt(v, isFirst) {
  if (v == null) return '';
  if (isFirst) return v.toFixed(4);
  const s = v >= 0 ? '+' : '';
  return s + v.toFixed(4);
}

// ── Step 1: Fetch all events ──────────────────────────────────────────────────
async function fetchEvents() {
  console.log(`Fetching events for London ${FROM} → ${TO}…`);
  const events = [];
  for (let offset = 0; offset < 400; offset += 100) {
    const url = `${GAMMA_BASE}/events?series_id=${SERIES_ID}` +
      `&start_date_min=${FROM}&start_date_max=${TO}&limit=100&offset=${offset}`;
    const batch = await fetchJson(url);
    if (!Array.isArray(batch) || !batch.length) break;
    events.push(...batch);
    if (batch.length < 100) break;
  }
  events.sort((a, b) => new Date(a.endDate) - new Date(b.endDate));
  console.log(`  → ${events.length} events`);
  return events;
}

// ── Step 2: Fetch price history for one market ────────────────────────────────
async function fetchHistory(tokenId, startTs, endTs) {
  try {
    const url = `${CLOB_BASE}/prices-history` +
      `?market=${tokenId}&startTs=${startTs}&endTs=${endTs}&fidelity=60`;
    const data = await fetchJson(url);
    return Array.isArray(data.history) ? data.history : [];
  } catch {
    return [];
  }
}

// ── Step 3: Resample to 5-min slots (forward-fill) ───────────────────────────
function resample(history, startTs) {
  const slots = new Array(SLOTS_DAY).fill(null);
  if (!history.length) return slots;

  const sorted = [...history].sort((a, b) => a.t - b.t);
  let hi = 0;
  for (let s = 0; s < SLOTS_DAY; s++) {
    const slotTs = startTs + s * SLOT_SEC;
    while (hi + 1 < sorted.length && sorted[hi + 1].t <= slotTs) hi++;
    if (sorted[hi].t <= slotTs) slots[s] = sorted[hi].p;
  }
  // Forward-fill nulls
  let last = null;
  for (let s = 0; s < SLOTS_DAY; s++) {
    if (slots[s] != null) last = slots[s];
    else slots[s] = last;
  }
  return slots;
}

// ── Run in batches ────────────────────────────────────────────────────────────
async function runBatch(tasks) {
  const results = [];
  for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
    results.push(...await Promise.all(tasks.slice(i, i + BATCH_SIZE).map(t => t())));
  }
  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const events = await fetchEvents();
  if (!events.length) { console.error('No events found'); process.exit(1); }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });

  // Map: isoDate → { tempKey → resampled slots[] }
  const dayData = {};

  console.log(`Processing ${events.length} days…`);
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const iso = isoDate(event);
    const { startTs, endTs } = dayBounds(iso);

    process.stdout.write(`\r  Day ${i + 1}/${events.length}: ${iso}  `);

    const markets = (event.markets || []).map(m => {
      const parsed = parseTemp(m.groupItemTitle);
      return { key: parsed.key, num: parsed.num, rank: parsed.rank, tokenId: JSON.parse(m.clobTokenIds)[0] };
    });

    const tasks = markets.map(m => () => fetchHistory(m.tokenId, startTs, endTs));
    const histories = await runBatch(tasks);

    dayData[iso] = {};
    markets.forEach((m, idx) => {
      const h = histories[idx];
      const maxP = h.length ? Math.max(...h.map(pt => pt.p)) : 0;
      if (maxP < MIN_PRICE) return; // skip irrelevant bracket
      dayData[iso][m.key] = resample(h, startTs);
    });
  }

  console.log('\nBuilding CSV…');

  // All temperature keys that appeared at >5% in at least one day
  // Build a rank map so le8 < 8 < ge8 < le9 < 9 < ge9 ...
  const keyMeta = {}; // key → { num, rank }
  Object.values(dayData).flatMap(d => Object.keys(d)).forEach(k => {
    if (keyMeta[k]) return;
    const n = parseInt(k.replace(/[a-z]/gi, ''), 10);
    const rank = k.startsWith('le') ? -0.5 : k.startsWith('ge') ? 0.5 : 0;
    keyMeta[k] = { n, rank };
  });
  const usedKeys = Object.keys(keyMeta).sort((a, b) => {
    const ma = keyMeta[a], mb = keyMeta[b];
    return (ma.n + ma.rank) - (mb.n + mb.rank);
  });

  const out = fs.createWriteStream(OUT_FILE, { encoding: 'utf8' });
  out.write(['date', 'time_utc', ...usedKeys].join(',') + '\n');

  const isoKeys = Object.keys(dayData).sort();
  for (const iso of isoKeys) {
    const threshMap = dayData[iso];

    for (let s = 0; s < SLOTS_DAY; s++) {
      const hh = String(Math.floor(s * SLOT_SEC / 3600)).padStart(2, '0');
      const mm = String(Math.floor((s * SLOT_SEC % 3600) / 60)).padStart(2, '0');
      const isFirst = s === 0;

      const vals = usedKeys.map(key => {
        const slots = threshMap[key];
        const cur = slots ? slots[s] : null;
        if (cur == null) return '';
        if (isFirst) return fmt(cur, true);
        const prev = slots[s - 1];
        // prev null = first data point for this market today → show absolute
        if (prev == null) return fmt(cur, true);
        return fmt(cur - prev, false);
      });

      out.write(`${iso},${hh}:${mm},${vals.join(',')}\n`);
    }
  }

  out.end();
  console.log(`\nDone → ${OUT_FILE}`);
  console.log(`Columns: ${usedKeys.join(', ')}`);
}

main().catch(e => { console.error(e); process.exit(1); });
