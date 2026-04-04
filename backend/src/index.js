import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import marketRouter  from './routes/market.js';
import accountRouter from './routes/account.js';
import ordersRouter  from './routes/orders.js';
import signalsRouter  from './routes/signals.js';
import { router as backtestRouter } from './routes/backtest.js';
import configRouter  from './routes/config.js';
import { setupWSRouter }     from './ws/wsRouter.js';
import { accountWSManager }  from './services/accountStream.js';
import { initBot, setCloseHandler } from './services/telegram.js';
import { buildCommandHandlers } from './services/telegramCommands.js';
import { checkPnLAlerts }       from './services/telegramNotifier.js';
import { placeOrderFromSignal }  from './services/signalTrader.js';
import { closePositionFromTelegram } from './services/telegramTrader.js';
import { startScanner }         from './services/scanner.js';
import { startBTCTrendEngine } from './services/btcTrendEngine.js';
import { startAdaptiveATR }    from './services/adaptiveATR.js';
import { runCalibration, scheduleDailyCalibration } from './services/autoCalibrator.js';
import { startJournal }        from './services/tradeJournal.js';


const app  = express();
const PORT = process.env.PORT ?? 3001;

// Parse TRADING_PAIRS env var — convert BTCUSDT → BTC-USDT
export const TRADING_PAIRS = (process.env.TRADING_PAIRS ?? 'BTC-USDT')
  .split(',')
  .map((p) => {
    const s = p.trim().toUpperCase();
    // Already has dash — use as-is
    if (s.includes('-')) return s;
    // Common quote currencies in order of length (longest first to avoid partial match)
    const quotes = ['USDT', 'USDC', 'BTC', 'ETH', 'BNB'];
    for (const q of quotes) {
      if (s.endsWith(q)) return s.slice(0, s.length - q.length) + '-' + q;
    }
    return s;
  });

const allowedOrigins = (process.env.FRONTEND_URL ?? 'http://localhost:5173').split(',').map(s => s.trim());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) cb(null, true);
    else cb(new Error('Not allowed by CORS'));
  },
}));
app.use(express.json());

app.use('/api/market',  marketRouter);
app.use('/api/account', accountRouter);
app.use('/api/orders',  ordersRouter);
app.use('/api/signals',  signalsRouter);
app.use('/api/backtest', backtestRouter);
app.use('/api/config',  configRouter);
app.get('/health', (_req, res) => res.json({ status: 'ok', env: process.env.BINGX_BASE_URL }));

// ─── Trading config ──────────────────────────────────────────────────────────
app.get('/api/config/trading', (_req, res) => {
  res.json({
    ok:       true,
    pct:      parseFloat(process.env.SIGNAL_PCT      ?? 10),
    leverage: parseInt(process.env.SIGNAL_LEVERAGE   ?? 10),
  });
});

app.post('/api/config/trading', async (req, res) => {
  const { pct, leverage } = req.body;
  if (!pct || !leverage) return res.status(400).json({ ok: false, error: 'pct and leverage required' });

  process.env.SIGNAL_PCT      = String(pct);
  process.env.SIGNAL_LEVERAGE = String(leverage);

  try {
    const { readFileSync, writeFileSync } = await import('fs');
    const { resolve } = await import('path');
    const envPath = resolve(process.cwd(), '.env');
    let env = readFileSync(envPath, 'utf-8');

    const update = (key, val) => {
      if (env.includes(`${key}=`)) env = env.replace(new RegExp(`^${key}=.*`, 'm'), `${key}=${val}`);
      else env += `
${key}=${val}`;
    };
    update('SIGNAL_PCT',      pct);
    update('SIGNAL_LEVERAGE', leverage);
    writeFileSync(envPath, env);
    console.log(`[Config] Trading config saved — PCT=${pct}% LEV=x${leverage}`);
  } catch (err) {
    console.warn('[Config] Could not write .env:', err.message);
  }

  res.json({ ok: true, pct, leverage });
});

// ─── Environment switch ───────────────────────────────────────────────────────
const DEMO_URL = 'https://open-api-vst.bingx.com';
const PROD_URL = 'https://open-api.bingx.com';

