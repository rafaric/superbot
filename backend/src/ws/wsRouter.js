import { WebSocketServer } from 'ws';
import { wsManager } from './bingxStream.js';
import { accountWSManager } from '../services/accountStream.js';

export function setupWSRouter(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const path = req.url?.split('?')[0];
    if (path === '/ws/ticks' || path === '/ws/account') {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (clientWS, req) => {
    const path = req.url?.split('?')[0];
    if (path === '/ws/ticks')        handleTicksClient(clientWS);
    else if (path === '/ws/account') handleAccountClient(clientWS);
    else clientWS.close();
  });

  console.log('[WSRouter] Listening on /ws/ticks and /ws/account');
  return wss;
}

function handleTicksClient(clientWS) {
  console.log('[WSTicks] Client connected');
  const remove = wsManager.addListener((tick) => {
    if (clientWS.readyState === clientWS.OPEN)
      clientWS.send(JSON.stringify({ type: 'tick', payload: tick }));
  });
  clientWS.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'subscribe') {
        const { symbol, interval } = msg.payload;
        wsManager.subscribe(symbol, interval);
        clientWS.send(JSON.stringify({ type: 'subscribed', payload: { symbol, interval } }));
      }
      if (msg.type === 'unsubscribe') wsManager.unsubscribe();
    } catch (e) { console.error('[WSTicks] Message error:', e.message); }
  });
  clientWS.on('close', () => { console.log('[WSTicks] Client disconnected'); remove(); });
  clientWS.on('error', (e) => console.error('[WSTicks] Error:', e.message));
}

function handleAccountClient(clientWS) {
  console.log('[WSAccount] Client connected');
  const remove = accountWSManager.addListener((event) => {
    if (clientWS.readyState === clientWS.OPEN)
      clientWS.send(JSON.stringify(event));
  });
  clientWS.on('close', () => { console.log('[WSAccount] Client disconnected'); remove(); });
  clientWS.on('error', (e) => console.error('[WSAccount] Error:', e.message));
}
