(function () {
    'use strict';
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const compactScreen = matchMedia('(max-width: 640px)');
    let chartPromise;
    const watchedCharts = new WeakSet();
    function loadCharts() {
        if (window.Chart) return Promise.resolve();
        if (!chartPromise) chartPromise = new Promise(function (resolve, reject) {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js';
            script.onload = resolve;
            script.onerror = function () { chartPromise = null; script.remove(); reject(new Error('Chart unavailable')); };
            document.head.appendChild(script);
        });
        return chartPromise;
    }
    window.RaptorPerformance = {
        observeChart: function (id, render) {
            const canvas = document.getElementById(id);
            if (!canvas || watchedCharts.has(canvas)) return;
            watchedCharts.add(canvas);
            async function draw() {
                try { await loadCharts(); render(); }
                catch (_) { watchedCharts.delete(canvas); }
            }
            if (!('IntersectionObserver' in window)) { draw(); return; }
            const observer = new IntersectionObserver(function (entries) {
                if (entries.some(function (entry) { return entry.isIntersecting; })) {
                    observer.disconnect(); draw();
                }
            }, { rootMargin: '150px' });
            observer.observe(canvas);
        }
    };
    document.addEventListener('visibilitychange', function () {
        document.documentElement.classList.toggle('page-paused', document.hidden);
    });
    document.addEventListener('DOMContentLoaded', function () {
        // Mobile/reduced-motion CSS already stops decoration; avoid extra observer layout work.
        if ('IntersectionObserver' in window && !compactScreen.matches && !reducedMotion.matches) {
            const observer = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) { entry.target.classList.toggle('motion-paused', !entry.isIntersecting); });
            });
            document.querySelectorAll('.animate-fire, .athlete-card, .speed-line, .motivation-orb, .orbit-dot, .quick-coupon-ticket, .order-submit-cta').forEach(function (node) { observer.observe(node); });
        }
        const slides = Array.from(document.querySelectorAll('.home-background-slide'));
        if (slides.length < 2) return;
        const hero = slides[0].closest('section') || slides[0].parentElement;
        let visible = true, active = 0, timer, busy = false;
        function stop() { clearTimeout(timer); }
        function schedule() {
            stop();
            if (!document.hidden && visible && !reducedMotion.matches && !compactScreen.matches) timer = setTimeout(advance, 5000);
        }
        async function advance() {
            if (busy || document.hidden || !visible || reducedMotion.matches || compactScreen.matches) return;
            busy = true;
            const nextIndex = (active + 1) % slides.length;
            const next = slides[nextIndex];
            try {
                if (next.dataset.src) {
                    if (next.dataset.srcset) next.srcset = next.dataset.srcset;
                    next.src = next.dataset.src;
                    delete next.dataset.src;
                }
                await next.decode();
                if (!document.hidden && visible && !reducedMotion.matches && !compactScreen.matches) {
                    slides[active].classList.remove('is-active');
                    next.classList.add('is-active'); active = nextIndex;
                }
            } catch (_) { /* Retain the current background if a later image fails. */ }
            busy = false; schedule();
        }
        if ('IntersectionObserver' in window) {
            const observer = new IntersectionObserver(function (entries) { visible = entries[0].isIntersecting; schedule(); });
            observer.observe(hero);
        }
        document.addEventListener('visibilitychange', schedule);
        reducedMotion.addEventListener('change', schedule);
        compactScreen.addEventListener('change', schedule);
        schedule();
    });
}());
