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

## Deploy a Producción

### Infraestructura

- **Backend**: AWS EC2 t2.micro (Ubuntu 24.04) + PM2 + Nginx + Let's Encrypt
- **Frontend**: Vercel
- **Dominio**: Namecheap → DNS apuntando a la IP de EC2

### 1. EC2 — Configuración inicial

```bash
# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# PM2 + Nginx
sudo npm install -g pm2
sudo apt install -y nginx

# Bun
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
```

### 2. EC2 — Backend

```bash
git clone https://github.com/tu-usuario/superbot.git
cd superbot/backend
bun install
cp .env.example .env
nano .env  # completar con keys reales
```

`backend/.env` en producción:

```env
BINGX_BASE_URL=https://open-api.bingx.com
BINGX_WS_URL=wss://open-api-ws.bingx.com/market
BINGX_API_KEY=tu_api_key
BINGX_API_SECRET=tu_api_secret

PORT=3001
FRONTEND_URL=http://localhost:5173,https://tu-app.vercel.app

TRADING_PAIRS=BTC-USDT,ETH-USDT,SOL-USDT

TELEGRAM_BOT_TOKEN=tu_token
TELEGRAM_CHAT_ID=tu_chat_id
```

```bash
pm2 start src/index.js --name superbot
pm2 save
pm2 startup  # ejecutar el comando que genera
```

### 3. EC2 — Nginx + HTTPS

```bash
sudo nano /etc/nginx/sites-available/superbot
```

```nginx
server {
    listen 80;
    server_name tu-dominio.xyz www.tu-dominio.xyz;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/superbot /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# HTTPS con Let's Encrypt (se renueva automáticamente)
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d tu-dominio.xyz -d www.tu-dominio.xyz
```

### 4. Vercel — Frontend

1. Importar repo en [vercel.com](https://vercel.com)
2. Root Directory: `frontend` — Build Command: `bun run build` — Output: `dist`
3. Agregar variable de entorno:
   ```
   VITE_BACKEND_URL = https://tu-dominio.xyz
   ```

### Actualizar en producción

```bash
# Mac
git add . && git commit -m "..." && git push
# Vercel se actualiza automáticamente

# EC2
cd ~/superbot/backend
git pull
pm2 restart superbot
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
