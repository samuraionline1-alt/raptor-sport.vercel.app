import { readdirSync, readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import assert from 'node:assert/strict';
let checked = 0;
for (const slug of readdirSync(new URL('../products/', import.meta.url))) {
    const html = readFileSync(new URL(`../products/${slug}/index.html`, import.meta.url), 'utf8');
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
        if (/application\/ld\+json/.test(match[1]) || !match[2].trim()) continue;
        assert.doesNotThrow(() => new Script(match[2]), `${slug}: inline script must parse`);
        checked++;
    }
}
console.log(`PASS: ${checked} product-page inline scripts parse successfully`);
