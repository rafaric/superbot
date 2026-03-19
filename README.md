# BingX Trading Dashboard

Plataforma de trading en tiempo real con integración BingX, gráficos con lightweight-charts, indicadores EMA/VWAP y WebSocket.

## Stack

- **Frontend**: React 19 + TailwindCSS v4 + lightweight-charts
- **Backend**: Node.js (Express) + WebSocket relay
- **Package manager**: Bun

---

## Setup Inicial

### 1. Instalar dependencias

```bash
# Desde la raíz del proyecto
cd backend && bun install
cd ../frontend && bun install
```

### 2. Configurar variables de entorno

```bash
cp backend/.env.example backend/.env
```

Editar `backend/.env`:

```env
# Demo (VST) — sin dinero real
BINGX_BASE_URL=https://open-api-vst.bingx.com
BINGX_WS_URL=wss://open-api-ws.bingx.com/market

BINGX_API_KEY=tu_api_key
BINGX_API_SECRET=tu_api_secret

PORT=3001
FRONTEND_URL=http://localhost:5173
```

> Para obtener las API Keys demo: BingX → Gestión de API → Crear API (marcar "Demo Trading / VST")

### 3. Correr en desarrollo

```bash
# Desde la raíz (levanta backend y frontend simultáneamente)
cd backend && bun run dev
# En otra terminal:
cd frontend && bun run dev
```

O con concurrently desde la raíz:
```bash
bun install   # instala concurrently en root
bun run dev
```

Acceder a: http://localhost:5173

---

## Cambiar a Producción

En `backend/.env`:
```env
BINGX_BASE_URL=https://open-api.bingx.com
```

---

## Arquitectura

```
bingx-trading/
├── backend/
│   └── src/
│       ├── index.js              # Entry point Express + WS server
│       ├── routes/
│       │   └── market.js         # GET /api/market/klines, POST /subscribe
│       ├── services/
│       │   ├── bingx.js          # Llamadas a BingX REST API
│       │   └── indicators.js     # Cálculo cold de EMA y VWAP
│       ├── utils/
│       │   └── auth.js           # HMAC-SHA256 firma
│       └── ws/
│           ├── bingxStream.js    # Conexión WS a BingX con reconexión exponential backoff
│           └── relay.js          # Relay de ticks al frontend
└── frontend/
    └── src/
        ├── App.jsx               # Layout principal
        ├── components/
        │   └── TradingChart.jsx  # Toolbar + contenedor del chart
        ├── hooks/
        │   └── useChart.js       # Toda la lógica del chart (init, data, WS, indicadores)
        └── utils/
            └── indicators.js     # Fórmulas hot (EMA incremental, VWAP incremental)
```

---

## Módulos Implementados

- [x] Gráfico de velas (lightweight-charts)
- [x] EMA 8 y EMA 21 (cálculo cold + hot incremental)
- [x] VWAP con reset diario (cálculo cold + hot incremental)
- [x] WebSocket relay backend → frontend
- [x] Reconexión automática con exponential backoff
- [x] Paginación histórica (infinite scroll izquierda)
- [x] Buffer dinámico (máx 1000 velas)
- [x] Selector de símbolo e intervalo
- [ ] Balance y PnL (próximo módulo)
- [ ] Panel de operaciones abiertas (próximo módulo)
- [ ] Bot de Telegram (próximo módulo)

---

## Notas Técnicas

- Los timestamps de BingX vienen en **milisegundos** → el backend los convierte a **segundos** para lightweight-charts.
- El timezone argentino (UTC-3) lo maneja el navegador automáticamente.
- Los datos del gráfico se manejan con `useRef` para evitar re-renders en cada tick.
- La apertura de cada vela nueva es igual al cierre de la anterior (regla de integridad del PRD).
- Los frames GZIP del WebSocket de BingX se descomprimen en el backend antes de retransmitir.
