import type { Plugin } from 'vite';

/** IPv4 addresses of this machine other than the loopback, private ranges first. */
export function lanAddresses(): string[];
/** The kind of link a network interface is, from its name and (on macOS) its hardware port. */
export function linkKind(name: string, port?: string): 'wifi' | 'cable' | 'shared' | 'other';
/** The IPv4 addresses a tablet can use, with the interface and the kind of link of each. */
export function pairingLinks(): Array<{ address: string; interface: string; kind: 'wifi' | 'cable' | 'shared' | 'other' }>;
/** Read the hardware ports of the network devices again in the background (macOS; at most every ten seconds). */
export function refreshHardwarePorts(): Promise<void>;
/** The phones and tablets plugged in by USB, by product name (macOS only). */
export function cabledDevices(): Promise<string[]>;
/** Whether a Vite `server.host` value makes the server reachable from other machines. */
export function listensOnLan(host: string | boolean | undefined): boolean;
/** Relays companion-tablet messages between connected pages and serves `/__zoomdown/pad.json`. */
export function padRelay(): Plugin;

/** The host names the server answers to besides localhost and plain addresses: any `.local` name and the computer's own. */
export function allowedHosts(): string[];
