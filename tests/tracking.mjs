import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Script, createContext, runInContext } from 'node:vm';
import { test } from 'node:test';
import { allowedScript, createHandler } from '../api/tracking-script.js';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
function response() {
    return {
        headers: {}, code: 0, body: undefined,
        setHeader(k, v) { this.headers[k] = v; }, status(v) { this.code = v; return this; },
        json(v) { this.body = v; return this; }, send(v) { this.body = v; return this; }
    };
}
test('script proxy accepts only the configured public vendor script paths', async () => {
    const good = ['https://www.googletagmanager.com/gtm.js?id=GTM-TW2P4VN5',
        'https://www.googletagmanager.com/gtag/js?id=G-XC85CBJKQW&cx=c',
        'https://connect.facebook.net/en_US/fbevents.js',
        'https://connect.facebook.net/signals/config/462184846324554?v=2'];
    good.forEach(url => assert.ok(allowedScript(url)));
    const bad = ['http://connect.facebook.net/en_US/fbevents.js',
        'https://user:pass@connect.facebook.net/en_US/fbevents.js',
        'https://connect.facebook.net:8443/en_US/fbevents.js',
        'https://connect.facebook.net.evil.test/en_US/fbevents.js',
        'https://127.0.0.1/en_US/fbevents.js',
        'https://connect.facebook.net/tr?id=462184846324554',
        'https://connect.facebook.net/signals/config/123',
        'https://www.googletagmanager.com/gtm.js?id=GTM-OTHER',
        'https://www.googletagmanager.com/gtag/js?id=anything'];
    const handler = createHandler(() => assert.fail('invalid input must never fetch'));
    for (const url of bad) {
        assert.equal(allowedScript(url), null);
        const res = response();
        await handler({ method: 'GET', url: '/api/tracking-script?url=' + encodeURIComponent(url) }, res);
        assert.equal(res.code, 400);
    }
    const repeated = response();
    await handler({ method: 'GET', url: '/api/tracking-script?url=' + encodeURIComponent(good[0]) + '&url=' + encodeURIComponent(good[1]) }, repeated);
    assert.equal(repeated.code, 400);
    const post = response();
    await handler({ method: 'POST', url: '/api/tracking-script' }, post);
    assert.equal(post.code, 405);
});
test('proxy strips vendor cookies, rejects redirects/non-script/oversized replies and retains short freshness', async () => {
    const request = { method: 'GET', url: '/api/tracking-script?url=' + encodeURIComponent('https://connect.facebook.net/en_US/fbevents.js') };
    const res = response();
    await createHandler(async (url, opts) => {
        assert.equal(opts.redirect, 'manual');
        assert.equal(opts.credentials, 'omit');
        assert.equal(opts.headers.Cookie, undefined);
        return new Response('window.testVendor = true;', { headers: { 'content-type': 'text/javascript', 'set-cookie': 'tracking-secret=mock' } });
    })(request, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.toString(), 'window.testVendor = true;');
    assert.equal(res.headers['Set-Cookie'], undefined);
    assert.match(res.headers['Cache-Control'], /s-maxage=300/);
    for (const upstream of [new Response('', { status: 302, headers: { location: 'http://127.0.0.1/private' } }),
        new Response('<html>error</html>', { headers: { 'content-type': 'text/html' } }),
        new Response('x'.repeat(1048577), { headers: { 'content-type': 'application/javascript' } })]) {
        const result = response();
        await createHandler(async () => upstream)(request, result);
        assert.equal(result.code, 502);
        assert.equal(result.headers['Cache-Control'], 'no-store');
    }
});
function pageRuntime() {
    const callbacks = new Map();
    const appended = [];
    const workerScripts = [...read('index.html').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
        .filter(m => /type="text\/partytown"/.test(m[1])).map(m => ({ type: 'text/partytown', innerHTML: m[2], src: '' }));
    const context = createContext({ console, URL, setTimeout: () => 1, clearTimeout: () => {},
        CustomEvent: class { constructor(type) { this.type = type; } }, navigator: {},
        addEventListener(name, fn) { callbacks.set('window:' + name, fn); } });
    context.window = context; context.top = context;
    const document = context.document = {
        readyState: 'loading', currentScript: null, documentElement: {},
        addEventListener(name, fn) { callbacks.set('document:' + name, fn); },
        querySelectorAll(selector) { assert.equal(selector, 'script[type="text/partytown"]'); return workerScripts.filter(s => s.type === 'text/partytown'); },
        querySelector() { return { appendChild() {} }; },
        getElementsByTagName() { return [{ parentNode: { insertBefore(node) { appended.push(node); } } }]; },
        createElement(name) { return { nodeName: name.toUpperCase(), type: '', style: {}, setAttribute() {} }; },
        head: { appendChild(node) {
            appended.push(node);
            if (node.innerHTML) {
                document.currentScript = node;
                runInContext(node.innerHTML, context);
                document.currentScript = null;
            }
        } }
    };
    runInContext(read('tracking-queue.js'), context);
    return { context, callbacks, appended };
}
test('early checkout events are forwarded once and retained natively until worker readiness', () => {
    const { context, callbacks } = pageRuntime();
    runInContext(`fbq('track','Purchase',{value:329,currency:'THB'}); dataLayer.push({event:'purchase'});`, context);
    runInContext(read('tracking-worker-bootstrap.js'), context);
    runInContext(`fbq('track','Lead');`, context);
    const forwarded = context._ptf;
    const metaEvents = [];
    for (let i = 0; i < forwarded.length; i += 2) {
        if (forwarded[i].join('.') === 'fbq') metaEvents.push(Array.from(forwarded[i + 1]));
    }
    assert.equal(metaEvents.filter(args => args[1] === 'Purchase').length, 1);
    assert.equal(metaEvents.filter(args => args[1] === 'Lead').length, 1);
    assert.equal(context.RaptorTracking.pendingMeta.length, 2);
    assert.equal(context.dataLayer.filter(e => e.event === 'purchase').length, 1);
    callbacks.get('document:pt0')();
    assert.equal(context.RaptorTracking.pendingMeta.length, 0);
    runInContext(`fbq('track','Contact');`, context);
    assert.equal(context.RaptorTracking.pendingMeta.length, 0, 'do not retain user events after the worker is ready');
});
test('actual Partytown native fallback retains early Purchase once and initializes PageView once', () => {
    const { context, callbacks, appended } = pageRuntime();
    runInContext(`fbq('track','Purchase',{value:329,currency:'THB'}); dataLayer.push({event:'purchase'});`, context);
    runInContext(read('tracking-worker-bootstrap.js'), context);
    runInContext(`fbq('track','Lead');`, context);
    callbacks.get('window:DOMContentLoaded')();
    const events = Array.from(context.fbq.queue, args => Array.from(args));
    for (const event of ['PageView', 'Purchase', 'Lead']) assert.equal(events.filter(args => args[1] === event).length, 1, event);
    assert.equal(events[0][0], 'init');
    assert.equal(context.dataLayer.filter(e => e.event === 'purchase').length, 1);
    assert.equal(appended.filter(s => s.src === 'https://connect.facebook.net/en_US/fbevents.js').length, 1);
    assert.equal(context.RaptorTracking.pendingMeta.length, 0);
});
test('worker adapter never replays the main-thread queue a second time', () => {
    const queue = [['track', 'Purchase']];
    const context = createContext({ window: { RaptorTracking: { pendingMeta: queue } }, document: {
        currentScript: { type: 'text/partytown-x' }, createElement: () => ({}), head: { appendChild() {} }
    } });
    runInContext(read('tracking-meta.js'), context);
    runInContext(`window.RaptorInitMetaPixel(); window.fbq('init','462184846324554'); window.fbq('track','PageView'); window.RaptorReplayMetaQueue();`, context);
    assert.equal(queue.length, 1);
    assert.equal(context.window.fbq.queue.length, 2);
});
test('retail templates retain vendor IDs, queue adapters and defer only vendor code', () => {
    for (const path of ['index.html', 'thank-you.html', 'policies/index.html', 'wholesale/index.html', ...readdirSync(new URL('../products/', import.meta.url)).map(slug => `products/${slug}/index.html`)]) {
        const html = read(path);
        const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
        assert.equal(scripts.filter(s => s[2].includes('www.googletagmanager.com/gtm.js') && /type="text\/partytown"/.test(s[1])).length, 1, path);
        assert.equal(scripts.filter(s => s[2].includes('RaptorInitMetaPixel();') && /type="text\/partytown"/.test(s[1])).length, 1, path);
        assert.ok(html.indexOf('raptor-queue:start') < html.indexOf('type="text/partytown"'), path);
        assert.match(html, /tracking-worker-bootstrap\.js[^>]*defer/);
        scripts.filter(s => !s[1].includes('application/ld+json')).forEach(s => assert.doesNotThrow(() => new Script(s[2]), path));
    }
});
