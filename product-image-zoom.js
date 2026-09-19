(function () {
    function createLightbox() {
        const dialog = document.createElement('dialog');
        dialog.className = 'product-image-lightbox';
        dialog.setAttribute('aria-label', 'ภาพสินค้าขนาดใหญ่');
        dialog.innerHTML = [
            '<button class="product-image-lightbox__close" type="button" aria-label="ปิดภาพขนาดใหญ่">&times;</button>',
            '<img class="product-image-lightbox__image" alt="">',
            '<p class="product-image-lightbox__hint">แตะที่ภาพเพื่อขยายเพิ่ม</p>'
        ].join('');
        document.body.appendChild(dialog);

        const largeImage = dialog.querySelector('.product-image-lightbox__image');
        const hint = dialog.querySelector('.product-image-lightbox__hint');
        const closeButton = dialog.querySelector('.product-image-lightbox__close');

        function close() {
            dialog.close();
            largeImage.classList.remove('is-zoomed');
            document.body.style.overflow = '';
        }

        closeButton.addEventListener('click', close);
        dialog.addEventListener('click', function (event) {
            if (event.target === dialog) close();
        });
        dialog.addEventListener('cancel', function (event) {
            event.preventDefault();
            close();
        });
        largeImage.addEventListener('click', function () {
            const isZoomed = largeImage.classList.toggle('is-zoomed');
            hint.textContent = isZoomed ? 'แตะอีกครั้งเพื่อย่อภาพ' : 'แตะที่ภาพเพื่อขยายเพิ่ม';
        });

        return function open(sourceImage) {
            largeImage.src = sourceImage.currentSrc || sourceImage.src;
            largeImage.alt = sourceImage.alt || 'ภาพสินค้า';
            hint.textContent = 'แตะที่ภาพเพื่อขยายเพิ่ม';
            dialog.showModal();
            document.body.style.overflow = 'hidden';
            closeButton.focus();
        };
    }

    document.addEventListener('DOMContentLoaded', function () {
        const productImages = document.querySelectorAll('.product-main-image');
        if (!productImages.length || typeof HTMLDialogElement === 'undefined') return;

        const openLightbox = createLightbox();
        productImages.forEach(function (image) {
            const wrapper = document.createElement('span');
            wrapper.className = 'product-image-zoom';
            image.parentNode.insertBefore(wrapper, image);
            wrapper.appendChild(image);

            const button = document.createElement('button');
            button.className = 'product-image-zoom__trigger';
            button.type = 'button';
            button.setAttribute('aria-label', 'ขยายดูภาพ ' + (image.alt || 'สินค้า'));
            button.innerHTML = '<i class="fa-solid fa-magnifying-glass-plus" aria-hidden="true"></i>';
            button.addEventListener('click', function () { openLightbox(image); });
            wrapper.appendChild(button);

            image.addEventListener('click', function () { openLightbox(image); });
            image.setAttribute('tabindex', '0');
            image.setAttribute('role', 'button');
            image.setAttribute('aria-label', 'ขยายดูภาพ ' + (image.alt || 'สินค้า'));
            image.addEventListener('keydown', function (event) {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openLightbox(image);
                }
            });
        });
    });
}());
