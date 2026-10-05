/** Edit promotions here. Coupon minimums use the bundle subtotal, before coupons. */
(function (root) {
    const config = {
        announcementBar: '🔥 โปรพิเศษสั่งตรงหน้าเว็บ! สั่งเซ็ต 2 ชิ้นขึ้นไป แถมฟรีซองทดลอง RAPTOR GO Energy Gel + ส่งด่วนฟรีทุกออเดอร์',
        // Always active; the page owns the Flash Sale countdown.
        bundleGifts: {
            tier_1: { giftCount: 0, giftText: '' },
            tier_2: { giftCount: 1, giftText: '🎁 แถมฟรี! RAPTOR GO Energy Gel 1 ซอง (มูลค่า ฿79)' },
            tier_3: { giftCount: 2, giftText: '🎁 แถมฟรี! RAPTOR GO Energy Gel 2 ซอง (มูลค่า ฿158)' },
            tier_6: { giftCount: 3, giftText: '🎁 แถมฟรี! RAPTOR GO Energy Gel 3 ซอง (มูลค่า ฿237)' }
        },
        coupons: {
            RAPTOR20: { type: 'fixed', discount: 20, label: 'ส่วนลดพิเศษหน้าเว็บ ฿20', minOrder: 250 },
            RAPTOR50: { type: 'fixed', discount: 50, label: 'ส่วนลดพิเศษหน้าเว็บ ฿50', minOrder: 450 },
            FREEGEL: { type: 'gift', discount: 0, giftCount: 1, extraGift: 'แถมเพิ่ม RAPTOR GO Energy Gel 1 ซอง', label: 'รับฟรี Energy Gel เพิ่ม 1 ซอง', minOrder: 140 }
        }
    };
    // Shared by the browser and the checkout API.
    config.calculate = function (subtotal, tier, code) {
        code = String(code || '').trim().toUpperCase();
        const key = Object.keys(config.coupons).find(key => key.toUpperCase() === code);
        const coupon = key ? config.coupons[key] : null;
        const valid = Boolean(coupon && subtotal >= coupon.minOrder);
        const discount = valid && coupon.type === 'fixed' ? Math.min(subtotal, coupon.discount) : 0;
        const gifts = [config.bundleGifts[tier]?.giftText, valid ? coupon.extraGift : ''].filter(Boolean).join(' | ');
        const giftCount = (config.bundleGifts[tier]?.giftCount || 0) + (valid ? coupon.giftCount || 0 : 0);
        return { giftCount, giftValue: giftCount * 79, subtotal, totalPrice: subtotal - discount, coupon_code: valid ? code : '', discount_amount: discount, free_gifts: gifts,
            couponLabel: valid ? coupon.label : '', couponError: code && !valid ? (coupon ? 'โค้ดนี้ใช้ได้เมื่อยอดสินค้าอย่างน้อย ฿' + coupon.minOrder : 'ไม่พบโค้ดส่วนลดนี้') : '' };
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = config;
    else root.RaptorPromoConfig = config;
}(typeof window !== 'undefined' ? window : globalThis));
