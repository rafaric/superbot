PRD Técnico: Plataforma de Trading en Tiempo Real (BingX Integration)

1. Introducción y Objetivos del Producto

Este Documento de Requerimientos de Producto (PRD) establece las especificaciones técnicas para una plataforma de trading de alta fidelidad. El sistema integrará datos de mercado de la API de BingX para proporcionar una experiencia de análisis técnico profesional y ejecución visual precisa.

Objetivos Principales:

* Visualización de Datos de Alta Fidelidad: Renderizado de velas japonesas (klines) con latencia mínima utilizando el motor de TradingView.
* Cálculo de Indicadores Dinámicos: Implementación de estrategias basadas en Medias Móviles Exponenciales (EMA 8/21) y Precio Promedio Ponderado por Volumen (VWAP).
* Formación de Vela en Vivo: Procesamiento de flujos de WebSockets para la actualización dinámica de la "vela viva" y recalculo incremental de indicadores.

2. Arquitectura del Sistema y Stack Tecnológico

Se define una arquitectura desacoplada para garantizar la integridad de los datos y la eficiencia en el renderizado:

* Utilización de Bun como manejador de paquetes para una implementación rápida y eficiente.
* Frontend: React.js (v19+) para la interfaz de usuario. Se exige el uso de useRef para la gestión de instancias del gráfico y evitar re-renders innecesarios durante actualizaciones de alta frecuencia.
* Estilos: TailwindCSS v4 para estilos rápidos y de gran funcionalidad. 
* Visualización: Biblioteca lightweight-charts (Instalación: bun add lightweight-charts).
* Backend (Middleware): Node.js actuando como capa de transformación de datos (Data Transformation Layer). Responsable de normalizar las respuestas de la API y calcular los indicadores "seed" (históricos).
* API de Datos: BingX Open API.
  * Base URL: Definida obligatoriamente en variables de entorno (.env) como https://open-api.bingx.com.
* Comunicación: WebSockets (WS) para el stream de ticks en tiempo real.

3. Integración de Datos: BingX API

La integración con BingX requiere un estricto manejo de tipos de datos y validación de esquemas.

Consulta de Histórico (Klines)

Endpoint: GET /openApi/swap/v3/quote/klines Símbolo de referencia: BTC-USDT (Default).

Parámetros e Intervalos Soportados

La implementación debe permitir la conmutación dinámica entre los siguientes intervalos, siendo 5m el valor por defecto para la inicialización:

Intervalos de Tiempo				
Minutos	1m	3m	5m (Def) 15m 
Horas	1h	2h	4h	6h
Días/Semanas	1d	3d	1w	1M

Capa de Transformación de Datos (Middleware)

El desarrollador debe implementar un adaptador para procesar la respuesta de BingX.

1. Validación: Verificar res.data.code === 0 antes de procesar el payload.
2. Mapeo de Tiempo: BingX entrega timestamps en milisegundos. lightweight-charts requiere timestamps en segundos (Unix timestamp). Es obligatorio realizar la conversión timestamp / 1000. (Tener en cuenta el horario Argentino)
3. Estructura OHLC: Mapear el array de respuesta al formato de objeto: { time, open, high, low, close }.

4. Lógica de Indicadores Técnicos

Para optimizar el rendimiento, los indicadores se calculan de dos formas:

Estrategia de Medias Móviles Exponenciales (EMA 8 y 21)

* Cálculo "Cold" (Histórico): Al cargar las primeras 100 velas, el backend calcula el valor inicial de la EMA.
* Cálculo "Hot" (Incremental): En cada tick de WebSocket, el frontend actualiza la EMA utilizando la fórmula: EMA_{actual} = (Precio_{close} - EMA_{prev}) \times \frac{2}{n + 1} + EMA_{prev} Donde n es el periodo (8 o 21).

Precio Promedio Ponderado por Volumen (VWAP)

El VWAP debe resetearse en cada sesión diaria.

* Fórmula: \sum (Precio\_Típico \times Volumen) / \sum Volumen
* Precio Típico: (High + Low + Close) / 3.

Sincronización

Los indicadores deben recalcularse instantáneamente con cada actualización de la "vela viva". No se permite el cálculo completo del array en cada tick; solo se debe actualizar el último punto de la serie.

5. Visualización con Lightweight Charts

Implementación técnica utilizando la API de TradingView para React.

Configuración del Gráfico

import { createChart } from 'lightweight-charts';

