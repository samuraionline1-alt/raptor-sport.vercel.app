import catalog from '../product-catalog.js';
import promo from '../promo-config.js';
export class OrderError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
function fail(message) { throw new OrderError(message); }
function quantity(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > 100000) fail('จำนวนสินค้าไม่ถูกต้อง');
  return n;
}
export function priceOrder(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('ข้อมูลคำสั่งซื้อไม่ถูกต้อง');
  const wholesale = body.is_wholesale === true;
  let items, subtotalCents, shippingCents = 0, vatCents = 0, promotion = {};
  if (wholesale) {
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > catalog.wholesale.length) fail('กรุณาเลือกรายการสินค้าใหม่');
    const seen = new Set();
    const lines = body.items.map(line => {
      const product = catalog.wholesale.find(p => p.id === line?.id);
      if (!product || seen.has(product.id)) fail('รายการสินค้าไม่ถูกต้อง');
      seen.add(product.id);
      return { product, qty: quantity(line.qty) };
    }).sort((a,b) => a.product.id.localeCompare(b.product.id));
    const count = lines.reduce((sum,l) => sum + l.qty, 0);
    if (count < 50 || count > 100000) fail('ราคาส่งต้องสั่งรวม 50–100,000 ชิ้น');
    items = lines.map(({product,qty}) => {
      const price = product.tiers.reduce((p,t) => count >= t.min ? t.price : p, product.defaultPrice);
      return { sku: product.id, name: product.name, quantity: qty, unit_price_cents: price * 100, line_total_cents: price * 100 * qty };
    });
    subtotalCents = items.reduce((sum,l) => sum + l.line_total_cents, 0);
    shippingCents = (count <= 100 ? 150 : count <= 200 ? 350 : count <= 300 ? 500 : count <= 400 ? 850 : count <= 500 ? 1000 : 1500) * 100;
    vatCents = Math.round((subtotalCents + shippingCents) * 7 / 100);
    if (body.coupon_code) fail('คูปองนี้ใช้สำหรับการสั่งซื้อปลีก');
  } else {
    // Exact legacy product-name lookup keeps cached storefronts working without trusting their price.
    const product = body.sku ? catalog.retail.find(p => p.sku === body.sku) : catalog.retail.find(p => p.name === body.product);
    if (!product) fail('ไม่พบสินค้า กรุณาโหลดหน้าสินค้าใหม่');
    const count = quantity(body.quantity);
    const tier = body.bundleTier || body.bundle_tier_choice || 'custom';
    if (!['tier_1','tier_2','tier_3','tier_6','custom'].includes(tier)) fail('เซ็ตสินค้าไม่ถูกต้อง');
    if (tier !== 'custom' && Number(tier.slice(5)) !== count) fail('จำนวนไม่ตรงกับเซ็ตสินค้า');
    const percent = { tier_2: 92, tier_3: 85, tier_6: 80 }[tier] || 100;
    // Match the storefront's published whole-baht bundle rounding.
    subtotalCents = Math.round(product.price * count * percent / 100) * 100;
    promotion = promo.calculate(subtotalCents / 100, tier === 'custom' ? `tier_${count}` : tier, body.coupon_code);
    if (promotion.couponError) fail(promotion.couponError);
    items = [{ sku: product.sku, name: product.name, quantity: count, unit_price_cents: product.price * 100, line_total_cents: subtotalCents }];
  }
  const discountCents = (promotion.discount_amount || 0) * 100;
  const totalCents = subtotalCents + shippingCents + vatCents - discountCents;
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0 || totalCents > 1000000000) fail('ยอดสั่งซื้อเกินวงเงิน กรุณาติดต่อร้านค้า');
  // Reject stale/tampered displayed totals instead of silently charging a different amount.
  const supplied = body.total_price ?? body.totalPrice;
  if (supplied == null || !Number.isFinite(Number(supplied)) || Math.abs(Number(supplied) * 100 - totalCents) > 0.001) fail('ราคามีการเปลี่ยนแปลง กรุณาโหลดหน้าสินค้าใหม่');
  if (body.subtotal != null && (!Number.isFinite(Number(body.subtotal)) || Math.abs(Number(body.subtotal) * 100 - subtotalCents) > 0.001)) fail('ยอดสินค้าก่อนส่วนลดไม่ถูกต้อง');
  return { items, quantity: items.reduce((sum,l) => sum + l.quantity,0), product: items.map(l => `${l.name} × ${l.quantity}`).join(', '),
    subtotal: subtotalCents / 100, shipping_cost: shippingCents / 100, vat_amount: vatCents / 100,
    total_cents: totalCents, total_price: totalCents / 100, discount_amount: discountCents / 100,
    coupon_code: promotion.coupon_code || '', free_gifts: promotion.free_gifts || '', order_channel: wholesale ? 'wholesale' : 'retail' };
}
