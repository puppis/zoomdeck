#!/usr/bin/env node
/**
 * Refuse to install on a Node.js release that the tooling cannot run on.
 *
 * Vite 7 (the preview server, the exports and the documentation build) needs
 * Node 20.19 or newer, or 22.12 or newer. Older releases, and the odd-numbered
 * ones such as 21.x, lack `crypto.hash` and fail during `npm install` with
 * "TypeError: crypto.hash is not a function". Runs as the `preinstall` script,
 * before any dependency exists, so it uses nothing but Node itself.
 */
const REQUIRED = '20.19 or newer, or 22.12 or newer (the current LTS release is the simplest choice)';

/** Whether a Node version string such as "21.2.0" can run the tooling. */
export function supported(version) {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  if (major === 20) return minor >= 19;
  if (major === 22) return minor >= 12;
  return major > 22;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const version = process.versions.node;
  if (!supported(version)) {
    console.error(`
Zoomdeck needs Node.js ${REQUIRED}; this is Node ${version}.
Install a supported release from https://nodejs.org/ (or run "nvm install --lts"), then run npm install again.
`);
    process.exit(1);
  }
}
