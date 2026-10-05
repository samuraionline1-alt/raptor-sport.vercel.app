(function () {
    'use strict';

    const bars = Array.from(document.querySelectorAll('[data-sticky-order-bar]'));
    if (!bars.length) return;

    const forms = Array.from(document.querySelectorAll('.raptor-order-form, #order-form'));
    const viewport = window.visualViewport;
    let fullHeight = window.innerHeight;
    let viewportWidth = window.innerWidth;

    function isTyping() {
        return document.activeElement && document.activeElement.matches('input, textarea, select');
    }

    function update() {
        // Keep the unoccluded height even on browsers that resize the layout viewport.
        // Reset on rotation so a shorter landscape viewport is not treated as a keyboard.
        if (Math.abs(window.innerWidth - viewportWidth) > 100) {
            viewportWidth = window.innerWidth;
            fullHeight = window.innerHeight;
        }
        const height = viewport ? viewport.height * viewport.scale : window.innerHeight;
        fullHeight = Math.max(fullHeight, window.innerHeight, height);
        const keyboardOpen = fullHeight - height > Math.max(150, fullHeight * 0.2);
        const typing = Boolean(isTyping() || keyboardOpen);
        const viewportBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
        // Also stay hidden after passing the form: the CTA belongs to the upper content.
        const atOrPastForm = forms.some(function (form) {
            const rect = form.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && rect.top < viewportBottom;
        });
        const hidden = typing || atOrPastForm;

        bars.forEach(function (bar) {
            bar.toggleAttribute('data-typing', typing);
            bar.toggleAttribute('data-hidden', hidden);
            bar.setAttribute('aria-hidden', String(hidden));
            bar.inert = hidden;
        });
    }

    document.addEventListener('focusin', update);
    document.addEventListener('focusout', function () {
        // Wait until focus moves to the next element before deciding to show the bar.
        window.setTimeout(update, 0);
    });
    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver(update, { threshold: 0 });
        forms.forEach(function (form) { observer.observe(form); });
    }
    // Scroll also handles returning above the form after it has left the viewport.
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    window.addEventListener('pageshow', update);
    if (viewport) {
        viewport.addEventListener('resize', update);
        viewport.addEventListener('scroll', update, { passive: true });
    }
    update();
}());
