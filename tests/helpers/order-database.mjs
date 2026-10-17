import assert from 'node:assert/strict';
process.env.SUPABASE_URL = 'https://orders.example.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_mock';
export const events = new Map();
export const requests = [];
export async function withOrderDatabase(run) {
  const downstream = global.fetch;
  global.fetch = async (url, options = {}) => {
    if (!url.startsWith(process.env.SUPABASE_URL)) return downstream(url, options);
    assert.equal(options.headers.apikey, 'sb_secret_mock');
    assert.equal(options.headers.Authorization, undefined);
    requests.push({ url, ...options });
    const body = options.body ? JSON.parse(options.body) : null;
    if (url.endsWith('/rpc/raptor_record_order')) {
      const order = body.p_order;
      const key = order.order_ref + ':' + order.event_type;
      if (!events.has(key)) events.set(key, { order_ref: order.order_ref, event_type: order.event_type, status: 'pending', attempts: 0, payload: order });
      return { ok: true, status: 200, json: async () => null };
    }
    const query = new URL(url).searchParams;
    const key = query.get('order_ref')?.slice(3) + ':' + query.get('event_type')?.slice(3);
    const row = events.get(key);
    assert.ok(row, 'Notification must only be sent after its order is recorded');
    if (!options.method || options.method === 'GET') return { ok: true, status: 200, json: async () => [structuredClone(row)] };
    const claim = options.headers.Prefer === 'return=representation';
    if (claim && row.status === 'sent') return { ok: true, status: 200, json: async () => [] };
    Object.assign(row, body);
    return { ok: true, status: claim ? 200 : 204, json: async () => [structuredClone(row)] };
  };
  try { return await run(); } finally { global.fetch = downstream; }
}
