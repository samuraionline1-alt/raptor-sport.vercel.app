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
        var totalField = form.querySelector('[name="total_price"]');
        var product = productJsonLd();
        var item = product ? itemFromProduct(product) : {
            item_id: form.dataset.productId || (nameField && nameField.value) || 'raptor-product',
            item_name: form.dataset.product || (nameField && nameField.value) || 'Raptor Sport Product',
            price: numberFrom(form.dataset.price || (priceField && priceField.value)),
            quantity: 1
        };
        item.quantity = quantity;
        if (!item.price) item.price = numberFrom(form.dataset.price || (priceField && priceField.value));
        var exactTotal = numberFrom(totalField && totalField.value) || (item.price * quantity);
        item.price = exactTotal / quantity;
        return { currency: CURRENCY, value: exactTotal, items: [item] };
    }

    document.addEventListener('raptor:order-confirmed', function (event) {
        var receipt = event.detail;
        if (!receipt?.order_ref || !['paid','cod'].includes(receipt.payment_status)) return;
        try {
            var key = 'raptorPurchase:' + receipt.order_ref;
            if (sessionStorage.getItem(key)) return;
            // Mark before analytics: a broken tracking provider must not duplicate purchases on retry.
            sessionStorage.setItem(key,'1');
            var items = (receipt.items || []).map(function (line) { return {item_id:line.sku,item_name:line.name,quantity:line.quantity,price:line.line_total_cents / 100 / line.quantity}; });
            pushEcommerce('purchase',{transaction_id:receipt.order_ref,currency:CURRENCY,value:receipt.total_price,items:items});
            if (typeof window.fbq === 'function') window.fbq('track','Purchase',{value:receipt.total_price,currency:CURRENCY,content_name:receipt.product,num_items:receipt.quantity},{eventID:receipt.order_ref});
            sessionStorage.removeItem(PENDING_ORDER_KEY);
        } catch (_) { /* Receipt remains usable when analytics/storage is unavailable. */ }
    });

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

    });
}());
