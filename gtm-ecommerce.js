(function () {
    'use strict';

    var CURRENCY = 'THB';
    var PENDING_ORDER_KEY = 'raptorPendingOrder';

    window.dataLayer = window.dataLayer || [];

    function pushEcommerce(eventName, ecommerce) {
        window.dataLayer.push({ ecommerce: null });
        window.dataLayer.push({ event: eventName, ecommerce: ecommerce });
    }

    function numberFrom(value) {
        var number = Number(String(value == null ? '' : value).replace(/[^0-9.]/g, ''));
        return Number.isFinite(number) ? number : 0;
    }

    function productJsonLd() {
        var scripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (var index = 0; index < scripts.length; index += 1) {
            try {
                var data = JSON.parse(scripts[index].textContent);
                var candidates = data['@graph'] || [data];
                var product = candidates.find(function (item) {
                    return item && (item['@type'] === 'Product' || (Array.isArray(item['@type']) && item['@type'].includes('Product')));
                });
                if (product) return product;
            } catch (error) {
                // Ignore unrelated or invalid structured-data blocks.
            }
        }
        return null;
    }

    function itemFromProduct(product) {
        var offer = Array.isArray(product.offers) ? product.offers[0] : (product.offers || {});
        return {
            item_id: String(product.sku || product.productID || location.pathname.split('/').filter(Boolean).pop() || product.name),
            item_name: product.name,
            price: numberFrom(offer.price),
            quantity: 1
        };
    }

    function orderFromForm(form) {
        var quantityField = form.querySelector('[name="quantity"]');
        var quantity = Math.max(1, parseInt(quantityField ? quantityField.value : '1', 10) || 1);
        var nameField = form.querySelector('[name="product"]');
        var priceField = form.querySelector('[name="price"]');
        var product = productJsonLd();
        var item = product ? itemFromProduct(product) : {
            item_id: form.dataset.productId || (nameField && nameField.value) || 'raptor-product',
            item_name: form.dataset.product || (nameField && nameField.value) || 'Raptor Sport Product',
            price: numberFrom(form.dataset.price || (priceField && priceField.value)),
            quantity: 1
        };
        item.quantity = quantity;
        if (!item.price) item.price = numberFrom(form.dataset.price || (priceField && priceField.value));
        return { currency: CURRENCY, value: item.price * quantity, items: [item] };
    }

    document.addEventListener('DOMContentLoaded', function () {
        var product = productJsonLd();
        if (product) {
            var item = itemFromProduct(product);
            pushEcommerce('view_item', { currency: CURRENCY, value: item.price, items: [item] });
        }

        document.querySelectorAll('.raptor-order-form').forEach(function (form) {
            form.addEventListener('submit', function () {
                var order = orderFromForm(form);
                pushEcommerce('begin_checkout', order);
                try {
                    sessionStorage.setItem(PENDING_ORDER_KEY, JSON.stringify(order));
                } catch (error) {
                    // Tracking must never prevent an order from being submitted.
                }
            }, true);
        });

        if (document.body.dataset.gtmPage === 'purchase') {
            try {
                var storedOrder = sessionStorage.getItem(PENDING_ORDER_KEY);
                if (!storedOrder) return;
                var order = JSON.parse(storedOrder);
                order.transaction_id = 'raptor-' + Date.now();
                pushEcommerce('purchase', order);
                sessionStorage.removeItem(PENDING_ORDER_KEY);
            } catch (error) {
                // Ignore unavailable storage or malformed stale order data.
            }
        }
    });
}());
