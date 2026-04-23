const GAMMA_API = '/api/gamma';
const CLOB_API = '/api/clob';
const WSS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
const CLOB_REFRESH_MS = 15000;
const METAR_REFRESH_MS = 120000;

const CITIES = {
  beijing: {
    id: 'beijing',
    name: 'Beijing',
    metar: 'ZBAA',
    airport: 'Beijing Capital International Airport',
    timezone: 'Asia/Shanghai',
    seriesSlug: 'beijing-daily-weather',
    slugPrefix: 'highest-temperature-in-beijing-on',
    archiveKey: 'polydash_archive_beijing',
    coords: { lat: 40.0799, lon: 116.6031 },
    omKind: 'hourly',
    omBadge: 'CMA',
    omSourceLabel: 'Open-Meteo Forecast',
    omApi: 'https://api.open-meteo.com/v1/forecast?latitude=40.0799&longitude=116.6031&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation,precipitation_probability&timezone=Asia%2FShanghai&forecast_days=1',
  },
  london: {
    id: 'london',
    name: 'London',
    metar: 'EGLC',
    airport: 'London City Airport',
    timezone: 'Europe/London',
    seriesSlug: 'london-daily-weather',
    slugPrefix: 'highest-temperature-in-london-on',
    archiveKey: 'polydash_archive_london',
    coords: { lat: 51.5053, lon: 0.0553 },
    omKind: 'minutely',
    omBadge: 'UKMO',
    omSourceLabel: 'UKMO Seamless',
    omApi: 'https://api.open-meteo.com/v1/forecast?latitude=51.5053&longitude=0.0553&minutely_15=temperature_2m,precipitation,wind_speed_10m,wind_direction_10m&forecast_days=1&models=ukmo_seamless&timezone=Europe%2FLondon',
  },
  paris: {
    id: 'paris',
    name: 'Paris',
    metar: 'LFPB',
    airport: 'Paris Le Bourget',
    timezone: 'Europe/Paris',
    seriesSlug: 'paris-daily-weather',
    slugPrefix: 'highest-temperature-in-paris-on',
    archiveKey: 'polydash_archive_paris',
    coords: { lat: 48.949675, lon: 2.432356 },
    omKind: 'hourly',
    omBadge: 'MF',
    omSourceLabel: 'Meteo-France',
    omApi: 'https://api.open-meteo.com/v1/forecast?latitude=48.949675&longitude=2.432356&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation,precipitation_probability&models=meteofrance_seamless&timezone=Europe%2FParis&forecast_days=1',
  },
  nyc: {
    id: 'nyc',
    name: 'New York',
    metar: 'KLGA',
    airport: 'LaGuardia Airport',
    timezone: 'America/New_York',
    seriesSlug: 'nyc-daily-weather',
    slugPrefix: 'highest-temperature-in-nyc-on',
    archiveKey: 'polydash_archive_nyc',
    coords: { lat: 40.774722, lon: -73.871944 },
    marketUnit: 'F',
    usesUsMetarTenths: true,
    omKind: 'hourly',
    omBadge: 'NOAA',
    omSourceLabel: 'GFS / HRRR Seamless',
    omApi: 'https://api.open-meteo.com/v1/gfs?latitude=40.774722&longitude=-73.871944&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation,precipitation_probability&timezone=America%2FNew_York&forecast_days=1',
  },
  dallas: {
    id: 'dallas',
    name: 'Dallas',
    metar: 'KDAL',
    airport: 'Dallas Love Field',
    timezone: 'America/Chicago',
    seriesSlug: 'dallas-daily-weather',
    slugPrefix: 'highest-temperature-in-dallas-on',
    archiveKey: 'polydash_archive_dallas',
    coords: { lat: 32.847222, lon: -96.851667 },
    marketUnit: 'F',
    usesUsMetarTenths: true,
    omKind: 'hourly',
    omBadge: 'NOAA',
    omSourceLabel: 'GFS / HRRR Seamless',
    omApi: 'https://api.open-meteo.com/v1/gfs?latitude=32.847222&longitude=-96.851667&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation,precipitation_probability&timezone=America%2FChicago&forecast_days=1',
  },
};

let activeCity = CITIES.beijing;

function cityDateParts(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 86400000);
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: activeCity.timezone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((part) => [part.type, part.value]));
  return {
    day: parseInt(parts.day, 10),
    month: parts.month.toLowerCase(),
    year: parseInt(parts.year, 10),
  };
}

function dateSlug(offsetDays) {
  const parts = cityDateParts(offsetDays);
  return `${activeCity.slugPrefix}-${parts.month}-${parts.day}-${parts.year}`;
}

function londonDateLabel(offsetDays) {
  const parts = cityDateParts(offsetDays);
  const month = parts.month.charAt(0).toUpperCase() + parts.month.slice(1, 3);
  return `${parts.day} ${month}`;
}

let currentDay = cityDateParts(0).day;
let viewDay = 0;

const makeDayState = () => ({
  markets: [],
  prices: {},
  prevPrices: {},
  loaded: false,
  clobTimer: null,
});

let dayState = [makeDayState(), makeDayState()];

let ws = null;
let wsRetryDelay = 2000;

const getMarkets = () => dayState[viewDay].markets;
const getPrices = () => dayState[viewDay].prices;
const getPrevPrices = () => dayState[viewDay].prevPrices;

let metarToday = [];
let metarYesterday = [];
let metarObsTime = null;

let chartState = null;

const THRESH_TEMPS = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];

let USER_ADDRESS = '';
const USER_REFRESH = 30000;
let userUpdatedTs = null;

const OM_REFRESH = 15 * 60 * 1000;
let omData = null;
let omMode = 'best';
let hourlyOmState = null;