// Inicialización con referencia de React
const chart = createChart(chartContainerRef.current, {
    layout: {
        background: { type: 'solid', color: 'transparent' },
        textColor: '#D9D9D9',
    },
    grid: {
        vertLines: { color: '#2B2B43' },
        horzLines: { color: '#2B2B43' },
    },
});


Gestión de Series

Se deben instanciar series específicas para cada tipo de dato:

1. Velas: chart.addCandlestickSeries() para los datos OHLC.
2. Indicadores: Tres instancias de chart.addLineSeries() con colores diferenciados (ej. EMA8: Azul, EMA21: Naranja, VWAP: Amarillo).

6. Formación Dinámica de Velas y WebSockets

El motor de WebSockets debe gestionar la transición entre estados de vela de forma agnóstica al intervalo.

Mecanismo de Actualización en Tiempo Real

1. Mapping de Tick: El payload del WebSocket debe mapearse al objeto OHLC.
2. Lógica de Continuidad:
  * Vela en curso: Si el timestamp del tick coincide con la última vela, se actualizan los valores (High/Low/Close) mediante series.update().
  * Nueva Vela: Cuando el timestamp del tick es igual o mayor a lastCandle.time + interval, se crea una nueva vela. Regla de Integridad: El precio de apertura (open) de la nueva vela debe ser exactamente igual al precio de cierre (close) de la vela anterior.
3. Independencia de Temporalidad: Al cambiar el intervalo (ej. de 5m a 1h), se debe cerrar la conexión del socket anterior, limpiar las series y realizar una nueva petición REST para los datos "seed" antes de reabrir el stream.


Módulo de Gestión de Cuenta y Operaciones
Este módulo permite al usuario supervisar su estado financiero y el rendimiento de la estrategia en tiempo real, integrando datos del backend procesados desde la API de BingX

1. Visualización de Balance y PnL
Balance Total: Muestra el saldo disponible en la cuenta de futuros (USDT) actualizado mediante WebSockets para reflejar cambios inmediatos tras cierres de posiciones o depósitos.
PnL No Realizado (Real-time): Cálculo dinámico de la ganancia/pérdida de las posiciones abiertas. Se basa en la diferencia entre el precio de entrada y el precio de mercado actual (Mark Price) recibido por el flujo de datos.
PnL Realizado: Sumatoria de las ganancias y pérdidas de las operaciones ya cerradas en la sesión actual o periodo seleccionado.
2. Panel de Operaciones Abiertas
Interfaz: Una tabla dinámica en React que muestra:
Símbolo y Dirección: (Ej: BTC-USDT / Long).
Tamaño y Apalancamiento: Cantidad nominal y el multiplicador aplicado.
Precio de Entrada vs. Precio de Marca: Actualización constante de los valores de mercado.
Indicador de PnL Individual: Visualización en valor absoluto y porcentaje, con códigos de color (Verde/Rojo).
Acciones Rápidas: Botones para "Cierre de Mercado" o "Ajuste de Stop Loss/Take Profit" que envíen peticiones POST a los endpoints de ejecución de BingX.
3. Historial de Operaciones
Registro Histórico: Listado de las últimas operaciones completadas, recuperando datos de los endpoints de órdenes de la API

Detalle por Operación: Debe incluir fecha/hora de apertura y cierre, precio promedio de ejecución, comisiones pagadas y el beneficio neto final.
4. Implementación Técnica y Sincronización
Flujo de Datos:
El backend en Node.js debe suscribirse al Account WebSocket de BingX para recibir eventos de actualización de balance y cambios de posición.
Para el PnL no realizado, se debe cruzar la información de la posición abierta con el precio de la última vela (Close) recibida en el gráfico

Estado en React: A diferencia de los datos del gráfico que se manejan en un useRef para rendimiento
, los datos de balance y PnL se manejarán en un Contexto de React o estado global para permitir que múltiples componentes de la interfaz se re-rendericen cuando cambien los valores de la cuenta.

8. Integración con Telegram

Este módulo habilita un canal de comunicación bidireccional entre la plataforma y el usuario a través de un bot de Telegram, permitiendo monitoreo remoto y recepción de pedidos sin necesidad de acceder a la interfaz web.

Arquitectura

El backend en Node.js actuará como intermediario entre la API de Telegram Bot y la lógica de la plataforma. El token del bot debe definirse obligatoriamente en variables de entorno (.env) como TELEGRAM_BOT_TOKEN. Solo se atenderán mensajes provenientes de un TELEGRAM_CHAT_ID autorizado, también definido en .env, para evitar accesos no autorizados.

Librería recomendada: node-telegram-bot-api (Instalación: bun add node-telegram-bot-api).

Comandos Entrantes (Pedidos desde Telegram)

