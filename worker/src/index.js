// Weigh-in reminder. One push a week, no dependencies.
//
// Web Push (RFC 8030 + VAPID, RFC 8292) is implemented directly against
// WebCrypto rather than pulling in the `web-push` library, because Workers has
// no Node crypto and the signing is ~40 lines. Payloads are omitted entirely:
// an empty push still wakes the service worker, and the SW composes the text
// locally. That skips ECDH/AES-GCM payload encryption completely and means the
// push service never sees anything about the user.

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "=".repeat((4 - pad.length % 4) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
};

// VAPID: an ES256 JWT proving we own the public key the client subscribed with.
async function vapidHeaders(endpoint, env) {
  const aud = new URL(endpoint).origin;
  const header = b64url(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64url(new TextEncoder().encode(JSON.stringify({
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || "mailto:nobody@example.com",
  })));
  const unsigned = `${header}.${body}`;

  // The private key is a raw 32-byte P-256 scalar; import it as JWK alongside
  // the public key's coordinates.
  const pub = fromB64url(env.VAPID_PUBLIC_KEY);      // 65 bytes, 0x04 || X || Y
  const key = await crypto.subtle.importKey("jwk", {
    kty: "EC", crv: "P-256",
    x: b64url(pub.slice(1, 33)),
    y: b64url(pub.slice(33, 65)),
    d: env.VAPID_PRIVATE_KEY.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    ext: true,
  }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);

  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key,
    new TextEncoder().encode(unsigned));
  return {
    Authorization: `vapid t=${unsigned}.${b64url(sig)}, k=${env.VAPID_PUBLIC_KEY}`,
    TTL: "86400",
    "Content-Length": "0",
    Urgency: "normal",
  };
}

async function sendPush(sub, env) {
  const res = await fetch(sub.endpoint, { method: "POST", headers: await vapidHeaders(sub.endpoint, env) });
  // 404/410 mean the subscription is dead — drop it so we stop retrying forever.
  if (res.status === 404 || res.status === 410) {
    await env.SUBS.delete(sub.key);
    return { status: res.status, dropped: true };
  }
  return { status: res.status, dropped: false };
}

export default {
  // Subscribe / unsubscribe / health. CORS-open because the only thing it
  // accepts is a push subscription, which is useless to anyone else.
  async fetch(req, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, DELETE, GET, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
    };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    const url = new URL(req.url);

    if (url.pathname === "/key") {
      return new Response(env.VAPID_PUBLIC_KEY || "", { headers: { ...cors, "content-type": "text/plain" } });
    }
    if (url.pathname === "/subscribe" && req.method === "POST") {
      const sub = await req.json();
      if (!sub?.endpoint) return new Response("bad subscription", { status: 400, headers: cors });
      await env.SUBS.put("sub:" + await hash(sub.endpoint), JSON.stringify({ endpoint: sub.endpoint }));
      return new Response("ok", { headers: cors });
    }
    if (url.pathname === "/unsubscribe" && req.method === "POST") {
      const sub = await req.json();
      if (sub?.endpoint) await env.SUBS.delete("sub:" + await hash(sub.endpoint));
      return new Response("ok", { headers: cors });
    }
    return new Response("gym-tracker-push", { headers: cors });
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      const list = await env.SUBS.list({ prefix: "sub:" });
      for (const k of list.keys) {
        const raw = await env.SUBS.get(k.name);
        if (!raw) continue;
        const sub = { ...JSON.parse(raw), key: k.name };
        try { console.log(k.name, JSON.stringify(await sendPush(sub, env))); }
        catch (e) { console.error("push failed", k.name, e.message); }
      }
    })());
  },
};

async function hash(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return b64url(d).slice(0, 22);
}