app.get('/api/config/mode', (_req, res) => {
  const isDemo = process.env.BINGX_BASE_URL === DEMO_URL;
  res.json({ ok: true, mode: isDemo ? 'demo' : 'live', url: process.env.BINGX_BASE_URL });
});

app.post('/api/config/mode', async (req, res) => {
  const { mode } = req.body;
  if (mode !== 'demo' && mode !== 'live') {
    return res.status(400).json({ ok: false, error: 'mode must be "demo" or "live"' });
  }

  const newUrl = mode === 'demo' ? DEMO_URL : PROD_URL;

  // 1. Update runtime env
  process.env.BINGX_BASE_URL = newUrl;

  // 2. Persist to .env file so it survives backend restarts
  try {
    const { readFileSync, writeFileSync } = await import('fs');
    const { resolve } = await import('path');
    const envPath = resolve(process.cwd(), '.env');
    let envContent = readFileSync(envPath, 'utf-8');

    // Replace or append BINGX_BASE_URL
    if (envContent.includes('BINGX_BASE_URL=')) {
      envContent = envContent.replace(/^BINGX_BASE_URL=.*/m, `BINGX_BASE_URL=${newUrl}`);
    } else {
      envContent += `\nBINGX_BASE_URL=${newUrl}\n`;
    }
    writeFileSync(envPath, envContent);
    console.log(`[Config] .env updated: BINGX_BASE_URL=${newUrl}`);
  } catch (err) {
    console.warn('[Config] Could not write .env:', err.message);
  }

  // 3. Restart account poller so balance reflects new environment
  accountWSManager.stop();
  setTimeout(() => accountWSManager.start(), 500);

  // 4. Clear contract cache
  import('./services/sizeCalculator.js')
    .then(({ clearContractCache }) => clearContractCache())
    .catch(() => {});

  console.log(`[Config] Switched to ${mode.toUpperCase()} — ${newUrl}`);
  res.json({ ok: true, mode, url: newUrl });
});

const server = http.createServer(app);
setupWSRouter(server);

// ─── Account poller ───────────────────────────────────────────────────────────
// In-memory indicator state for /indicadores command
const indicatorState = new Map(); // symbol → { ema8, ema21, vwap, price }

export function updateIndicatorState(symbol, data) {
  indicatorState.set(symbol.toUpperCase(), data);
}

accountWSManager.start();

// Hook into account snapshots for PnL alerts
accountWSManager.addListener((event) => {
  if (event.type === 'ACCOUNT_SNAPSHOT' && event.data?.positions) {
    checkPnLAlerts(event.data.positions);
  }
});

// ─── Telegram bot ─────────────────────────────────────────────────────────────
const indicatorsGetter = (symbol) => indicatorState.get(symbol.toUpperCase()) ?? null;

initBot(buildCommandHandlers(indicatorsGetter), placeOrderFromSignal);
setCloseHandler(closePositionFromTelegram);

// ─── Auto-calibration + Scanner ──────────────────────────────────────────────
// On startup: start BTC trend engine first, then adaptive ATR, then calibrate all pairs, then start scanner.
// Daily re-calibration at 3am Argentina time.
setTimeout(async () => {
  await startBTCTrendEngine();       // Fase 1: BTC macro filter (calculates + starts 1H scheduler)
  await startAdaptiveATR();          // Fase 3: Adaptive ATR threshold (calculates + starts 1H scheduler)
  await runCalibration(TRADING_PAIRS);
  startScanner();
  scheduleDailyCalibration(TRADING_PAIRS);
  startJournal();                    // Trade journal simulado: polling SL/TP + resumen diario
}, 3000);

server.listen(PORT, () => {
  console.log(`[Backend] 🚀 Running on http://localhost:${PORT}`);
  console.log(`[Backend] 📡 BingX endpoint: ${process.env.BINGX_BASE_URL}`);
  console.log(`[Backend] 🔌 WS ticks:   ws://localhost:${PORT}/ws/ticks`);
  console.log(`[Backend] 💰 WS account: ws://localhost:${PORT}/ws/account`);
  console.log(`[Backend] 🤖 Telegram:   ${process.env.TELEGRAM_BOT_TOKEN ? 'enabled' : 'disabled (no token)'}`);
});
