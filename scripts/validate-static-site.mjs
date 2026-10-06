import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// This storefront deploys static HTML directly; its build validates executable
// scripts, structured data and the shared product template without generating files.
for (const dir of ['.', 'api', 'lib', 'scripts']) {
    for (const file of readdirSync(dir).filter(file => /\.(?:js|mjs)$/.test(file))) {
        const result = spawnSync(process.execPath, ['--check', join(dir, file)], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
    }
}
for (const product of readdirSync('products')) {
    const path = `products/${product}/index.html`;
    const html = readFileSync(path, 'utf8');
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
        if (/application\/ld\+json/.test(match[1])) JSON.parse(match[2]);
        else new vm.Script(match[2], { filename: path });
    }
    assert.ok(html.includes('/product-layout.css?v=20261006'), path);
    assert.ok(html.includes('bg-slate-50 rounded-2xl max-w-5xl w-full'), path);
    assert.ok(html.includes('border-blue-500 max-w-xl mx-auto space-y-6'), path);
    assert.equal((html.match(/<form[^>]*raptor-order-form/g) || []).length, 1, path);
    assert.ok(html.includes("fbq('init', '462184846324554')"), path);
}
console.log('Static build passed: JavaScript syntax, structured data, all 12 product templates and Meta Pixel configuration.');
