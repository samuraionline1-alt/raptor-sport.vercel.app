(function () {
    'use strict';
    var inFlight = false;
    function read(key) { try { return sessionStorage.getItem(key); } catch (_) { return null; } }
    function write(key, value) { try { sessionStorage.setItem(key, value); } catch (_) {} }
    function saved(ref) { try { return JSON.parse(read('raptor_order_' + ref) || '{}'); } catch (_) { return {}; } }
    function status(message, retry) {
        var label = document.getElementById('order-status');
        if (!label) {
            var reference = document.getElementById('order-reference');
            if (!reference) return;
            label = document.createElement('p'); label.id = 'order-status'; label.setAttribute('role','status');
            reference.after(label);
        }
        label.textContent = message;
        var button = document.getElementById('retry-confirmation');
        if (!button && retry) {
            button = document.createElement('button'); button.id = 'retry-confirmation'; button.type = 'button';
            button.textContent = 'ตรวจสอบสถานะอีกครั้ง'; label.after(button);
            button.addEventListener('click', function () { window.RaptorOrders.confirm(document.body.dataset.orderChannel || 'retail'); });
        }
        if (button) button.hidden = !retry;
    }
    window.RaptorOrders = {
        cleanPhone: function (phone) { return String(phone || '').replace(/[^0-9]/g, ''); },
        createToken: function () { return Array.from(crypto.getRandomValues(new Uint8Array(32)), function (n) { return n.toString(16).padStart(2,'0'); }).join(''); },
        createRef: function () {
            var parts = new Intl.DateTimeFormat('en', { timeZone:'Asia/Bangkok', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date());
            var date = ['year','month','day'].map(function (key) { return parts.find(function (part) { return part.type === key; }).value; }).join('');
            var alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
            var suffix = Array.from(crypto.getRandomValues(new Uint8Array(8)), function (value) { return alphabet[value & 31]; }).join('');
            return 'RPT-' + date + '-' + suffix;
        },
        save: function (order) {
            // Keep only receipt proof in this tab, never addresses, phone numbers or tax IDs.
            write('raptor_order_' + order.order_ref, JSON.stringify({order_ref:order.order_ref,receipt_token:order.receipt_token}));
            write('raptor_latest_ref',order.order_ref);
        },
        reviewProof: function () { return saved(read('raptor_latest_ref')); },
        track: function (event, data) {
            try { if (typeof window.fbq === 'function') window.fbq('track',event,data); } catch (_) { /* Analytics never blocks checkout. */ }
        },
        confirm: async function (channel) {
            if (inFlight) return;
            document.body.dataset.orderChannel = channel;
            var query = new URLSearchParams(location.search);
            var ref = query.get('order_ref'), sessionId = query.get('session_id');
            var context = saved(ref);
            var label = document.getElementById('order-reference');
            if (label && ref) label.textContent = 'รหัสคำสั่งซื้อ: ' + ref;
            // Remove old receipt URLs' PII before any subsequent navigation or sharing.
            ['customer_name','phone','value','product','qty','paid'].forEach(function (key) { query.delete(key); });
            if (window.history?.replaceState) window.history.replaceState(null,'',location.pathname + (query.size ? '?' + query.toString() : ''));
            if (!ref || !context.receipt_token) { status('ไม่สามารถยืนยันสิทธิ์ดูออเดอร์ กรุณาเปิดจากเครื่องที่สั่งซื้อหรือติดต่อร้านค้า',false); return; }
            inFlight = true;
            status('กำลังตรวจสอบคำสั่งซื้อและสถานะชำระเงิน…',false);
            try {
                var response = await fetch('/api/confirm-payment?order_ref=' + encodeURIComponent(ref) + (sessionId ? '&session_id=' + encodeURIComponent(sessionId) : ''), {
                    headers:{'X-Order-Token':context.receipt_token}, signal:AbortSignal.timeout(45000)
                });
                var receipt = await response.json();
                if (!response.ok) throw new Error(receipt.error || 'ยังตรวจสอบสถานะไม่ได้ กรุณาลองอีกครั้ง');
                if (receipt.order_channel !== channel || !['paid','cod'].includes(receipt.payment_status)) throw new Error('สถานะคำสั่งซื้อยังไม่พร้อม กรุณาลองอีกครั้ง');
                status(receipt.payment_status === 'paid' ? 'ยืนยันชำระเงินสำเร็จแล้ว' : 'รับคำสั่งซื้อเก็บเงินปลายทางแล้ว',false);
                document.dispatchEvent(new CustomEvent('raptor:order-confirmed',{detail:receipt}));
                return receipt;
            } catch (error) { status(error.name === 'TimeoutError' ? 'ใช้เวลาตรวจสอบนานกว่าปกติ กรุณาลองอีกครั้ง' : error.message,true); }
            finally { inFlight = false; }
        }
    };
}());
