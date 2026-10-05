(function () {
    'use strict';

    const MULTI_CLICK_WINDOW_MS = 1200;
    const brandLinks = Array.from(document.querySelectorAll('header a')).filter(function (link) {
        return link.querySelector('.logo-premium-video') || /^RAPTOR(?:\s|$)/i.test(link.textContent.trim());
    });

    brandLinks.forEach(function (brandLink) {
        let clickCount = 0;
        let firstClickAt = 0;
        let navigationTimer;

        brandLink.addEventListener('click', function (event) {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                return;
            }

            event.preventDefault();

            const clickedAt = Date.now();
            if (!firstClickAt || clickedAt - firstClickAt > MULTI_CLICK_WINDOW_MS) {
                clickCount = 0;
                firstClickAt = clickedAt;
                window.clearTimeout(navigationTimer);
            }

            clickCount += 1;

            if (clickCount === 3 && clickedAt - firstClickAt <= MULTI_CLICK_WINDOW_MS) {
                window.clearTimeout(navigationTimer);
                window.location.href = '/wholesale/';
                return;
            }

            window.clearTimeout(navigationTimer);
            navigationTimer = window.setTimeout(function () {
                window.location.href = brandLink.getAttribute('href') || '/';
                clickCount = 0;
                firstClickAt = 0;
            }, Math.max(0, MULTI_CLICK_WINDOW_MS - (clickedAt - firstClickAt)));
        });
    });
}());
