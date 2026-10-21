(function () {
    'use strict';

    var CURRENCY = 'THB';
    var PENDING_ORDER_KEY = 'raptorPendingOrder';
    var sent = new Set();

    window.dataLayer = window.dataLayer || [];


    // Event names are reporting contracts: do not derive them from SEO headings.
    var legacySuffixes = {
        'raptor-cool-patch': 'RAPTOR_COOL_PATCH',
        'raptor-cooling-spray': 'RAPTOR_SPORTS_ICE_COLD_SPRAY',
        'raptor-ice-cold-spray': 'RAPTOR_SPORTS_ICE_COLD_SPRAY',
        'raptor-dual-action-pack': 'RAPTOR_DUAL_ACTION_PACK',
        'raptor-go-energy-gel': 'RAPTOR_GO_ENERGY_GEL',
        'raptor-herbal-cooling-gel': 'RAPTOR_HERBAL_COOLING_GEL',
        'raptor-herbal-roll-on': 'RAPTOR_HERBAL_ROLL_ON',
        'raptor-ice-defense-sport-shampoo': 'RAPTOR_ICE_DEFENSE_SPORT_SHAMPOO',
        'raptor-sport-foot-spray': 'RAPTOR_SPORT_FOOT_SPRAY',
        'raptor-sport-therapy-oil': 'RAPTOR_SPORT_THERAPY_OIL',
        'raptor-v-mix': 'RAPTOR_V_MIX',
        'raptor-warming-spray': 'RAPTOR_ELITE_PRO_WARMING_SPRAY'
    };
    function pageSku() {
        var match = location.pathname.match(/^\/products\/([^/]+)/);
        return match ? match[1] : '';
    }
    function legacySuffix(name, sku) {
        return legacySuffixes[sku] || String(name || '').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    }
    function productParams(params) {
        var payload = Object.assign({}, params || {});
        var nameField = document.querySelector('.raptor-order-form [name="product"]');
        if (payload.content_name && pageSku() && nameField && nameField.value) payload.content_name = nameField.value;
        return payload;
    }
    // Reconnect the existing social, section, order-button and submit handlers.
    // Static product bootstraps already send ViewContent and Viewcontent_* once.
    window.trackRaptorPixel = function (eventName, params, isCustomEvent) {
        try {
            if (typeof window.fbq !== 'function') return;
            var payload = productParams(params);
            var suffix = payload.content_name ? legacySuffix(payload.content_name, pageSku()) : '';
            var customName = suffix ? (eventName === 'ViewContent' ? 'Viewcontent' : eventName) + '_' + suffix : eventName;
            if (!isCustomEvent) window.fbq('track', eventName, payload);
            if (isCustomEvent || suffix) window.fbq('trackCustom', customName, payload);
        } catch (_) { /* Tracking never blocks navigation or checkout. */ }
    };

    function pushEcommerce(eventName, ecommerce) {
        window.dataLayer.push({ ecommerce: null });
        // The published Ads conversion reads value at the data-layer root.
        window.dataLayer.push({ event: eventName, ecommerce: ecommerce, value: ecommerce.value, currency: ecommerce.currency, transaction_id: ecommerce.transaction_id || null });
        // The published GTM v5 initializes GA4 but has no ecommerce event tags.
        // Send to that existing GA4 destination without another config/PageView.
        (function () {
            window.dataLayer.push(arguments);
        }('event', eventName, Object.assign({ send_to: 'G-XC85CBJKQW' }, ecommerce)));
    }

    window.RaptorEcommerce = { track: pushEcommerce };

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
        var key = 'raptorPurchase:' + receipt.order_ref;
        function seen(name) { if(sent.has(name))return true;try { return sessionStorage.getItem(name)==='1'; } catch (_) { return false; } }
        function mark(name) { sent.add(name);try { sessionStorage.setItem(name,'1'); } catch (_) {} }
        var items = (receipt.items || []).map(function (line) { return {item_id:line.sku,item_name:line.name,quantity:line.quantity,price:line.line_total_cents / 100 / line.quantity}; });
        if(!seen(key)) {
            try {
                pushEcommerce('purchase',{transaction_id:receipt.order_ref,currency:CURRENCY,value:receipt.total_price,items:items});
                mark(key);
            } catch (_) { /* Another provider can still receive its conversion. */ }
        }
        var metaKey='raptorMetaPurchase:'+receipt.order_ref;
        if(!seen(metaKey) && typeof window.fbq==='function') {
            var name=items.length===1?items[0].item_name:receipt.product;
            var suffix=legacySuffix(name, items.length===1 ? items[0].item_id : '');
            var params={value:receipt.total_price,currency:CURRENCY,content_name:name,content_category:'Raptor Sport Order',content_type:'product',num_items:receipt.quantity};
            try {
                window.fbq('track','Lead',params);
                window.fbq('trackCustom','Lead_'+suffix,params);
                window.fbq('track','Purchase',params,{eventID:receipt.order_ref});
                window.fbq('trackCustom','Purchase_'+suffix,params,{eventID:receipt.order_ref+':custom'});
                window.fbq('trackCustom','RaptorOrderSubmitted_'+suffix,params,{eventID:receipt.order_ref+':submitted'});
                mark(metaKey);
            } catch (_) { /* Retry on a later verified confirmation if Pixel is unavailable. */ }
        }
        try { sessionStorage.removeItem(PENDING_ORDER_KEY); } catch (_) {}

    });

    document.addEventListener('DOMContentLoaded', function () {
        var product = productJsonLd();
        if (product) {
            var item = itemFromProduct(product);
            pushEcommerce('view_item', { currency: CURRENCY, value: item.price, items: [item] });
            // Product pages replaced modal navigation; preserve the legacy product-view event.
            try {
                var params=productParams({content_name:item.item_name,content_category:'Raptor Sport Product',content_type:'product',value:item.price,currency:CURRENCY});
                if(typeof window.trackRaptorPixel==='function')window.trackRaptorPixel('RaptorProductView',params,true);
            } catch (_) {}

        }


        // The shop is now a hash section rather than the old category/modal view.
        var shop = document.getElementById('shop');
        if (shop) {
            var categorySent = false;
            var observer;
            function categoryView() {
                if (categorySent || typeof window.fbq !== 'function') return;
                window.fbq('trackCustom', 'ViewCategory', {content_name:'Raptor Sport Products',content_category:'Raptor Sport Product',currency:CURRENCY});
                categorySent = true;
                if (observer) observer.disconnect();
            }
            if ('IntersectionObserver' in window) {
                observer = new IntersectionObserver(function (entries) {
                    if (entries.some(function (entry) { return entry.isIntersecting; })) categoryView();
                }, {threshold:0.1});
                observer.observe(shop);
            }
            function hashCategoryView() { if (location.hash === '#shop') categoryView(); }
            window.addEventListener('hashchange', hashCategoryView);
            hashCategoryView();
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
