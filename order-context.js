(function () {
    'use strict';
    var inFlight = new Set();
    function read(key) { try { return sessionStorage.getItem(key); } catch (_) { return null; } }
    function write(key, value) { try { sessionStorage.setItem(key, value); } catch (_) {} }
    function saved(key) { try { return JSON.parse(read(key) || '{}'); } catch (_) { return {}; } }
    window.RaptorOrders = {
        cleanPhone: function (phone) { return String(phone || '').replace(/[^0-9]/g, ''); },
        createRef: function (phone) {
            return 'RPT-' + Date.now().toString().slice(-5) + '-' + phone.slice(-4) + '-' + crypto.randomUUID();
        },
        save: function (order) {
            var json = JSON.stringify(order);
            write('raptor_last_order', json);
            write('raptor_order_' + order.order_ref, json);
        },
        confirm: async function (channel) {
            var query = new URLSearchParams(location.search);
            var ref = query.get('order_ref');
            var order = ref ? saved('raptor_order_' + ref) : saved('raptor_last_order');
            if (ref && !order.order_ref) {
                var last = saved('raptor_last_order');
                if (last.order_ref === ref) order = last;
            }
            ref = ref || order.order_ref;
            var label = document.getElementById('order-reference');
            if (label && ref) label.textContent = 'รหัสคำสั่งซื้อ: ' + ref;
            var sessionId = query.get('session_id');
            if (query.get('payment') !== 'stripe_success' || !sessionId) return;
            var guard = 'paid_notified_' + sessionId;
            if (read(guard) || inFlight.has(sessionId)) return;
            inFlight.add(sessionId);
            try {
                var response = await fetch('/api/confirm-payment?session_id=' + encodeURIComponent(sessionId));
                var receipt = await response.json();
                if (!response.ok || receipt.payment_status !== 'paid' || receipt.order_channel !== channel) return;
                // Stripe is authoritative; URL values only identify the local saved context.
                ref = receipt.order_ref;
                order = saved('raptor_order_' + ref);
                if (!order.order_ref) {
                    var latest = saved('raptor_last_order');
                    if (latest.order_ref === ref) order = latest;
                }
                if (label) label.textContent = 'รหัสคำสั่งซื้อ: ' + ref;
                var payload = {
                    _subject: '✅ ชำระเงินสำเร็จ (PAID) [' + ref + '] - ' + receipt.customer_name + ' (' + receipt.phone + ') ยอด ฿' + receipt.total_price,
                    payment_status: '✅ PAID_SUCCESS (ชำระเงินผ่าน Stripe สำเร็จแล้ว)',
                    order_ref: ref, stripe_session_id: sessionId,
                    customer_name: receipt.customer_name, phone: receipt.phone,
                    address: receipt.address || order.address || '', product: receipt.product,
                    total_price: receipt.total_price
                };
                var notification = await fetch('https://formspree.io/f/' + (channel === 'wholesale' ? 'xzdwqaar' : 'mvzyqnag'), {
                    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload), keepalive: true
                });
                if (!notification.ok) throw new Error('Payment notification failed');
                write(guard, '1');
            } catch (error) {
                console.error('Unable to send payment confirmation; reload to retry.', error);
            } finally { inFlight.delete(sessionId); }
        }
    };
}());
