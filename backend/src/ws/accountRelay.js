import { WebSocketServer } from 'ws';
import { accountWSManager } from './accountStream.js';

/**
 * Sets up a WebSocket relay for account updates at /ws/account
 * Frontend connects here to receive real-time balance and position events.
 */
export function setupAccountWSRelay(server) {
  const wss = new WebSocketServer({ server, path: '/ws/account' });

  console.log('[AccountRelay] WebSocket relay ready at /ws/account');

  wss.on('connection', (clientWS) => {
    console.log('[AccountRelay] Frontend client connected');

    const remove = accountWSManager.addListener((event) => {
      if (clientWS.readyState === clientWS.OPEN) {
        clientWS.send(JSON.stringify(event));
      }
    });

    clientWS.on('close', () => {
      console.log('[AccountRelay] Frontend client disconnected');
      remove();
    });

    clientWS.on('error', (err) => {
      console.error('[AccountRelay] Client error:', err.message);
    });
  });

  return wss;
}
