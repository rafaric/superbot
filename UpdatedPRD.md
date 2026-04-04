# PRD — Superbot v2

**Versión:** 2.0
**Fecha:** 2026-04-04
**Autor:** Kickoff funcional basado en revisión de estrategia y operaciones reales

---

# 1. Objetivo

Actualizar la estrategia actual de **Superbot** para mejorar la calidad de las señales, reducir falsas entradas en mercados laterales y optimizar el uso de requests al exchange.

La nueva versión deberá incorporar:

* filtro de tendencia multi-timeframe
* uso de BTC como referencia macro del mercado
* scanner dinámico de activos
* modo de rotación de altcoins cuando BTC esté lateral
* limitación de exposición por correlación
* nueva capa de validación cuantitativa

---

# 2. Problema actual

La versión actual presenta los siguientes problemas detectados:

## 2.1 Entradas contra tendencia

Se detectaron múltiples operaciones short consecutivas en:

* DOGE
* ADA
* XRP
* BTC

que resultaron en pérdidas mientras BTC mantenía estructura alcista.

Esto indica ausencia de filtro HTF efectivo.

---

## 2.2 Sobreexposición correlacionada

El bot puede abrir múltiples posiciones en activos altamente correlacionados.

Ejemplo:

* BTC short
* XRP short
* ADA short
* DOGE short

Esto amplifica drawdown.

---

## 2.3 Operación ineficiente en rango

Cuando BTC entra lateral, la estrategia actual continúa operando setups de momentum / breakout que pierden edge.

---

# 3. Arquitectura funcional objetivo

## 3.1 Trend Engine (BTC Macro Filter)

BTC será el activo de referencia para definir el régimen general del mercado.

### 3.1.1 Temporalidad

```text
BTCUSDT — 1H
```

### 3.1.2 Frecuencia de cálculo

```text
recalcular al cierre de cada vela 1H
```

No recalcular en cada tick ni en cada vela 5m.

### 3.1.3 Datos requeridos

```text
300 velas de 1H
```

Esto permite:

* EMA50
* EMA200
* slope
* ATR%
* estructura reciente

### 3.1.4 Lógica de tendencia

#### Bullish

```text
price > EMA50
EMA50 > EMA200
EMA50 slope > 0
```

#### Bearish

```text
price < EMA50
EMA50 < EMA200
EMA50 slope < 0
```

#### Lateral

```text
EMA50 ≈ EMA200
slope cercano a 0
ATR bajo
```

---

# 4. Execution Engine

## 4.1 Temporalidad de entrada

```text
5m
```

## 4.2 Regla de operación

### Si BTC = Bullish

Solo permitir:

```text
LONGS
```

### Si BTC = Bearish

Solo permitir:

```text
SHORTS
```

### Si BTC = Lateral

Activar:

```text
Rotation Mode
```

---

# 5. Rotation Mode (BTC lateral)

## 5.1 Objetivo

Detectar altcoins con fuerza relativa cuando BTC se encuentra en rango.

## 5.2 Scanner dinámico

El scanner deberá buscar activos por:

* volumen alto
* volatilidad mínima
* breakout reciente
* fuerza relativa positiva vs BTC

## 5.3 Métrica principal — Relative Strength

```text
RS = retorno_alt / retorno_BTC
```

### Reglas

```text
RS > 2 → activo fuerte
RS < 0.5 → ignorar
```

## 5.4 Activación

Solo se activa si BTC cumple condición lateral.

---

# 6. Gestión de correlación y exposición

## 6.1 Restricción obligatoria

```text
máximo 1 posición abierta simultánea
```

Esta decisión aplica para toda la cartera.

## 6.2 Justificación

Evitar pérdidas encadenadas en activos altamente correlacionados.

---

# 7. Scanner dinámico

## 7.1 Universo

El scanner no utilizará lista fija.

Deberá buscar dinámicamente pares según:

* top volumen 24h
* ATR%
* volumen relativo
* spread aceptable

## 7.2 Criterios mínimos

```text
ATR% > 0.35
volRatio > 1.2
spread bajo
```

---

# 8. Validación cuantitativa (obligatoria)

La estrategia no podrá pasar a producción sin cumplir estas métricas.

## 8.1 Sample mínimo

```text
>= 150 trades
```

## 8.2 Profit Factor

```text
PF >= 1.35
```

## 8.3 Max Drawdown

```text
DD <= 15%
```

## 8.4 Win Rate

Dado RR objetivo cercano a 1:2

```text
Win Rate >= 36%
```

## 8.5 Expectancy

```text
E = (WR × AvgWin) - ((1-WR) × AvgLoss)
```

Debe ser:

```text
positivo
```

---

# 9. Criterios de aceptación

La versión v2 se considera lista cuando:

* filtro BTC 1H implementado
* modo lateral implementado
* scanner dinámico activo
* una sola posición simultánea
* backtest >= 150 trades
* PF > 1.35
* DD < 15%

---

# 10. Prioridad de implementación

## Fase 1 — Crítico

* BTC trend filter
* single position rule
* recalculation scheduler 1H

## Fase 2 — Alto impacto

* rotation mode
* RS calculation
* dynamic scanner

## Fase 3 — Optimización

* walk-forward
* Monte Carlo
* adaptive ATR filters
