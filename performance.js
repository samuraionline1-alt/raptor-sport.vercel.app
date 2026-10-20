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
            script.src = '/assets/vendor/chart.umd-4.5.1.min.js';
            script.onload = function () {
                if (window.Chart) { if (reducedMotion.matches) window.Chart.defaults.animation = false; resolve(); }
                else { chartPromise = null; script.remove(); reject(new Error('Chart unavailable')); }
            };
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
            let drawing = false;
            let status;
            async function draw() {
                if (drawing) return;
                drawing = true;
                const retry = status?.querySelector('button');
                if (retry) retry.disabled = true;
                try {
                    await loadCharts(); render();
                    status?.remove(); status = null;
                } catch (_) {
                    // Keep a usable retry action rather than an unexplained empty canvas.
                    if (!status) {
                        status = document.createElement('div');
                        status.className = 'chart-load-status'; status.setAttribute('role','status');
                        const text = document.createElement('span');
                        text.textContent = 'ยังโหลดกราฟไม่ได้ กรุณาลองอีกครั้ง';
                        const button = document.createElement('button'); button.type = 'button';
                        button.textContent = 'โหลดกราฟอีกครั้ง'; button.addEventListener('click',draw);
                        status.append(text,button); canvas.parentElement.appendChild(status);
                    }
                    status.querySelector('button').disabled = false;
                } finally { drawing = false; }
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
    function restoreLogoMotion() {
        const logos = Array.from(document.querySelectorAll('video.logo-premium-video'));
        if (!logos.length) return;
        const visibility = new WeakMap();
        function sync(video) {
            const visible = video.getClientRects().length > 0 && visibility.get(video) !== false;
            if (document.hidden || reducedMotion.matches || !visible) {
                video.pause(); video.parentElement.dataset.logoState = 'paused'; return;
            }
            video.muted = true; video.defaultMuted = true; video.loop = true;
            if (!video.getAttribute('src') && video.dataset.logoSrc) video.src = video.dataset.logoSrc;
            const playback = video.play();
            if (playback?.catch) playback.catch(function () { video.parentElement.dataset.logoState = 'fallback'; });
        }
        function syncAll() { logos.forEach(sync); }
        logos.forEach(function (video) {
            video.addEventListener('playing', function () { video.parentElement.dataset.logoState = 'playing'; });
            video.addEventListener('error', function () { video.parentElement.dataset.logoState = 'fallback'; });
        });
        if ('IntersectionObserver' in window) {
            const observer = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) { visibility.set(entry.target, entry.isIntersecting); sync(entry.target); });
            });
            logos.forEach(function (video) { observer.observe(video); });
        }
        // Safari may refuse autoplay in Low Power Mode. Retry after a user gesture.
        document.addEventListener('pointerdown',syncAll,{passive:true});
        document.addEventListener('visibilitychange',syncAll);
        reducedMotion.addEventListener('change',syncAll);
        compactScreen.addEventListener('change',syncAll);
        syncAll();
    }
    document.addEventListener('DOMContentLoaded', function () {
        restoreLogoMotion();
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
