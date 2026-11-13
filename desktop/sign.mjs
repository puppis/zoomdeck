/**
 * electron-builder's afterPack hook: an ad-hoc signature for the macOS app.
 *
 * The builds carry no certificate, and electron-builder then leaves the app unsigned (the
 * signature Electron ships with is broken by the packing). An app without any signature does not
 * start on Apple Silicon at all, and Gatekeeper calls a downloaded copy "damaged", with the Bin
 * as the only way out. With an ad-hoc signature the system merely warns that the developer cannot
 * be verified, and Open Anyway works as the documentation says. When a certificate is found,
 * electron-builder signs the app after this hook and writes over the ad-hoc signature.
 */
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** @param {{ electronPlatformName: string, appOutDir: string, packager: { appInfo: { productFilename: string } } }} context */
export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  await run('codesign', ['--force', '--deep', '--sign', '-', app]);
  await run('codesign', ['--verify', '--deep', '--strict', app]);
  console.log(`  • ad-hoc signed  file=${app}`);
}
