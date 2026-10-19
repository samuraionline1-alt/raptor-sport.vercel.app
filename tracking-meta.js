// Executes in the worker, or natively when Partytown falls back on an unsupported browser.
(function (w, d) {
    'use strict';
    w.RaptorInitMetaPixel = function () {
        if (!w.fbq || !w.fbq.loaded) {
            const fbq = function () {
                if (fbq.callMethod) fbq.callMethod.apply(fbq, arguments);
                else fbq.queue.push(arguments);
            };
            w.fbq = fbq;
            if (!w._fbq) w._fbq = fbq;
            fbq.push = fbq;
            fbq.loaded = true;
            fbq.version = '2.0';
            fbq.queue = [];
            const script = d.createElement('script');
            script.async = true;
            script.src = 'https://connect.facebook.net/en_US/fbevents.js';
            d.head.appendChild(script);
        }
    };
    w.RaptorReplayMetaQueue = function () {
        // The worker already receives forwarded calls. Only native fallback replays the saved copy.
        if (d.currentScript && String(d.currentScript.type).startsWith('text/partytown')) return;
        const tracking = w.RaptorTracking;
        if (!tracking) return;
        const pending = tracking.pendingMeta.splice(0);
        tracking.workerReady = true;
        pending.forEach(function (args) { w.fbq.apply(w, args); });
    };
}(window, document));
