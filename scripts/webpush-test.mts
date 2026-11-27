// Checks the push encryption against the worked example in RFC 8291 Appendix A, byte for byte.
// Run: node scripts/webpush-test.mts (Node 22.6+ runs TypeScript directly).
import { encryptPayload, unb64u, b64u } from '../supabase/functions/_shared/webpush.ts';
const asPublic = unb64u('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
const jwk = { kty: 'EC', crv: 'P-256', d: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', x: b64u(asPublic.slice(1, 33)), y: b64u(asPublic.slice(33, 65)), ext: true };
const out = await encryptPayload(
  { endpoint: 'https://push.example.net/push/JzLQ3raZJfFBR0aqvOMsLrt54w4rJUsV', p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
  new TextEncoder().encode('When I grow up, I want to be a watermelon'),
  { salt: unb64u('DGv6ra1nlYgDCS1FRnbzlw'), privateJwk: jwk, publicRaw: asPublic });
const want = 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';
if (b64u(out) !== want) { console.error('FAIL push encryption does not match RFC 8291 Appendix A\n got  ' + b64u(out) + '\n want ' + want); process.exit(1); }
console.log('push encryption matches RFC 8291 Appendix A');

// The VAPID header: an ES256 token for the push service's origin that verifies with the public key.
import { makeVapidKeys, vapidHeader } from '../supabase/functions/_shared/webpush.ts';
const k = await makeVapidKeys();
const h = await vapidHeader('https://fcm.googleapis.com/fcm/send/abc', { publicKey: k.publicKey, privateJwk: k.privateJwk, subject: 'https://example.org/' });
const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h);
if (!m || m[4] !== k.publicKey) { console.error('FAIL vapid header shape: ' + h.slice(0, 60)); process.exit(1); }
const claims = JSON.parse(new TextDecoder().decode(unb64u(m[2])));
const pub = await crypto.subtle.importKey('raw', unb64u(k.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64u(m[3]), new TextEncoder().encode(m[1] + '.' + m[2]));
if (!ok || claims.aud !== 'https://fcm.googleapis.com' || !(claims.exp > Date.now() / 1000)) { console.error('FAIL vapid signature or claims', ok, claims); process.exit(1); }
console.log('vapid header verifies');
