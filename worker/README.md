# Weigh-in reminder (Cloudflare Worker)

One weekly push: *"Weigh-in day."* That's it.

The scale is the only honest signal of whether the eating is working — it
integrates every meal logged and every one forgotten. The failure it exists to
prevent already happened once: **101 days without a weigh-in**, during which a
"bulk" quietly cost 1.0 kg of lean mass with nothing in the app able to say so.

Deliberately not a food-logging nudge. A daily reminder you learn to swipe away
is just a recurring failure notice, which is the pattern this whole app is built
to avoid.

## Why a Worker exists at all

The app is otherwise a single static file with no backend. Web Push can't be:
the browser needs a *server* to send to the push service, and static Pages can't.
This is the smallest thing that closes that gap — a cron trigger, a KV namespace
holding one subscription, and a VAPID-signed POST.

If the Worker is never deployed, **the app is completely unaffected**. Push
support is feature-detected and silently absent.

## Setup

```sh
npm i -g wrangler && wrangler login

# 1. VAPID keypair (once)
npx web-push generate-vapid-keys

# 2. KV namespace for the subscription
wrangler kv namespace create SUBS
#    put the returned id into wrangler.toml

# 3. Secrets
wrangler secret put VAPID_PRIVATE_KEY
wrangler secret put VAPID_PUBLIC_KEY
wrangler secret put VAPID_SUBJECT      # mailto:you@example.com

# 4. Ship
wrangler deploy
```

Then set `PUSH_ENDPOINT` and `VAPID_PUBLIC` in `index.html` to the deployed
Worker URL and the public key, and enable notifications from the Body tab.

## iOS

Web Push works on iOS 16.4+ **only when the app is installed to the Home
Screen** — Share → Add to Home Screen. In a plain Safari tab the permission
prompt won't even appear. Android/Chrome has no such restriction.
