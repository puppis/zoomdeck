/**
 * Vite plugin shared by `zoomdeck serve` and the development server: relays
 * the companion-tablet messages between the pages connected to the server's
 * WebSocket, and tells a page which network addresses a tablet can use.
 */
import { networkInterfaces } from 'node:os';

const EVENT = 'zoomdeck:pad';

/** IPv4 addresses of this machine other than the loopback, private ranges first. */
export function lanAddresses() {
  const addresses = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' && entry.family !== 4) continue;
      if (entry.internal) continue;
      addresses.push(entry.address);
    }
  }
  const isPrivate = (address) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address);
  return addresses.sort((a, b) => Number(isPrivate(b)) - Number(isPrivate(a)));
}

/** Whether a Vite `server.host` value makes the server reachable from other machines. */
export function listensOnLan(host) {
  if (host === true) return true;
  if (typeof host !== 'string') return false;
  return !['localhost', '127.0.0.1', '::1'].includes(host);
}

export function padRelay() {
  return {
    name: 'zoomdeck-pad-relay',
    configureServer(server) {
      server.ws.on(EVENT, (data) => {
        server.ws.send(EVENT, data);
      });
      server.middlewares.use('/__zoomdeck/pad.json', (_request, response) => {
        const address = server.httpServer?.address();
        const port = address && typeof address === 'object' ? address.port : server.config.server.port ?? 0;
        const lan = listensOnLan(server.config.server.host);
        const payload = { addresses: lan ? lanAddresses() : [], port, lan };
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        response.end(JSON.stringify(payload));
      });
    },
  };
}
