import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
const manifest = JSON.parse(readFileSync('data/image-optimization.json', 'utf8'));
for (const [name, image] of Object.entries(manifest)) {
    const medium = image.variants.find(variant => variant.width === 960);
    assert.ok(medium, `${name}: a medium variant must exist`);
    assert.ok(medium.bytes < 200000, `${name}: medium image must stay below 200 kB`);
    for (const variant of image.variants) {
        assert.equal(statSync('.' + variant.url).size, variant.bytes);
    }
}
for (const path of ['index.html', ...readdirSync('products').map(slug => `products/${slug}/index.html`)]) {
    const html = readFileSync(path, 'utf8');
    assert.ok(!html.includes('@tailwindcss/browser'), `${path}: no runtime CSS compiler`);
    assert.ok(!/<script[^>]+src="[^"]*chart\.js/.test(html), `${path}: chart download must be deferred`);
    for (const image of html.matchAll(/<img\b[^>]*\bsrc="\/assets\/optimized\/[^>]*>/g)) {
        assert.match(image[0], /\bwidth="\d+"/);
        assert.match(image[0], /\bheight="\d+"/);
        if (!image[0].includes("logo-premium-image")) assert.match(image[0], /\bsrcset="/);
    }
}
const loader=readFileSync('performance.js','utf8');
assert.ok(loader.includes("script.src = '/assets/vendor/chart.umd-4.5.1.min.js'"),'Charts must load from this site under the enforced CSP');
const home = readFileSync('index.html', 'utf8');
assert.equal((home.match(/class="logo-premium-video"/g)||[]).length,2);
assert.ok(!home.includes("video.addEventListener('ended'"),'Brand animation must continue looping');
assert.ok(statSync('assets/optimized/raptor-logo-animation-240.mp4').size<200000,'Logo video should stay compact');
const backgrounds = [...home.matchAll(/<img[^>]*class="home-background-slide[^>]*>/g)].map(match => match[0]);
assert.equal(backgrounds.length, 4);
assert.equal(backgrounds.filter(tag => /\ssrc="/.test(tag)).length, 1);
const css = readFileSync('assets/site.css', 'utf8');
for (const utility of ['.hidden{', '.flex{', '.grid{']) assert.ok(css.includes(utility), `Compiled CSS: ${utility}`);
console.log('PASS: image size budgets, responsive asset references, compiled CSS and deferred background/chart loading.');
