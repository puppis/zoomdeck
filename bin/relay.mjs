/**
 * Vite plugin shared by `zoomdown serve` and the development server: relays
 * the companion-tablet messages between the pages connected to the server's
 * WebSocket, and tells a page which network addresses a tablet can use.
 */
import { hostname, networkInterfaces, platform } from 'node:os';
import { execFile, execFileSync } from 'node:child_process';

const EVENT = 'zoomdown:pad';
/** The event that tells the pages what is plugged in by cable, sent whenever it changes. */
const CABLE_EVENT = 'zoomdown:cable';
/** How often the network interfaces (and, on macOS, the USB devices) are looked at for a cable. */
const CABLE_POLL_MS = 3000;

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
 * The hardware port of each network device on macOS (Wi-Fi, Ethernet, iPad USB, …), as last read:
 * `refreshHardwarePorts` reads it again in the background, at most every ten seconds, so that the
 * server (the desktop app's main process, say) never waits for it.
 */
let ports = { at: 0, byDevice: new Map(), reading: null };
export function refreshHardwarePorts() {
  if (platform() !== 'darwin' || Date.now() - ports.at < 10000) return Promise.resolve();
  ports.reading ??= new Promise((resolve) => {
    execFile('networksetup', ['-listallhardwareports'], { encoding: 'utf8', timeout: 2000 }, (error, listing) => {
      const byDevice = new Map();
      if (!error) {
        for (const block of String(listing).split(/\n\s*\n/)) {
          const port = block.match(/Hardware Port:\s*(.+)/)?.[1]?.trim();
          const device = block.match(/Device:\s*(.+)/)?.[1]?.trim();
          if (port && device) byDevice.set(device, port);
        }
      }
      // Without the listing, interfaces are told apart by their names.
      ports = { at: Date.now(), byDevice, reading: null };
      resolve();
    });
  });
  return ports.reading;
}

/**
 * What kind of link a network interface is: `wifi`; `cable`, a wire to a device (an iPad or iPhone
 * over USB, a USB or Thunderbolt adapter); `shared`, a network this computer makes for others
 * (macOS Internet Sharing, to iPad USB or over Wi-Fi); or `other` (Ethernet, say).
 */
export function linkKind(name, port = '') {
  const label = `${port} ${name}`;
  if (/iPad|iPhone|USB|Thunderbolt Bridge|Apple Mobile Device|rndis|^usb\d|^enx/i.test(label)) return 'cable';
  if (/^bridge\d+$/.test(name)) return 'shared';
  if (/Wi-?Fi|AirPort|WLAN|Wireless|^wl/i.test(label)) return 'wifi';
  return 'other';
}

/** The IPv4 addresses a tablet can use, with the interface and the kind of link of each, in the order of lanAddresses. */
export function pairingLinks() {
  const byDevice = ports.byDevice;
  const links = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if ((entry.family !== 'IPv4' && entry.family !== 4) || entry.internal) continue;
      links.push({ address: entry.address, interface: name, kind: linkKind(name, byDevice.get(name) ?? '') });
    }
  }
  const order = lanAddresses();
  return links.sort((a, b) => order.indexOf(a.address) - order.indexOf(b.address));
}

/** The phones and tablets plugged in by USB, by product name; macOS only (elsewhere, an empty list). */
export function cabledDevices() {
  if (platform() !== 'darwin') return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile('ioreg', ['-p', 'IOUSB', '-w0'], { encoding: 'utf8', timeout: 2000 }, (error, stdout) => {
      if (error) return resolve([]);
      const names = [...String(stdout).matchAll(/-o (iPad|iPhone)\b/g)].map((match) => match[1]);
      resolve([...new Set(names)]);
    });
  });
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

/**
 * The host names the server answers to besides localhost and plain addresses: Vite refuses a
 * request whose Host header it does not expect (a guard against DNS rebinding), which would turn
 * away a tablet that reached the computer by the `Name.local` address the pairing panel offers,
 * or by the computer's own host name. Any `.local` name is allowed, since a tablet on the same
 * network may know the computer by one the panel did not list.
 */
export function allowedHosts() {
  const names = ['.local'];
  const host = hostname();
  if (host && !/^localhost$/i.test(host)) {
    names.push(host);
    const short = host.split('.')[0];
    if (short && short !== host) names.push(short);
  }
  return names;
}

/** Whether a Vite `server.host` value makes the server reachable from other machines. */
export function listensOnLan(host) {
  if (host === true) return true;
  if (typeof host !== 'string') return false;
  return !['localhost', '127.0.0.1', '::1'].includes(host);
}

export function padRelay() {
  return {
    name: 'zoomdown-pad-relay',
    configureServer(server) {
      server.ws.on(EVENT, (data) => {
        server.ws.send(EVENT, data);
      });
      const lan = () => listensOnLan(server.config.server.host);
      // What is plugged in by cable: the links on a wire (or shared from here) and the devices on USB.
      const cable = async () => {
        if (!lan()) return { links: [], devices: [] };
        await refreshHardwarePorts();
        return { links: pairingLinks().filter((link) => link.kind === 'cable' || link.kind === 'shared'), devices: await cabledDevices() };
      };
      server.middlewares.use('/__zoomdown/pad.json', async (_request, response) => {
        const address = server.httpServer?.address();
        const port = address && typeof address === 'object' ? address.port : server.config.server.port ?? 0;
        const onLan = lan();
        if (onLan) await refreshHardwarePorts();
        const links = onLan ? pairingLinks() : [];
        const payload = { names: onLan ? localNames() : [], addresses: links.map((link) => link.address), links, port, lan: onLan, cable: await cable() };
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        response.end(JSON.stringify(payload));
      });
      // A cable plugged in or out is told to the pages, which offer to pair a tablet over it.
      let last = '';
      const watch = setInterval(() => {
        void cable().then((state) => {
          const key = JSON.stringify(state);
          if (key === last) return;
          last = key;
          server.ws.send(CABLE_EVENT, state);
        });
      }, CABLE_POLL_MS);
      watch.unref?.();
      server.httpServer?.on('close', () => clearInterval(watch));
    },
  };
}
