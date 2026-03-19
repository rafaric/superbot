import { WebSocketServer } from 'ws';
import { wsManager } from './bingxStream.js';

/**
 * Sets up a WebSocket server that relays BingX ticks to connected frontend clients.
 * Frontend connects to ws://localhost:3001/ws/ticks
 */
export function setupWSRelay(server) {
  const wss = new WebSocketServer({ server, path: '/ws/ticks' });

  console.log('[WSRelay] WebSocket relay server ready at /ws/ticks');

  wss.on('connection', (clientWS, req) => {
    console.log('[WSRelay] Frontend client connected');

    // Forward every BingX tick to this frontend client
    const removeFn = wsManager.addListener((tick) => {
      if (clientWS.readyState === clientWS.OPEN) {
        clientWS.send(JSON.stringify({ type: 'tick', payload: tick }));
      }
    });

    // Handle messages from frontend (e.g. change subscription)
    clientWS.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === 'subscribe') {
          const { symbol, interval } = msg.payload;
          wsManager.subscribe(symbol, interval);
          clientWS.send(JSON.stringify({ type: 'subscribed', payload: { symbol, interval } }));
        }

        if (msg.type === 'unsubscribe') {
          wsManager.unsubscribe();
        }
      } catch (e) {
        console.error('[WSRelay] Message parse error:', e.message);
      }
    });

    clientWS.on('close', () => {
      console.log('[WSRelay] Frontend client disconnected');
      removeFn(); // stop forwarding ticks to this client
    });

    clientWS.on('error', (err) => {
      console.error('[WSRelay] Client WS error:', err.message);
    });
  });

  return wss;
}
