// Inlined before any page scripts: save early calls until the worker bridge is installed.
window.dataLayer = window.dataLayer || [];
window.RaptorTracking = window.RaptorTracking || { pendingMeta: [], workerReady: false };
window.fbq = window.fbq || function () {
    if (!window.RaptorTracking.workerReady) window.RaptorTracking.pendingMeta.push(Array.from(arguments));
};
