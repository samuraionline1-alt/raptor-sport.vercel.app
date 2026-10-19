// Only public script/config resources are proxied; collection beacons go directly to their vendors.
export function allowedScript(value) {
    if (typeof value !== 'string' || value.length > 8192) return null;
    let url;
    try { url = new URL(value); } catch { return null; }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
    if (url.hostname === 'www.googletagmanager.com') {
        if (url.pathname === '/gtm.js' && url.searchParams.get('id') === 'GTM-TW2P4VN5') return url;
        if (url.pathname === '/gtag/js' && /^(G|GT|AW|DC)-[A-Z0-9-]+$/.test(url.searchParams.get('id') || '')) return url;
    }
    if (url.hostname === 'connect.facebook.net') {
        if (url.pathname === '/en_US/fbevents.js' || url.pathname === '/signals/config/462184846324554') return url;
    }
    return null;
}
export function createHandler(fetchScript = fetch) {
    return async function handler(req, res) {
        res.setHeader('Cache-Control', 'no-store');
        if (req.method !== 'GET') {
            res.setHeader('Allow', 'GET');
            return res.status(405).json({ error: 'Method not allowed' });
        }
        const values = new URL(req.url, 'https://local.invalid').searchParams.getAll('url');
        const url = values.length === 1 && allowedScript(values[0]);
        if (!url) return res.status(400).json({ error: 'Unsupported script' });
        try {
            const upstream = await fetchScript(url.href, {
                redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(8000),
                headers: { Accept: 'application/javascript, text/javascript, */*;q=0.1' }
            });
            // Never follow a vendor redirect to an unvalidated host or forward vendor cookies.
            if (!upstream.ok) return res.status(502).json({ error: 'Script unavailable' });
            const type = upstream.headers.get('content-type') || '';
            if (!/(?:javascript|ecmascript|text\/plain)/i.test(type)) return res.status(502).json({ error: 'Unexpected script response' });
            const declaredSize = Number(upstream.headers.get('content-length'));
            if (declaredSize > 1048576) return res.status(502).json({ error: 'Script too large' });
            const chunks = [];
            let size = 0;
            for await (const chunk of upstream.body) {
                size += chunk.byteLength;
                if (size > 1048576) throw new Error('Script too large');
                chunks.push(Buffer.from(chunk));
            }
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            // Short freshness keeps published vendor tag/config changes current.
            res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=60');
            return res.status(200).send(Buffer.concat(chunks));
        } catch {
            return res.status(502).json({ error: 'Script unavailable' });
        }
    };
}
export default createHandler();
