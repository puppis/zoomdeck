/**
 * Vite plugin shared by `zoomdeck serve` and the development server: relays
 * the companion-tablet messages between the pages connected to the server's
 * WebSocket, and tells a page which network addresses a tablet can use.
 */
import { hostname, networkInterfaces, platform } from 'node:os';
import { execFileSync } from 'node:child_process';

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

/**
 * Names under which other devices on the local network find this computer: its Bonjour name
 * (`Name.local`, which macOS, iOS, Windows 10 and later and most Linux desktops resolve), which
 * outlives a change of address. Best effort: a name that does not resolve costs the tablet a retry
 * by address.
 */
export function localNames() {
  let name = null;
  if (platform() === 'darwin') {
    try {
      name = execFileSync('scutil', ['--get', 'LocalHostName'], { encoding: 'utf8', timeout: 2000 }).trim();
    } catch {
      name = null;
    }
  }
  if (!name) {
    const host = hostname();
    if (!host || /^localhost$/i.test(host)) return [];
    name = host.replace(/\.local$/i, '').split('.')[0];
  }
  return name ? [`${name}.local`] : [];
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
        const payload = { names: lan ? localNames() : [], addresses: lan ? lanAddresses() : [], port, lan };
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        response.end(JSON.stringify(payload));
      });
    },
  };
}
