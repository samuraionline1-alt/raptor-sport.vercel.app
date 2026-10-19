import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { copyLibFiles } from '@qwik.dev/partytown/utils';
import { partytownSnippet } from '@qwik.dev/partytown/integration';
const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(root + '~partytown/1.0.1', { recursive: true });
await copyLibFiles(root + '~partytown/1.0.1', { debugDir: false });
const config = await readFile(root + 'tracking-worker-config.js', 'utf8');
await writeFile(root + 'tracking-worker-bootstrap.js', config + '\n' + partytownSnippet() + `
// Replay calls captured before the bridge was installed, without duplicating native fallback events.
(function () {
    const early = window.RaptorTracking.pendingMeta.splice(0);
    early.forEach(function (args) { window.fbq.apply(window, args); });
}());
`);
console.log('Built versioned, same-origin Partytown worker assets.');

// Refresh the inlined canonical adapters without changing page-specific tracking events.
const queue = await readFile(root + 'tracking-queue.js', 'utf8');
const meta = await readFile(root + 'tracking-meta.js', 'utf8');
const pages = ['index.html', 'thank-you.html', 'policies/index.html', 'wholesale/index.html',
    ...(await readdir(root + 'products')).map(slug => `products/${slug}/index.html`)];
for (const page of pages) {
    let html = await readFile(root + page, 'utf8');
    const newline = html.includes('\r\n') ? '\r\n' : '\n';
    html = html.replace(/\/\* raptor-queue:start \*\/[\s\S]*?\/\* raptor-queue:end \*\//g,
        ('/* raptor-queue:start */\n' + queue + '/* raptor-queue:end */').replaceAll('\n', newline));
    html = html.replace(/\/\* raptor-meta:start \*\/[\s\S]*?\/\* raptor-meta:end \*\//g,
        ('/* raptor-meta:start */\n' + meta + '/* raptor-meta:end */').replaceAll('\n', newline));
    await writeFile(root + page, html);
}