El bot debe responder a los siguientes comandos:

* /balance: Devuelve el balance total disponible en la cuenta de futuros (USDT).
* /posiciones: Lista todas las posiciones abiertas con símbolo, dirección (Long/Short), tamaño, apalancamiento, precio de entrada y PnL no realizado actual.
* /resumen: Devuelve un resumen consolidado que incluye balance, PnL no realizado total, PnL realizado de la sesión y cantidad de posiciones abiertas.
* /indicadores [PAR]: Devuelve el estado actual de los indicadores técnicos (EMA8, EMA21, VWAP) para el par especificado (ej. /indicadores BTC-USDT). Si no se especifica par, usa BTC-USDT como default.

Notificaciones Salientes (Envío desde la Plataforma)

La plataforma debe enviar mensajes proactivos al chat autorizado ante los siguientes eventos:

* Apertura o cierre de posición: Notificación inmediata con símbolo, dirección, precio de ejecución y PnL realizado (en caso de cierre).
* Alerta de PnL: Cuando el PnL no realizado de una posición supere umbrales configurables (ej. +5% / -3%), se enviará una alerta automática.
* Reconexión de WebSocket: Notificar cuando el stream de datos se reconecte tras una caída.

Formato de Mensajes

Los mensajes deben ser claros y estructurados. Se recomienda usar formato Markdown compatible con Telegram (MarkdownV2) para resaltar valores clave. Ejemplo de respuesta a /posiciones:

📊 *Posiciones Abiertas*
─────────────────────
*BTC\-USDT* | Long | x10
Entrada: `65,230.00` | Mark: `66,100.00`
PnL: `+$87.00` \(\+1\.33%\) 🟢

Implementación Técnica

* El bot operará en modo polling o webhook según el entorno (polling para desarrollo local, webhook para producción).
* Los handlers de comandos deben consumir los mismos servicios internos del backend que alimentan la interfaz web, garantizando consistencia de datos.
* Toda interacción debe validar el chat_id del remitente antes de procesar el comando. Mensajes de chats no autorizados deben ignorarse silenciosamente.
* Los errores en la comunicación con Telegram no deben interrumpir el flujo principal de la plataforma; deben manejarse de forma aislada con logging.

7. Requerimientos No Funcionales y Seguridad

Gestión de Memoria y Rendimiento (Actualizada)
* Carga Inicial Adaptativa: Al inicializar el componente, el sistema debe solicitar a la API de BingX una cantidad de velas (limit) suficiente para cubrir todo el ancho visible del contenedor del gráfico
*  Se recomienda un bloque inicial de al menos 100 a 200 velas para asegurar que el viewport esté lleno desde el primer renderizado
* Paginación Histórica (Infinite Scroll):
El gráfico debe detectar cuándo el usuario hace scroll hacia la izquierda y se acerca al borde inicial de los datos cargados.
En ese momento, el sistema disparará una petición automática a la función getKlines de BingX para traer un nuevo bloque de datos históricos (velas anteriores)
* Estos nuevos datos se deben anteponer al dataset existente utilizando el método setData de la serie, permitiendo una navegación continua hacia el pasado
* Buffer Dinámico de Memoria: Para evitar la degradación del rendimiento del navegador, el sistema mantendrá un buffer dinámico. En lugar de un límite rígido de 200 velas, se permitirá un crecimiento controlado (ej. hasta 1000 velas). Si el dataset excede este umbral tras múltiples cargas históricas, se eliminarán las velas más antiguas del extremo opuesto (el futuro) que ya no sean visibles ni necesarias para el cálculo inmediato de los indicadores
* Optimización React con useRef: La instancia del gráfico creada con createChart y las series de datos (velas, EMAs y VWAP) deben almacenarse estrictamente en useRef
* Esto garantiza que las actualizaciones de datos en tiempo real y la anexión de datos históricos se realicen mediante llamadas directas a la API de la librería, interactuando con el canvas sin pasar por el ciclo de reconciliación de React, lo que mantiene una alta tasa de refresco (FPS)


Seguridad

* Variables de Entorno: No se permite el hardcoding de la baseUrl ni de API Keys. Se deben inyectar vía .env.
* Proxy de Backend: Todas las peticiones a la API de BingX deben pasar por el proxy de Node.js para ocultar credenciales y centralizar la lógica de cálculo.

Resiliencia

* Reconexión: Implementar una estrategia de Exponential Backoff para el WebSocket.
* Manejo de Errores: Validar la integridad de los datos de BingX (ej. precios en 0 o nulos) antes de enviarlos a la capa de visualización.
