# Migración de `fetch` a `apiFetch`

## Problema

En desarrollo, Vite actúa como proxy: las llamadas a `/api/...` se redirigen automáticamente a `http://localhost:3001`. Por eso `fetch('/api/config/pairs')` funciona en local sin necesidad de especificar el host.

En producción ese proxy no existe. El frontend se sirve desde Vercel (`https://superbot-frontend.vercel.app`) y las llamadas a `/api/...` se resuelven contra el propio dominio de Vercel, no contra el backend en EC2. Resultado: **404 en todos los endpoints**.

```
# Dev (funciona)
fetch('/api/config/pairs')
→ Vite proxy → http://localhost:3001/api/config/pairs ✅

# Prod (falla)
fetch('/api/config/pairs')
→ https://superbot-frontend.vercel.app/api/config/pairs ❌ 404
```

## Solución

Se creó el helper `frontend/src/utils/api.js`:

```js
const BASE = import.meta.env.VITE_BACKEND_URL || '';

export const apiFetch = (path, options) => fetch(`${BASE}${path}`, options);
```

- En **desarrollo**: `VITE_BACKEND_URL` no está definida → `BASE = ''` → la URL queda `/api/...` → el proxy de Vite la intercepta como antes.
- En **producción**: `VITE_BACKEND_URL = https://superbot.lat` → `BASE = 'https://superbot.lat'` → la URL queda `https://superbot.lat/api/...` → llega al backend en EC2.

La variable se configura en Vercel como variable de entorno del proyecto.

## Archivos migrados

Todos los `fetch('/api/...')` fueron reemplazados por `apiFetch('/api/...')`:

| Archivo | Endpoints migrados |
|---|---|
| `src/hooks/useChart.js` | `/api/market/klines`, `/api/signals/alert`, `/api/market/indicators` |
| `src/context/AccountContext.jsx` | `/api/account/balance`, `/api/account/positions`, `/api/account/income` |
| `src/components/TradingChart.jsx` | `/api/config/pairs` |
| `src/components/OrderPanel.jsx` | `/api/config/trading`, `/api/orders/leverage`, `/api/orders/market`, `/api/orders/size`, `/api/orders/sltp`, `/api/orders/close` |
| `src/components/BacktestPanel.jsx` | `/api/backtest/run`, `/api/backtest/optimize` |
| `src/App.jsx` | `/api/config/mode` |

## WebSocket

Las conexiones WebSocket también necesitaban la URL base. Se resuelven derivándola de `VITE_BACKEND_URL` reemplazando el protocolo:

```js
const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const wsUrl = backendUrl.replace(/^http/, 'ws');
// https://superbot.lat → wss://superbot.lat
// http://localhost:3001 → ws://localhost:3001
```

Archivos afectados: `useChart.js` y `AccountContext.jsx`.

## Variables de entorno requeridas

### Vercel (frontend)
```
VITE_BACKEND_URL = https://superbot.lat
```

### EC2 (backend)
```
FRONTEND_URL = http://localhost:5173,https://superbot-frontend.vercel.app
```

El backend acepta múltiples orígenes CORS separados por coma. Esto es necesario para que tanto el entorno local como Vercel puedan hacer requests al backend.
