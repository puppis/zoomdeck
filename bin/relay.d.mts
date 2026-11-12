import type { Plugin } from 'vite';

/** IPv4 addresses of this machine other than the loopback, private ranges first. */
export function lanAddresses(): string[];
/** Whether a Vite `server.host` value makes the server reachable from other machines. */
export function listensOnLan(host: string | boolean | undefined): boolean;
/** Relays companion-tablet messages between connected pages and serves `/__zoomdeck/pad.json`. */
export function padRelay(): Plugin;
