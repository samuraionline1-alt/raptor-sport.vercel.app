(function () {
    'use strict';
    const config = window.RaptorPromoConfig;
    function field(form, name, value) {
        let input = form.querySelector('[name="' + name + '"]');
        if (!input) { input = document.createElement('input'); input.type = 'hidden'; input.name = name; form.appendChild(input); }
        input.value = value;
    }
    function pricing(form) {
        const unitPrice = Number(String(form.dataset.price || '0').replace(/[^\d.]/g, ''));
        const tier = form.querySelector('[name="bundle_tier_choice"]:checked')?.value || 'custom';
        const quantity = tier.match(/^tier_(\d+)$/) ? Number(tier.slice(5)) : Math.max(1, parseInt(form.querySelector('[name="quantity"]')?.value, 10) || 1);
        const rate = { tier_2: 0.92, tier_3: 0.85, tier_6: 0.8 }[tier] || 1;
        const subtotal = Math.round(unitPrice * quantity * rate);
        const giftTier = tier === 'custom' ? 'tier_' + quantity : tier;
        return Object.assign({ unitPrice, quantity, bundleTier: tier }, config.calculate(subtotal, giftTier, form.dataset.appliedCoupon));
    }
    function update(form) {
        const order = pricing(form);
        field(form, 'quantity', order.quantity);
        ['coupon_code', 'discount_amount', 'free_gifts'].forEach(key => field(form, key, order[key]));
        field(form, 'total_price', order.totalPrice);
        field(form, 'price', '฿' + order.totalPrice);
        Object.entries({ tier_1: 1, tier_2: 2 * 0.92, tier_3: 3 * 0.85, tier_6: 6 * 0.8 }).forEach(([tier, multiplier]) => {
            const price = form.querySelector('[data-bundle-price="' + tier + '"]');
            if (price) price.textContent = '฿' + Math.round(order.unitPrice * multiplier).toLocaleString('th-TH');
        });
        let summary = form.querySelector('[data-order-price-summary]');
        const submit = form.querySelector('button[type="submit"]');
        if (!summary) { summary = document.createElement('div'); summary.dataset.orderPriceSummary = ''; summary.className = 'rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm font-bold text-orange-800'; submit.before(summary); }
        summary.replaceChildren();
        summary.style.fontWeight = '400';
        function row(label, value, valueStyle = '') {
            const line = document.createElement('div');
            line.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:12px;margin:6px 0';
            const left = document.createElement('span'); left.textContent = label;
            const right = document.createElement('span'); right.textContent = value;
            right.style.cssText = 'text-align:right;flex-shrink:0;' + valueStyle;
            line.append(left, right); summary.appendChild(line);
            return line;
        }
        row('ราคาสินค้า (' + order.quantity + ' ชิ้น)', '฿' + order.subtotal);
        if (order.discount_amount) row('ส่วนลดคูปอง (' + order.coupon_code + ')', '-฿' + order.discount_amount, 'font-weight:700;color:#16a34a');
        row('ค่าจัดส่ง', 'ส่งด่วนฟรี (฿0)', 'font-weight:700;color:#16a34a');
        if (order.giftCount) {
            const gift = document.createElement('div');
            gift.style.cssText = 'background:#f0fdf4;border:1px dashed #86efac;color:#15803d;padding:6px 10px;border-radius:6px';
            gift.textContent = '🎁 ของแถมฟรี: RAPTOR GO Energy Gel ' + order.giftCount + ' ซอง (มูลค่า ฿' + order.giftValue + ')';
            summary.appendChild(gift);
        }
        const divider = document.createElement('div');
        divider.style.cssText = 'border-top:1px solid #fed7aa;margin:8px 0'; summary.appendChild(divider);
        row('ยอดชำระสุทธิ', '฿' + order.totalPrice, 'font-size:1.35rem;font-weight:700;color:#ea580c').firstChild.style.fontWeight = '700';
        if (submit && !submit.disabled) submit.textContent = (form.querySelector('[name="payment_method"]:checked')?.value === 'STRIPE' ? 'ชำระเงินออนไลน์' : 'ยืนยันสั่งซื้อเก็บเงินปลายทาง') + ' ฿' + order.totalPrice + (order.free_gifts ? ' • ' + order.free_gifts : '');
        const message = form.querySelector('[data-coupon-status]');
        if (message) message.textContent = order.couponError || order.couponLabel;
        const quick = form.querySelector('[data-quick-coupon]');
        if (quick) quick.hidden = order.subtotal < 250;
        return order;
    }
    window.RaptorPromotions = { pricing, update };
    document.addEventListener('DOMContentLoaded', function () {
        const bar = document.createElement('div');
        bar.className = 'bg-orange-600 px-4 py-3 text-center text-sm font-bold text-white';
        bar.textContent = config.announcementBar;
        document.body.prepend(bar);
        document.querySelectorAll('.raptor-order-form').forEach(function (form) {
            Object.entries(config.bundleGifts).forEach(([tier, gift]) => {
                const card = form.querySelector('[name="bundle_tier_choice"][value="' + tier + '"]')?.closest('label');
                if (!card) return;
                const badge = card.querySelector('small');
                const subtitles = { tier_1: 'ส่งฟรีเก็บเงินปลายทาง', tier_2: 'ประหยัดเพิ่ม + ส่งฟรี', tier_3: 'คุ้มที่สุด + ส่งฟรี', tier_6: 'ลด 20% + ส่งฟรี' };
                if (badge) badge.textContent = subtitles[tier];
                if (gift.giftText) { const note = document.createElement('div'); note.className = 'mt-2 text-sm font-bold text-emerald-700'; note.textContent = gift.giftText; note.dataset.bundleGift = tier; (badge?.parentElement || card).appendChild(note); }
            });
            update(form);
            const box = document.createElement('div'); box.className = 'space-y-2 rounded-xl border border-slate-200 p-3';
            box.innerHTML = '<div class="text-sm font-bold">โค้ดส่วนลด (ถ้ามี)</div><div style="display:flex;gap:8px;align-items:center"><input aria-label="โค้ดส่วนลด (ถ้ามี)" data-coupon-input type="text" autocomplete="off" placeholder="เช่น RAPTOR20" style="flex:1;min-width:0;width:0" class="rounded-lg border p-2"><button type="button" data-apply-coupon style="flex-shrink:0;white-space:nowrap" class="rounded-lg bg-orange-600 px-3 py-2 text-sm font-bold text-white">ใช้โค้ด</button> <button type="button" data-remove-coupon style="flex-shrink:0;white-space:nowrap" class="text-sm underline">ล้างโค้ด</button></div><button type="button" data-quick-coupon class="block rounded-full bg-orange-50 px-3 py-2 text-sm text-orange-800">🎁 กดใช้โค้ดลดเพิ่ม ฿20 สำหรับเซ็ตแพ็กคู่</button><p data-coupon-status role="status" aria-live="polite" class="text-sm text-emerald-700"></p>';
            form.querySelector('[data-order-price-summary]').before(box);
            const input = box.querySelector('[data-coupon-input]');
            function apply() { form.dataset.appliedCoupon = input.value.trim().toUpperCase(); update(form); }
            box.querySelector('[data-apply-coupon]').addEventListener('click', apply);
            box.querySelector('[data-remove-coupon]').addEventListener('click', () => { input.value = ''; form.dataset.appliedCoupon = ''; update(form); });
            box.querySelector('[data-quick-coupon]').addEventListener('click', () => { if (pricing(form).subtotal >= 250) { input.value = 'RAPTOR20'; apply(); } });
            input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); apply(); } });
            form.addEventListener('change', () => update(form));
            form.addEventListener('input', event => { if (event.target !== input) update(form); });
            form.addEventListener('reset', () => { form.dataset.appliedCoupon = ''; setTimeout(() => update(form), 0); });
            update(form);
        });
    });
}());
