(function () {
    'use strict';

    var FORM_ENDPOINT = 'https://formspree.io/f/mvzyqnag';
    var PENDING_ORDER_KEY = 'raptorPendingOrder';

    function numeric(value) {
        var result = Number(String(value == null ? '' : value).replace(/[^0-9.]/g, ''));
        return Number.isFinite(result) ? result : 0;
    }

    function details(form) {
        var quantity = Math.max(1, parseInt(form.querySelector('[name="quantity"]')?.value || '1', 10));
        var unitPrice = numeric(form.dataset.price || form.querySelector('[name="price"]')?.value);
        var totalPrice = numeric(form.querySelector('[name="total_price"]')?.value) || unitPrice * quantity;
        return {
            product: form.querySelector('[name="product"]')?.value || form.dataset.product || 'Raptor Sport Product',
            unitPrice: unitPrice,
            quantity: quantity,
            totalPrice: totalPrice,
            bundleTier: `เซ็ต ${quantity} ชิ้น (฿${totalPrice})`,
            customer_name: form.querySelector('[name="customer_name"]')?.value || '',
            phone: form.querySelector('[name="phone"]')?.value || '',
            address: form.querySelector('[name="address"]')?.value || '',
            order_details: form.querySelector('[name="order_details"]')?.value || '',
            page_url: window.location.href
        };
    }

    function ecommerce(order) {
        return { currency: 'THB', value: order.totalPrice, items: [{
            item_id: location.pathname.split('/').filter(Boolean).pop() || 'raptor-product',
            item_name: order.product,
            price: order.totalPrice / order.quantity,
            quantity: order.quantity
        }] };
    }

    function addPaymentSelector(form) {
        var oldField = form.querySelector('input[type="hidden"][name="payment_method"]');
        if (oldField) oldField.remove();
        if (form.querySelector('[data-payment-selector]')) return;
        var fieldset = document.createElement('fieldset');
        fieldset.dataset.paymentSelector = '';
        fieldset.className = 'space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4';
        fieldset.innerHTML = '<legend class="px-1 text-sm font-bold text-slate-800">เลือกวิธีชำระเงิน</legend>' +
            '<label class="flex cursor-pointer gap-3 rounded-lg bg-white p-3 text-sm text-slate-800 shadow-sm"><input class="mt-1 accent-orange-500" type="radio" name="payment_method" value="COD" checked><span><strong>🚚 เก็บเงินปลายทาง (COD)</strong><br>รับของก่อนจ่ายเงินที่หน้าบ้าน</span></label>' +
            '<label class="flex cursor-pointer gap-3 rounded-lg bg-white p-3 text-sm text-slate-800 shadow-sm"><input class="mt-1 accent-orange-500" type="radio" name="payment_method" value="STRIPE"><span><strong>📲 สแกน QR PromptPay / บัตรเครดิต</strong><br>ชำระออนไลน์ปลอดภัย 100% (ไม่ต้องรอรับสายขนส่ง)</span></label>';
        var button = form.querySelector('button[type="submit"], button:not([type])');
        button?.insertAdjacentElement('beforebegin', fieldset);
        function updateButton() {
            if (!button || button.disabled) return;
            button.textContent = form.querySelector('[name="payment_method"]:checked')?.value === 'STRIPE'
                ? 'ดำเนินการสแกน QR / ชำระเงินออนไลน์'
                : 'ยืนยันการสั่งซื้อเก็บเงินปลายทาง';
        }
        fieldset.addEventListener('change', updateButton);
        updateButton();
    }

    document.addEventListener('DOMContentLoaded', function () {
        document.querySelectorAll('.raptor-order-form').forEach(addPaymentSelector);
    });

    document.addEventListener('submit', async function (event) {
        var form = event.target;
        if (!form.matches('.raptor-order-form')) return;
        var order = details(form);
        order.phone = RaptorOrders.cleanPhone(order.phone);
        order.order_ref = RaptorOrders.createRef(order.phone);
        order.total_price = `฿${order.totalPrice}`;
        order.price = order.total_price;
        order.bundle_tier = order.bundleTier;
        const { product, quantity, totalPrice, address } = order;
        const orderRef = order.order_ref, cleanPhone = order.phone, customerName = order.customer_name;
        const notes = order.order_details;
        order.order_details = `รหัส: #${orderRef} | สินค้า: ${product} (จำนวน ${quantity} ชิ้น) | ยอดสุทธิ: ฿${totalPrice} | ลูกค้า: ${customerName} (${cleanPhone}) | ที่อยู่: ${address}`;
        form.addEventListener('formdata', function (event) {
            event.formData.set('bundle_tier', order.bundleTier);
            event.formData.set('bundle_tier_choice', order.bundleTier);
            event.formData.set('order_details', order.order_details);
            if (notes) event.formData.set('customer_notes', notes);
        }, { once: true });
        ['order_ref', 'phone', 'price', 'total_price', 'bundle_tier'].forEach(function (key) {
            var input = form.querySelector('[name="' + key + '"]');
            if (!input) { input = document.createElement('input'); input.type = 'hidden'; input.name = key; form.appendChild(input); }
            input.value = order[key];
        });
        RaptorOrders.save(order);
        if (form.querySelector('[name="payment_method"]:checked')?.value !== 'STRIPE') return;
        event.preventDefault();
        event.stopImmediatePropagation();

        var button = form.querySelector('button[type="submit"], button:not([type])');
        var originalText = button?.textContent;
        if (button) { button.disabled = true; button.textContent = 'กำลังเปิดหน้าชำระเงิน...'; }
        var tracking = ecommerce(order);
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({ ecommerce: null });
        window.dataLayer.push({ event: 'begin_checkout', ecommerce: tracking });
        if (typeof window.fbq === 'function') window.fbq('track', 'InitiateCheckout', { value: order.totalPrice, currency: 'THB', content_name: order.product, num_items: order.quantity });
        try { sessionStorage.setItem(PENDING_ORDER_KEY, JSON.stringify(tracking)); } catch (_) {}

        var backup = new FormData(form);
        backup.set('payment_status', 'Pending Online Payment (Stripe)');
        fetch(FORM_ENDPOINT, { method: 'POST', body: backup, headers: { Accept: 'application/json' }, keepalive: true }).catch(function () {});

        try {
            var response = await fetch('/api/create-checkout-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(order) });
            var data = await response.json();
            if (!response.ok || !data.url) throw new Error(data.error || 'ไม่สามารถเปิดหน้าชำระเงินได้');
            window.location.href = data.url;
        } catch (error) {
            if (button) { button.disabled = false; button.textContent = originalText; }
            alert(error.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
        }
    }, true);
}());
