
Documentación Técnica: Dashboard de Trading BingX (Futuros Perpetuos)
Este documento establece las especificaciones técnicas y los estándares de implementación para el dashboard de trading de alta precisión, integrando la API de BingX (v2/v3) y la librería Lightweight Charts™
.
1. Protocolos de Seguridad y Autenticación
Todas las peticiones privadas requieren autenticación basada en HMAC-SHA256. Los parámetros deben estar ordenados alfabéticamente antes de generar la firma
.
Headers: X-BX-APIKEY
.
Firma: HMAC_SHA256(SecretKey, Method + Path + SortedParameters)
.
Timestamp: Las peticiones expiran a los 5000ms a menos que se use recvWindow
.
Ejemplo de Firma en JavaScript (Node.js)
const crypto = require('crypto');

function generateSignature(queryString, apiSecret) {
    return crypto
        .createHmac('sha256', apiSecret)
        .update(queryString)
        .digest('hex');
}

--------------------------------------------------------------------------------
2. Gestión de Cuenta y Rendimiento (PnL)
El dashboard debe monitorear el balance y flujo de fondos en tiempo real
.
A. Consulta de Balance Total
Endpoint: GET /openApi/swap/v3/user/balance
.
Uso: Recupera el balance disponible y el PnL no realizado de posiciones cruzadas
.
B. Historial de PnL Realizado
Endpoint: GET /openApi/swap/v2/user/income
.
Parámetros Clave: incomeType: "REALIZED_PNL" para filtrar ganancias y pérdidas cerradas
.

--------------------------------------------------------------------------------
3. Ejecución de Órdenes y Apalancamiento
A. Configurar Apalancamiento (Leverage)
Se debe establecer antes de abrir la orden
.
Endpoint: POST /openApi/swap/v2/trade/leverage
.
Parámetros: symbol, leverage, side: "BOTH" (para modo unidireccional)
.
B. Apertura de Órdenes con SL/TP
BingX permite enviar los parámetros de Stop Loss y Take Profit dentro de la misma petición de orden
.
Endpoint: POST /openApi/swap/v2/trade/order
.
Ejemplo de Request Body:
{
  "symbol": "BTC-USDT",
  "side": "BUY",
  "positionSide": "LONG",
  "type": "MARKET",
  "quantity": 0.01,
  "takeProfit": JSON.stringify({ "type": "TAKE_PROFIT_MARKET", "stopPrice": 75000 }),
  "stopLoss": JSON.stringify({ "type": "STOP_MARKET", "stopPrice": 60000 })
}

--------------------------------------------------------------------------------
4. Ingesta de Datos de Mercado y Gráficos
A. Velas Históricas (K-lines)
Endpoint: GET /openApi/swap/v3/quote/klines
.
Transformación de Datos: BingX devuelve timestamps en milisegundos, pero Lightweight Charts™ requiere segundos
.
Intervalos: 1m, 5m, 15m, 1h
.
B. Feed en Tiempo Real (WebSocket)
URL: wss://open-api-ws.bingx.com/market
.
Suscripción: <symbol>@trade (precio al instante) o <symbol>@kline_<interval>
.
Nota: Los datos de BingX vienen comprimidos en GZIP y deben ser descomprimidos
.

--------------------------------------------------------------------------------
5. Lógica de Indicadores y Señales
Los indicadores se calculan localmente sobre el dataset cargado:
EMA (8/21): Para identificar la tendencia.
VWAP: Reiniciado diariamente para reflejar el valor intradía.
Generación de Señales:
BUY: Precio > VWAP AND EMA(8) > EMA(21).
SELL: Precio < VWAP OR EMA(8) cruza a la baja EMA(21).

--------------------------------------------------------------------------------
6. Optimización en React y Rendimiento
Persistencia: Uso obligatorio de useRef para las instancias de chart y series para evitar re-renders.
Throttling Buffer: No actualizar el estado de React con cada tick. Implementar un buffer que ejecute series.update() cada 100ms mediante requestAnimationFrame.
Limpieza: Destruir la instancia del chart en el return del useEffect para prevenir fugas de memoria.

--------------------------------------------------------------------------------
7. Entornos de Trabajo
Producción: https://open-api.bingx.com
.
Demo Trading (VST): https://open-api-vst.bingx.com
.