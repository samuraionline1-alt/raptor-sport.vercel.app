(function () {
    'use strict';
    function start() {
        var reduced = matchMedia('(prefers-reduced-motion: reduce)');
        document.querySelectorAll('video[data-logo-src]').forEach(function (video) {
            var started = false;
            function poster() { video.pause(); video.removeAttribute('src'); video.load(); }
            function playOnce() {
                if (started || reduced.matches || !video.getClientRects().length) return;
                started = true;
                video.src = video.dataset.logoSrc;
                video.muted = true;
                var result = video.play();
                if (result && result.catch) result.catch(poster);
            }
            video.addEventListener('ended', poster);
            video.addEventListener('error', poster, {once:true});
            window.addEventListener('resize', playOnce);
            playOnce();
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
}());
