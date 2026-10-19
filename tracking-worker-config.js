(function () {
    'use strict';
    // Retain a native copy until the worker is ready, including early checkout events.
    const tracking = window.RaptorTracking = window.RaptorTracking || { pendingMeta: [], workerReady: false };
    const pendingMeta = tracking.pendingMeta;
    window.dataLayer = window.dataLayer || [];
    window.fbq = window.fbq || function () {
        if (!tracking.workerReady) pendingMeta.push(Array.from(arguments));
    };
    document.addEventListener('pt0', function () {
        tracking.workerReady = true;
        pendingMeta.length = 0;
    }, { once: true });
    window.partytown = {
        lib: '/~partytown/1.0.1/',
        forward: [
            ['dataLayer.push', { preserveBehavior: true }],
            ['fbq', { preserveBehavior: true }]
        ],
        resolveUrl: function (url, location, type) {
            if (type === 'script' && (url.hostname === 'www.googletagmanager.com' || url.hostname === 'connect.facebook.net')) {
                const proxy = new URL('/api/tracking-script', location.origin);
                proxy.searchParams.set('url', url.href);
                return proxy;
            }
            return url;
        }
    };
}());
