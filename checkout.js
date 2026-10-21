(function () {
    'use strict';

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
            sku: form.dataset.sku,
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
        // Keep the visible heading inside the panel; native legends sit on its border.
        var paymentSelector = document.createElement('div');
        paymentSelector.setAttribute('role', 'radiogroup');
        paymentSelector.setAttribute('aria-label', 'เลือกวิธีชำระเงิน');
        paymentSelector.dataset.paymentSelector = '';
        paymentSelector.className = 'payment-selector';
        paymentSelector.innerHTML = '<p class="payment-selector-title" aria-hidden="true">เลือกวิธีชำระเงิน</p>' +
            '<label class="payment-selector-option"><input class="payment-selector-radio" type="radio" name="payment_method" value="COD" checked><span><strong>🚚 เก็บเงินปลายทาง (COD)</strong><br>รับของก่อนจ่ายเงินที่หน้าบ้าน</span></label>' +
            '<label class="payment-selector-option"><input class="payment-selector-radio" type="radio" name="payment_method" value="STRIPE"><span><strong>📲 สแกน QR PromptPay / บัตรเครดิต</strong><br>ชำระออนไลน์ปลอดภัย 100% (ไม่ต้องรอรับสายขนส่ง)</span></label>';
        var button = form.querySelector('button[type="submit"], button:not([type])');
        button?.insertAdjacentElement('beforebegin', paymentSelector);
        function updateButton() {
            if (!button || button.disabled) return;
            button.textContent = form.querySelector('[name="payment_method"]:checked')?.value === 'STRIPE'
                ? 'ดำเนินการสแกน QR / ชำระเงินออนไลน์'
                : 'ยืนยันการสั่งซื้อเก็บเงินปลายทาง';
        }
        paymentSelector.addEventListener('change', function () { updateButton(); if (window.RaptorPromotions) RaptorPromotions.update(form); });
        updateButton();
        if (window.RaptorPromotions) RaptorPromotions.update(form);
    }

    document.addEventListener('DOMContentLoaded', function () {
        document.querySelectorAll('.raptor-order-form').forEach(addPaymentSelector);
    });

    document.addEventListener('submit', async function (event) {
        var form = event.target;
        if (!form.matches('.raptor-order-form')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (form.dataset.submitting === '1') return;
        var order = details(form);
        if (window.RaptorPromotions) Object.assign(order, RaptorPromotions.update(form));
        order.phone = RaptorOrders.cleanPhone(order.phone);
        var signature = JSON.stringify(order) + (form.querySelector('[name="payment_method"]:checked')?.value || 'COD');
        if (form.dataset.orderSignature !== signature) {
            form.dataset.orderSignature = signature;
            form.dataset.orderRef = RaptorOrders.createRef(order.phone);
            form.dataset.receiptToken = RaptorOrders.createToken();
        }
        order.order_ref = form.dataset.orderRef;
        order.receipt_token = form.dataset.receiptToken;
        order.total_price = order.totalPrice;
        order.price = order.total_price;
        order.bundle_tier = order.bundleTier;
        const { product, quantity, totalPrice, address } = order;
        const orderRef = order.order_ref, cleanPhone = order.phone, customerName = order.customer_name;
        const notes = order.order_details;
        order.note = notes;
        order.payment_method = form.querySelector('[name="payment_method"]:checked')?.value || 'COD';
        order.order_details = `รหัส: #${orderRef} | สินค้า: ${product} (จำนวน ${quantity} ชิ้น) | ของแถม: ${order.free_gifts || "ไม่มี"} | คูปอง: ${order.coupon_code || "ไม่มี"} | ยอดสุทธิ: ฿${totalPrice} | ลูกค้า: ${customerName} (${cleanPhone}) | ที่อยู่: ${address}`;
        form.addEventListener('formdata', function (event) {
            event.formData.set('bundle_tier', order.bundleTier);
            event.formData.set('bundle_tier_choice', order.bundleTier);
            event.formData.set('order_details', order.order_details);
            if (notes) event.formData.set('customer_notes', notes);
        }, { once: true });
        ['order_ref', 'phone', 'price', 'total_price', 'bundle_tier', 'coupon_code', 'discount_amount', 'free_gifts'].forEach(function (key) {
            var input = form.querySelector('[name="' + key + '"]');
            if (!input) { input = document.createElement('input'); input.type = 'hidden'; input.name = key; form.appendChild(input); }
            input.value = order[key];
        });
        RaptorOrders.save(order);
        form.dataset.submitting = '1';
        var button = form.querySelector('button[type="submit"], button:not([type])');
        var originalText = button?.innerHTML;
        if (button) { button.disabled = true; button.textContent = order.payment_method === 'STRIPE' ? 'กำลังเปิดหน้าชำระเงิน...' : 'กำลังบันทึกคำสั่งซื้อ...'; }
        try {
            var tracking = ecommerce(order);
            try {
                window.dataLayer = window.dataLayer || [];
                window.dataLayer.push({ ecommerce: null });
                window.dataLayer.push({ event:'begin_checkout',ecommerce:tracking });
                sessionStorage.setItem(PENDING_ORDER_KEY,JSON.stringify(tracking));
            } catch (_) {}
            var pixelParams={value:order.totalPrice,currency:'THB',content_name:order.product,content_category:'Raptor Sport Order',content_type:'product',num_items:order.quantity};
            try {
                if(typeof window.trackRaptorPixel==='function') {
                    window.trackRaptorPixel('InitiateCheckout',pixelParams);
                    window.trackRaptorPixel('RaptorFormSubmitStarted',pixelParams,true);
                } else RaptorOrders.track('InitiateCheckout',pixelParams);
            } catch (_) { /* Tracking must never prevent checkout. */ }
            var response = await fetch(order.payment_method === 'STRIPE' ? '/api/create-checkout-session' : '/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(order), signal: AbortSignal.timeout(45000) });
            var data = await response.json();
            if (!response.ok || (order.payment_method === 'STRIPE' ? !data.url : !data.ok)) throw new Error(data.error || 'ไม่สามารถบันทึกคำสั่งซื้อได้');
            window.location.href = data.url || '/thank-you.html?order_ref=' + encodeURIComponent(order.order_ref);
        } catch (error) {
            if (data?.code === 'CHECKOUT_EXPIRED') { delete form.dataset.orderSignature; }
            if (button) { button.disabled = false; button.innerHTML = originalText; if (window.RaptorPromotions) RaptorPromotions.update(form); }
            alert(error.name === 'TimeoutError' ? 'ใช้เวลานานกว่าปกติ กรุณากดอีกครั้งเพื่อตรวจสอบออเดอร์เดิม' : error.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
        } finally { form.dataset.submitting = '0'; }
    }, true);
}());
