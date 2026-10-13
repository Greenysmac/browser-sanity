#!/usr/bin/env node
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { install, repair, uninstall, runRegistryCommands } from './installer.js';
import { PROD_EXTENSION_ID } from './paths.js';

const COMMANDS = new Set(['install', 'repair', 'uninstall']);

export function parseArgs(argv) {
  let cmd = 'install';
  let rest = argv;
  if (argv[0] && COMMANDS.has(argv[0])) { cmd = argv[0]; rest = argv.slice(1); }
  const browsers = (rest[0] || 'chrome,edge').split(',').filter(Boolean);
  const extensionId = rest[1] || PROD_EXTENSION_ID;
  return { cmd, browsers, extensionId };
}

export function main(argv = process.argv.slice(2)) {
  const { cmd, browsers, extensionId } = parseArgs(argv);
  if (cmd === 'uninstall') {
    const removed = uninstall({ browsers });
    console.log(removed.length ? 'Removed:\n' + removed.map((f) => '  ' + f).join('\n') : 'Nothing to remove.');
    runRegistryCommands(removed._registryCommands); // win32: deregister from the registry
    return;
  }
  const fn = cmd === 'repair' ? repair : install;
  const written = fn({ extensionId, browsers });
  console.log(`${cmd === 'repair' ? 'Repaired' : 'Installed'} Browser Sanity host:\n` +
    written.map((f) => '  ' + f).join('\n'));
  runRegistryCommands(written._registryCommands); // win32: register the host in the registry
  console.log('\nOpen the extension side panel and click the reload icon.');
}

// Run when invoked directly OR via the `bin` symlink (npx). realpath collapses
// the node_modules/.bin/browser-sanity-host symlink to the real cli.js path.
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try { return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); }
  catch { return false; }
}
if (invokedDirectly()) main();
