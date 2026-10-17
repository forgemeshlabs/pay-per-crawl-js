// ForgeMesh Pay-per-Crawl for nginx (ngx_http_js_module / njs). A config snippet, not a package.
// Answers crawlers with the x402 v2 header, the x402 v1 JSON body and an MPP challenge; accepts
// x402 v1/v2 and MPP payments, verifies + settles through the facilitator, then proxies to the origin.
// The site owner keeps 100%: payments go straight to PAY_TO. Behaviour matches the core library.
// Needs njs >= 0.8.0 (shared dict add(), js_var, ngx.fetch). See README.md.
import crypto from 'crypto';

var VERSION = '0.1.0';
var USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
var NET_V2 = 'eip155:8453';
var NET_V1 = 'base';
var TIMEOUT = 300;
var MIN_PRICE = 0.005;
var ASSET_EXT = /\.(css|js|mjs|map|png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|ogg)$/i;
var ALWAYS_FREE = ['/robots.txt', '/llms.txt', '/agents.txt', '/.well-known/', '/favicon.ico', '/sitemap'];
var DEFAULT_POLICY = { search: 'free', social: 'free', monitor: 'free', seo: 'paid', ai: 'paid', automation: 'paid', bot: 'paid' };

// BEGIN CATALOG
var CATALOG = [
  ["Googlebot","search",["googlebot"],[".googlebot.com",".google.com"]],
  ["Google-InspectionTool","search",["google-inspectiontool"],[".googlebot.com",".google.com"]],
  ["GoogleOther","ai",["googleother"],[".googlebot.com",".google.com"]],
  ["Bingbot","search",["bingbot"],[".search.msn.com"]],
  ["DuckDuckBot","search",["duckduckbot"],[]],
  ["Applebot","search",["applebot"],[".applebot.apple.com"]],
  ["YandexBot","search",["yandexbot","yandex.com/bots"],[".yandex.ru",".yandex.net",".yandex.com"]],
  ["Baiduspider","search",["baiduspider"],[".baidu.com",".baidu.jp"]],
  ["Yahoo Slurp","search",["yahoo! slurp"],[".crawl.yahoo.net"]],
  ["SeznamBot","search",["seznambot"],[".seznam.cz"]],
  ["Qwantbot","search",["qwantbot","qwantify"],[]],
  ["GPTBot","ai",["gptbot"],[]],
  ["ChatGPT-User","ai",["chatgpt-user"],[]],
  ["OAI-SearchBot","ai",["oai-searchbot"],[]],
  ["ClaudeBot","ai",["claudebot","anthropic-ai"],[]],
  ["Claude-User","ai",["claude-user"],[]],
  ["Claude-SearchBot","ai",["claude-searchbot"],[]],
  ["PerplexityBot","ai",["perplexitybot"],[]],
  ["Perplexity-User","ai",["perplexity-user"],[]],
  ["Google-Extended","ai",["google-extended"],[]],
  ["Gemini-Deep-Research","ai",["gemini-deep-research"],[]],
  ["Amazonbot","ai",["amazonbot"],[]],
  ["Applebot-Extended","ai",["applebot-extended"],[]],
  ["Meta-ExternalAgent","ai",["meta-externalagent","meta-externalfetcher","facebookbot"],[]],
  ["Bytespider","ai",["bytespider","tiktokspider"],[]],
  ["CCBot","ai",["ccbot"],[]],
  ["cohere-ai","ai",["cohere-ai","cohere-training-data-crawler"],[]],
  ["MistralAI-User","ai",["mistralai-user"],[]],
  ["DuckAssistBot","ai",["duckassistbot"],[]],
  ["YouBot","ai",["youbot"],[]],
  ["Diffbot","ai",["diffbot"],[]],
  ["ImagesiftBot","ai",["imagesiftbot"],[]],
  ["Omgili","ai",["omgili","webzio"],[]],
  ["AI2Bot","ai",["ai2bot"],[]],
  ["PetalBot","ai",["petalbot"],[]],
  ["Timpibot","ai",["timpibot"],[]],
  ["iAskBot","ai",["iaskspider","iaskbot"],[]],
  ["Kagibot","ai",["kagibot"],[]],
  ["DeepSeekBot","ai",["deepseekbot"],[]],
  ["Grok","ai",["xai-grok","grokbot"],[]],
  ["Brave Search","ai",["bravebot"],[]],
  ["Firecrawl","ai",["firecrawl"],[]],
  ["Jina Reader","ai",["jina","readerbot"],[]],
  ["Exa","ai",["exabot","exa.ai"],[]],
  ["Tavily","ai",["tavily"],[]],
  ["Browserbase","ai",["browserbase"],[]],
  ["AhrefsBot","seo",["ahrefsbot"],[]],
  ["SemrushBot","seo",["semrushbot"],[]],
  ["MJ12bot","seo",["mj12bot"],[]],
  ["DotBot","seo",["dotbot"],[]],
  ["DataForSeoBot","seo",["dataforseobot"],[]],
  ["BLEXBot","seo",["blexbot"],[]],
  ["Screaming Frog","seo",["screaming frog"],[]],
  ["SiteAuditBot","seo",["siteauditbot"],[]],
  ["Facebook preview","social",["facebookexternalhit"],[]],
  ["Twitterbot","social",["twitterbot"],[]],
  ["LinkedInBot","social",["linkedinbot"],[]],
  ["Slackbot","social",["slackbot","slack-imgproxy"],[]],
  ["Discordbot","social",["discordbot"],[]],
  ["TelegramBot","social",["telegrambot"],[]],
  ["WhatsApp","social",["whatsapp"],[]],
  ["Pinterestbot","social",["pinterestbot","pinterest/"],[]],
  ["Redditbot","social",["redditbot"],[]],
  ["Mastodon","social",["mastodon"],[]],
  ["Bluesky","social",["bluesky cardyb"],[]],
  ["iMessage preview","social",["facebot twitterbot"],[]],
  ["UptimeRobot","monitor",["uptimerobot"],[]],
  ["Pingdom","monitor",["pingdom"],[]],
  ["StatusCake","monitor",["statuscake"],[]],
  ["Better Uptime","monitor",["betteruptime","better uptime"],[]],
  ["Feed reader","monitor",["feedly","feedbin","inoreader","newsblur","feedfetcher"],[]],
  ["Internet Archive","monitor",["archive.org_bot","ia_archiver"],[]],
  ["WordPress","monitor",["wordpress/"],[]],
  ["curl","automation",["curl/"],[]],
  ["wget","automation",["wget/"],[]],
  ["python-requests","automation",["python-requests","python-urllib","aiohttp","httpx/"],[]],
  ["Scrapy","automation",["scrapy"],[]],
  ["Go-http-client","automation",["go-http-client"],[]],
  ["Node fetch","automation",["node-fetch","undici","axios/","got ("],[]],
  ["Java HTTP","automation",["java/","okhttp","apache-httpclient"],[]],
  ["Headless browser","automation",["headlesschrome","phantomjs","puppeteer","playwright","selenium"],[]],
  ["HTTPie","automation",["httpie"],[]],
  ["PostmanRuntime","automation",["postmanruntime"],[]],
  ["libwww","automation",["libwww","lwp-trivial"],[]],
  ["x402 client","automation",["x402","mpp/"],[]],
];
// END CATALOG

// ── config ─────────────────────────────────────────────────────────────────

function parseJson(s, d) {
  if (!s) return d;
  try { var v = JSON.parse(s); return v && typeof v === 'object' ? v : d; } catch (e) { return d; }
}

function config(r) {
  var v = r.variables;
  var price = Number(v.ppc_price_usd || 0.01);
  if (!(price >= MIN_PRICE)) price = MIN_PRICE;
  var mode = v.ppc_mode === 'gate' ? 'gate' : 'monitor';
  var payTo = v.ppc_pay_to || '';
  if (mode === 'gate' && !/^0x[0-9a-fA-F]{40}$/.test(payTo)) mode = 'monitor';
  var policy = {};
  for (var k in DEFAULT_POLICY) policy[k] = DEFAULT_POLICY[k];
  var cp = parseJson(v.ppc_class_policy, {});
  for (var c in cp) if (['free', 'paid', 'block'].indexOf(cp[c]) >= 0) policy[c] = cp[c];
  var base = (v.ppc_base_url || (v.scheme + '://' + v.host)).replace(/\/+$/, '') + '/';
  var host = base.replace(/^https?:\/\//, '').replace(/[\x2f:].*$/, '');
  return {
    mode: mode, paid: mode === 'gate', payTo: payTo, price: price, units: String(Math.round(price * 1000000)),
    facilitator: (v.ppc_facilitator_url || 'https://facilitator.payai.network').replace(/\/+$/, ''),
    secret: v.ppc_mpp_secret || crypto.createHash('sha256').update('forgemesh-ppc|' + payTo.toLowerCase()).digest('hex'),
    siteName: v.ppc_site_name || host, policy: policy, overrides: parseJson(v.ppc_bot_overrides, {}),
    allow: (v.ppc_allow_paths || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean),
    gateAssets: v.ppc_gate_assets === 'on', trust: (v.ppc_trust_header || '').toLowerCase(),
    doh: v.ppc_doh_url || 'https://cloudflare-dns.com/dns-query', verifyRdns: v.ppc_verify_rdns !== 'off',
    base: base, host: host
  };
}

// ── helpers ────────────────────────────────────────────────────────────────

var b64 = function (s) { return Buffer.from(s).toString('base64'); };
var b64u = function (s) { return Buffer.from(s).toString('base64url'); };
function unb64(s) { try { return Buffer.from(s, 'base64').toString(); } catch (e) { return null; } }
function unb64u(s) { try { return Buffer.from(s, 'base64url').toString(); } catch (e) { return null; } }
function jsonOf(text) { try { var j = JSON.parse(text); return j && typeof j === 'object' ? j : null; } catch (e) { return null; } }

function jcs(v) {
  if (Array.isArray(v)) return '[' + v.map(jcs).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + jcs(v[k]); }).join(',') + '}';
  return JSON.stringify(v);
}

function priceString(p) { return Number(p).toFixed(6).replace(/0+$/, '').replace(/\.$/, ''); }

// ── keccak-256 (Ethereum variant), 32-bit halves, for the MPP nonce binding ──

var RC = [[1, 0], [0x8082, 0], [0x808a, 0x80000000], [0x80008000, 0x80000000], [0x808b, 0], [0x80000001, 0], [0x80008081, 0x80000000], [0x8009, 0x80000000],
  [0x8a, 0], [0x88, 0], [0x80008009, 0], [0x8000000a, 0], [0x8000808b, 0], [0x8b, 0x80000000], [0x8089, 0x80000000], [0x8003, 0x80000000],
  [0x8002, 0x80000000], [0x80, 0x80000000], [0x800a, 0], [0x8000000a, 0x80000000], [0x80008081, 0x80000000], [0x8080, 0x80000000], [0x80000001, 0], [0x80008008, 0x80000000]];
var ROTC = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44];
var PILN = [10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1];

function rotl(l, h, n) {
  if (n === 32) return [h, l];
  if (n < 32) return [((l << n) | (h >>> (32 - n))) >>> 0, ((h << n) | (l >>> (32 - n))) >>> 0];
  n -= 32;
  return [((h << n) | (l >>> (32 - n))) >>> 0, ((l << n) | (h >>> (32 - n))) >>> 0];
}

function keccakF(lo, hi) {
  var i, j, x, y, bl = [0, 0, 0, 0, 0], bh = [0, 0, 0, 0, 0];
  for (var round = 0; round < 24; round++) {
    for (i = 0; i < 5; i++) {
      bl[i] = lo[i] ^ lo[i + 5] ^ lo[i + 10] ^ lo[i + 15] ^ lo[i + 20];
      bh[i] = hi[i] ^ hi[i + 5] ^ hi[i + 10] ^ hi[i + 15] ^ hi[i + 20];
    }
    for (x = 0; x < 5; x++) {
      var r1 = rotl(bl[(x + 1) % 5], bh[(x + 1) % 5], 1);
      var dl = bl[(x + 4) % 5] ^ r1[0], dh = bh[(x + 4) % 5] ^ r1[1];
      for (y = 0; y < 25; y += 5) { lo[y + x] = (lo[y + x] ^ dl) >>> 0; hi[y + x] = (hi[y + x] ^ dh) >>> 0; }
    }
    var tl = lo[1], th = hi[1];
    for (i = 0; i < 24; i++) {
      j = PILN[i];
      var ol = lo[j], oh = hi[j];
      var rr = rotl(tl, th, ROTC[i]);
      lo[j] = rr[0]; hi[j] = rr[1];
      tl = ol; th = oh;
    }
    for (j = 0; j < 25; j += 5) {
      for (i = 0; i < 5; i++) { bl[i] = lo[j + i]; bh[i] = hi[j + i]; }
      for (i = 0; i < 5; i++) {
        lo[j + i] = (lo[j + i] ^ (~bl[(i + 1) % 5] & bl[(i + 2) % 5])) >>> 0;
        hi[j + i] = (hi[j + i] ^ (~bh[(i + 1) % 5] & bh[(i + 2) % 5])) >>> 0;
      }
    }
    lo[0] = (lo[0] ^ RC[round][0]) >>> 0; hi[0] = (hi[0] ^ RC[round][1]) >>> 0;
  }
}

function keccak256Hex(str) {
  var bytes = Buffer.from(str);
  var rate = 136, n = bytes.length;
  var padded = Buffer.alloc(Math.floor(n / rate) * rate + rate);
  bytes.copy(padded, 0);
  padded[n] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  var lo = [], hi = [], i, b;
  for (i = 0; i < 25; i++) { lo.push(0); hi.push(0); }
  for (b = 0; b < padded.length; b += rate) {
    for (i = 0; i < rate / 8; i++) {
      var o = b + i * 8;
      lo[i] = (lo[i] ^ (padded[o] | (padded[o + 1] << 8) | (padded[o + 2] << 16) | (padded[o + 3] << 24))) >>> 0;
      hi[i] = (hi[i] ^ (padded[o + 4] | (padded[o + 5] << 8) | (padded[o + 6] << 16) | (padded[o + 7] << 24))) >>> 0;
    }
    keccakF(lo, hi);
  }
  var out = '';
  for (i = 0; i < 4; i++) {
    for (var k = 0; k < 4; k++) out += ('0' + ((lo[i] >>> (8 * k)) & 255).toString(16)).slice(-2);
    for (k = 0; k < 4; k++) out += ('0' + ((hi[i] >>> (8 * k)) & 255).toString(16)).slice(-2);
  }
  return '0x' + out;
}

// ── x402 / MPP wire formats ─────────────────────────────────────────────────

function reqV2(c) {
  return { scheme: 'exact', network: NET_V2, amount: c.units, asset: USDC, payTo: c.payTo, maxTimeoutSeconds: TIMEOUT, extra: { name: 'USD Coin', version: '2' } };
}
function reqV1(c, url, desc) {
  return { scheme: 'exact', network: NET_V1, maxAmountRequired: c.units, asset: USDC, payTo: c.payTo, maxTimeoutSeconds: TIMEOUT, resource: url, description: desc, mimeType: 'text/html', extra: { name: 'USD Coin', version: '2' } };
}

function challengeId(c, realm, request, expires, digest, opaque) {
  var input = [realm, 'evm', 'charge', request, expires, digest || '', opaque || ''].join('|');
  return crypto.createHmac('sha256', c.secret).update(input).digest('base64url');
}

function mppChallenge(c, desc) {
  var request = { amount: c.units, currency: USDC, recipient: c.payTo, methodDetails: { chainId: 8453, credentialTypes: ['authorization'], decimals: 6 } };
  if (desc) request.description = desc;
  var rb = b64u(jcs(request));
  var expires = new Date(Date.now() + TIMEOUT * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  var id = challengeId(c, c.host, rb, expires);
  return 'Payment id="' + id + '", realm="' + c.host + '", method="evm", intent="charge", expires="' + expires + '", request="' + rb + '"';
}

function validateMpp(c, cred) {
  var bad = function (p, d) { return { problem: p, detail: d }; };
  if (!cred || !cred.challenge || typeof cred.challenge !== 'object' || !cred.payload || typeof cred.payload !== 'object') return bad('malformed-credential', 'Credential must contain challenge and payload objects.');
  var ch = cred.challenge;
  if (ch.realm !== c.host || ch.method !== 'evm' || ch.intent !== 'charge' || !ch.id || !ch.request || !ch.expires) return bad('invalid-challenge', 'Challenge fields missing or not issued by this realm.');
  if (!(Date.parse(ch.expires) >= Date.now())) return bad('payment-expired', 'Challenge has expired; retry with a fresh challenge.');
  if (challengeId(c, ch.realm, ch.request, ch.expires, ch.digest, ch.opaque) !== String(ch.id)) return bad('invalid-challenge', 'Challenge id does not match its parameters.');
  var rq = jsonOf(unb64u(ch.request));
  if (!rq || rq.amount !== c.units || String(rq.recipient || '').toLowerCase() !== c.payTo.toLowerCase() || String(rq.currency || '').toLowerCase() !== USDC.toLowerCase()) return bad('invalid-challenge', "Challenge request does not match this resource's payment terms.");
  var pl = cred.payload;
  if (pl.type !== 'authorization') return bad('verification-failed', 'Only credentialTypes ["authorization"] (EIP-3009) is accepted.');
  var fields = ['from', 'to', 'value', 'validAfter', 'validBefore', 'nonce', 'signature'];
  for (var i = 0; i < fields.length; i++) if (typeof pl[fields[i]] !== 'string' || pl[fields[i]] === '') return bad('verification-failed', 'Payload field ' + fields[i] + ' is required.');
  if (pl.nonce.toLowerCase() !== keccak256Hex(ch.id + ch.realm)) return bad('verification-failed', 'Payload nonce must equal keccak256(challenge.id || challenge.realm).');
  return null;
}

function extractPayment(c, h, url) {
  var raw, p;
  if ((raw = h['payment-signature'])) {
    p = jsonOf(unb64(raw));
    if (!p || Number(p.x402Version) !== 2 || !p.payload) return { rail: 'x402v2', error: 'malformed_payment_signature' };
    return { rail: 'x402v2', payload: p };
  }
  if ((raw = h['x-payment'])) {
    p = jsonOf(unb64(raw));
    if (!p || Number(p.x402Version) !== 1 || !p.payload) return { rail: 'x402v1', error: 'malformed_x_payment' };
    return { rail: 'x402v1', payload: p };
  }
  var m = h.authorization && /^Payment\s+([A-Za-z0-9_\-]+)$/i.exec(String(h.authorization).trim());
  if (m) {
    var cred = jsonOf(unb64u(m[1]));
    var err = validateMpp(c, cred);
    if (err) return { rail: 'mpp', error: err.problem, detail: err.detail };
    var pl = cred.payload;
    return { rail: 'mpp', payload: { x402Version: 2, resource: { url: url }, accepted: reqV2(c), payload: { signature: pl.signature,
      authorization: { from: pl.from, to: pl.to, value: pl.value, validAfter: pl.validAfter, validBefore: pl.validBefore, nonce: pl.nonce } } } };
  }
  return null;
}

function authOf(pay) {
  var a = pay && pay.payload && pay.payload.payload && pay.payload.payload.authorization;
  return a && typeof a === 'object' ? a : null;
}

function precheck(c, pay) {
  var a = authOf(pay);
  if (!a || !a.to || a.value === undefined || a.value === null || !a.nonce) return 'malformed_authorization';
  if (String(a.to).toLowerCase() !== c.payTo.toLowerCase()) return 'wrong_pay_to';
  var val = String(a.value);
  var over = /^\d+$/.test(val) && Number(val) >= Number(c.units) && pay.rail === 'x402v1';
  if (val !== c.units && !over) return 'wrong_amount';
  var p = pay.payload;
  if (pay.rail === 'x402v2') {
    var acc = p.accepted || {};
    if (acc.network !== NET_V2 || String(acc.asset || '').toLowerCase() !== USDC.toLowerCase()) return 'wrong_network_or_asset';
  } else if (pay.rail === 'x402v1') {
    if (p.network !== NET_V1 || p.scheme !== 'exact') return 'wrong_network_or_scheme';
  }
  if (a.validBefore !== undefined && /^\d+$/.test(String(a.validBefore)) && Number(a.validBefore) < Math.floor(Date.now() / 1000)) return 'authorization_expired';
  return null;
}

function post(url, body) {
  return ngx.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
    .then(function (rep) {
      return rep.text().then(function (t) {
        var j = jsonOf(t);
        return j ? { json: j } : { error: 'HTTP ' + rep.status + ': ' + String(t).slice(0, 200) };
      });
    })
    .catch(function (e) { return { error: String(e && e.message ? e.message : e) }; });
}

function verifyAndSettle(c, pay, url) {
  var p = JSON.parse(JSON.stringify(pay.payload));
  var req, version;
  if (pay.rail === 'x402v1') { req = reqV1(c, url, c.siteName); version = 1; }
  else { req = reqV2(c); version = 2; p.accepted = req; if (!p.resource) p.resource = { url: url }; }
  var body = { x402Version: version, paymentPayload: p, paymentRequirements: req };
  return post(c.facilitator + '/verify', body).then(function (v) {
    if (v.error) return { ok: false, reason: 'facilitator_unreachable', detail: v.error };
    if (!v.json.isValid) return { ok: false, reason: String(v.json.invalidReason || 'verification_failed'), payer: v.json.payer };
    return post(c.facilitator + '/settle', body).then(function (s) {
      if (s.error) return { ok: false, reason: 'facilitator_unreachable', detail: s.error };
      var tx = String(s.json.transaction || '');
      if (!s.json.success || tx === '') return { ok: false, reason: String(s.json.errorReason || 'settlement_failed') };
      return { ok: true, settle: s.json, tx: tx, payer: s.json.payer || v.json.payer };
    });
  });
}

// ── classifier ─────────────────────────────────────────────────────────────

function shortName(ua) { var m = /^([A-Za-z0-9_.\-]+)/.exec(String(ua).trim()); return (m ? m[1] : String(ua).trim()).slice(0, 60); }

function expandV6(ip) {
  var s = ip.toLowerCase(), halves = s.split('::');
  if (halves.length > 2) return null;
  var head = halves[0] ? halves[0].split(':') : [], tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  var fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 1) return null;
  var g = head.slice(); if (halves.length === 2) { for (var i = 0; i < fill; i++) g.push('0'); g = g.concat(tail); }
  return g.map(function (x) { return ('0000' + x).slice(-4); }).join(':');
}
var isV4 = function (ip) { return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip); };
function normIp(ip) { return isV4(ip) ? ip : (ip.indexOf(':') >= 0 && expandV6(ip)) || ip.toLowerCase(); }
function arpa(ip) {
  if (isV4(ip)) return ip.split('.').reverse().join('.') + '.in-addr.arpa';
  return expandV6(ip).replace(/:/g, '').split('').reverse().join('.') + '.ip6.arpa';
}

function doh(c, name, type) {
  return ngx.fetch(c.doh + '?name=' + encodeURIComponent(name) + '&type=' + type, { headers: { Accept: 'application/dns-json' } })
    .then(function (rep) { if (rep.status !== 200) throw new Error('doh http ' + rep.status); return rep.json(); })
    .then(function (j) {
      if (j.Status !== 0 && j.Status !== 3) throw new Error('doh status ' + j.Status);
      var want = { A: 1, AAAA: 28, PTR: 12 }[type];
      return (j.Answer || []).filter(function (a) { return a.type === want; }).map(function (a) { return String(a.data); });
    });
}

// true / false / null (DNS unavailable: claim kept, unverified)
function verifyRdns(c, ip, suffixes) {
  if (!ip || !(isV4(ip) || (ip.indexOf(':') >= 0 && expandV6(ip)))) return Promise.resolve(null);
  var key = 'rdns:' + normIp(ip) + '|' + suffixes.join(',');
  var cached = ngx.shared.ppc_rdns.get(key);
  if (cached === 'y' || cached === 'n') return Promise.resolve(cached === 'y');
  return doh(c, arpa(ip), 'PTR').then(function (hosts) {
    var host = hosts[0] ? hosts[0].toLowerCase().replace(/\.$/, '') : '';
    if (!host || !suffixes.some(function (s) { return host.slice(-s.length) === s.toLowerCase(); })) return false;
    return Promise.all([doh(c, host, 'A'), doh(c, host, 'AAAA')]).then(function (res) {
      var want = normIp(ip);
      return res[0].concat(res[1]).some(function (f) { return normIp(f) === want; });
    });
  }).then(function (ok) {
    ngx.shared.ppc_rdns.set(key, ok ? 'y' : 'n');
    return ok;
  }).catch(function () { return null; });
}

function classify(c, ua, accept, ip) {
  var l = String(ua || '').trim().toLowerCase();
  for (var i = 0; i < CATALOG.length; i++) {
    var e = CATALOG[i];
    for (var k = 0; k < e[2].length; k++) {
      if (l.indexOf(e[2][k]) < 0) continue;
      if (e[3].length && ip && c.verifyRdns) {
        return verifyRdns(c, ip, e[3]).then(function (ok) {
          return ok === false ? { cls: 'automation', name: e[0] } : { cls: e[1], name: e[0] };
        });
      }
      return Promise.resolve({ cls: e[1], name: e[0] });
    }
  }
  var out;
  if (l === '') out = { cls: 'automation', name: 'Empty User-Agent' };
  else if (/\b(bot|crawler|spider|scraper|fetcher|crawl|agent|archiver|indexer)\b/.test(l)) out = { cls: 'bot', name: shortName(ua) };
  else if (l.indexOf('mozilla/') >= 0 && /(chrome|safari|firefox|edg|opera|opr|msie|trident|samsungbrowser|ucbrowser)/.test(l)) {
    var a = String(accept || '').toLowerCase();
    out = a !== '' && a.indexOf('text/html') < 0 && a.indexOf('*/*') < 0 && a.indexOf('image/') < 0 ? { cls: 'automation', name: 'Browser-UA tool' } : { cls: 'human', name: '' };
  } else out = { cls: 'bot', name: shortName(ua) };
  return Promise.resolve(out);
}

// ── discovery documents ────────────────────────────────────────────────────

function discovery(c, path) {
  var desc, p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  if (p === '/.well-known/x402.json') {
    var m = { x402Version: 2, provider: { name: c.siteName, url: c.base, description: '', contact: null }, resources: [{ resource: c.base + '{path}', type: 'http',
      metadata: { method: 'GET', name: c.siteName + ': page fetch', description: 'Any page on ' + c.host + ', served as HTML to automated clients after an x402 payment of $' + priceString(c.price) + ' USDC on Base. Humans and verified search engines read free.', priceUsd: c.price, mimeType: 'text/html', paid: c.paid },
      accepts: [{ scheme: 'exact', network: NET_V2, amount: c.units, asset: USDC, payTo: c.payTo, maxTimeoutSeconds: TIMEOUT, extra: { name: 'USD Coin', version: '2' } }] }],
      protocols: ['x402', 'mpp'], generator: 'forgemesh-pay-per-crawl-nginx/' + VERSION, sitemap: c.base + 'sitemap.xml' };
    return { type: 'application/json; charset=utf-8', body: JSON.stringify(m, null, 2) };
  }
  if (p === '/llms.txt') {
    desc = c.paid
      ? 'Pages on this site answer HTTP 402 to crawlers and agents. Pay $' + priceString(c.price) + ' USDC on Base per page with x402 (PAYMENT-SIGNATURE or X-PAYMENT header) or MPP (Authorization: Payment) and retry the same URL.'
      : 'This site is instrumented for x402 pay-per-crawl; charging is not enabled yet. Terms will appear in the manifest below when it is.';
    return { type: 'text/plain; charset=utf-8', body: ['# ' + c.siteName, '', 'Site: ' + c.base, 'Sitemap: ' + c.base + 'sitemap.xml', '', '## Access for automated clients', '', desc, 'Verified search engines and humans are never charged.', '',
      'Manifest: ' + c.base + '.well-known/x402.json', 'Agents: ' + c.base + 'agents.txt', 'Protocol: https://x402.org'].join('\n') + '\n' };
  }
  if (p === '/agents.txt') {
    return { type: 'text/plain; charset=utf-8', body: ['# agents.txt — ' + c.host, '# Standard: https://agents-txt.com', '', 'Name: ' + c.siteName, 'Provider: ' + c.siteName + ' (' + c.base + ')', 'Protocols: x402, mpp, http',
      'Payments: ' + (c.paid ? 'required' : 'none'), '', 'LLMs: ' + c.base + 'llms.txt', 'x402: ' + c.base + '.well-known/x402.json', 'Sitemap: ' + c.base + 'sitemap.xml', '', '## Payment',
      'Protocol: x402 (HTTP 402 challenge; pay and retry with PAYMENT-SIGNATURE) and MPP (WWW-Authenticate: Payment)', 'Network: ' + NET_V2, 'Asset: ' + USDC + ' (USDC)',
      'Price: $' + priceString(c.price) + ' per page', 'PayTo: ' + c.payTo, ''].join('\n') };
  }
  return null;
}

// ── the handler ────────────────────────────────────────────────────────────

function send(r, status, type, body, extra) {
  r.headersOut['Content-Type'] = type;
  for (var k in (extra || {})) r.headersOut[k] = extra[k];
  r.return(status, r.method === 'HEAD' ? '' : body);
}

function respond402(r, c, url, reason, detail, rail) {
  var desc = c.siteName + ': one page fetch (HTML)';
  var env = { x402Version: 2, error: reason || 'Payment required', resource: { url: url, description: desc, mimeType: 'text/html' }, accepts: [reqV2(c)] };
  var h = {
    'Cache-Control': 'no-store', 'PAYMENT-REQUIRED': b64(JSON.stringify(env)), 'WWW-Authenticate': mppChallenge(c, desc),
    Link: '<' + c.base + '.well-known/x402.json>; rel="describedby"; type="application/json"', 'X-Robots-Tag': 'noindex'
  };
  if (rail === 'mpp' && reason) {
    return send(r, 402, 'application/problem+json; charset=utf-8', JSON.stringify({ type: 'https://paymentauth.org/problems/' + reason, title: 'Payment Required', status: 402, detail: detail || reason }), h);
  }
  var body = { x402Version: 1, error: reason ? 'Payment rejected' : 'Payment required', accepts: [reqV1(c, url, desc)],
    provider: { name: c.siteName, plugin: 'forgemesh-pay-per-crawl' }, docs: { x402: 'https://x402.org', manifest: c.base + '.well-known/x402.json' } };
  if (reason) body.invalidReason = reason;
  return send(r, 402, 'application/json; charset=utf-8', JSON.stringify(body), h);
}

function policyFor(c, cls) {
  var o = c.overrides[cls.name];
  if (cls.name !== '' && ['free', 'paid', 'block'].indexOf(o) >= 0) return o;
  return c.policy[cls.cls] || 'paid';
}

function lowerHeaders(r) {
  var h = {};
  var all = r.rawHeadersIn;
  for (var i = 0; i < all.length; i++) { var k = all[i][0].toLowerCase(); if (h[k] === undefined) h[k] = all[i][1]; }
  return h;
}

function passThrough(r, c, extra) {
  r.variables.ppc_link = '<' + c.base + '.well-known/x402.json>; rel="describedby"; type="application/json", <' + c.base + 'llms.txt>; rel="llms-txt"; type="text/plain"';
  if (extra) for (var k in extra) r.variables[k] = extra[k];
  r.internalRedirect('@ppc_origin');
}

function gate(r) {
  var c;
  try { c = config(r); } catch (e) { r.error('pay-per-crawl config error: ' + e); return r.internalRedirect('@ppc_origin'); }
  var path = r.uri, method = r.method;
  var url = c.base.replace(/\/$/, '') + r.variables.request_uri;

  var d = (method === 'GET' || method === 'HEAD') ? discovery(c, path) : null;
  if (d) return send(r, 200, d.type, d.body, { 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' });

  var exempt = (method !== 'GET' && method !== 'HEAD') ||
    ALWAYS_FREE.some(function (p) { return path.indexOf(p) === 0; }) ||
    c.allow.some(function (p) { return path.indexOf(p) === 0; }) ||
    (!c.gateAssets && ASSET_EXT.test(path));
  if (exempt) return passThrough(r, c);

  var h = lowerHeaders(r);
  var ip = r.remoteAddress;
  // trusted multi-value header: take the RIGHT-MOST entry (appended by our own proxy), never the client-controlled left-most
  if (c.trust && h[c.trust]) { var parts = h[c.trust].split(',').map(function (x) { return x.trim(); }).filter(Boolean); var first = parts[parts.length - 1] || '';  if (isV4(first) || first.indexOf(':') >= 0) ip = first; }

  return classify(c, h['user-agent'] || '', h.accept, ip).then(function (cls) {
    r.variables.ppc_class = cls.cls;
    r.variables.ppc_bot = cls.name;
    var payment = extractPayment(c, h, url);
    var mark = function (s, extra) { r.variables.ppc_status = s; return extra; };

    if (cls.cls === 'human' && !payment) { mark('passed'); return passThrough(r, c); }
    var policy = policyFor(c, cls);
    if (policy === 'free' && !payment) { mark('passed'); return passThrough(r, c); }
    if (policy === 'block') {
      mark('blocked');
      return send(r, 403, 'application/json; charset=utf-8', JSON.stringify({ error: 'forbidden', detail: 'This crawler is not permitted on this site.' }), { 'Cache-Control': 'no-store' });
    }
    if (!payment) {
      if (c.mode === 'monitor') { mark('monitor'); return passThrough(r, c); }
      mark('unpaid');
      return respond402(r, c, url, null, null, null);
    }

    var reject = function (status, reason, detail) { mark(status); r.variables.ppc_reason = reason; return respond402(r, c, url, reason, detail, payment.rail); };
    if (payment.error) return reject('rejected', payment.error, payment.detail);
    var pre = precheck(c, payment);
    if (pre) return reject('rejected', pre);

    var auth = authOf(payment);
    var lockKey = 'n:' + crypto.createHash('sha256').update(String(auth.nonce).toLowerCase()).digest('hex');
    if (!ngx.shared.ppc_nonce.add(lockKey, '1')) return reject('rejected', 'payment_in_flight', 'This authorization was already presented.');

    return verifyAndSettle(c, payment, url).then(function (res) {
      if (!res.ok) {
        if (res.reason === 'facilitator_unreachable') ngx.shared.ppc_nonce.delete(lockKey); // let the client retry the same authorization
        return reject('settle_failed', res.reason, res.detail);
      }
      mark('paid');
      r.variables.ppc_tx = res.tx;
      var receipt = b64(JSON.stringify(res.settle));
      var extra = { ppc_receipt: receipt, ppc_cache_control: 'private, no-store', ppc_paid: '1' };
      if (payment.rail === 'mpp') extra.ppc_mpp_receipt = b64u(JSON.stringify({ status: 'success', method: 'evm', timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), reference: res.tx }));
      return passThrough(r, c, extra);
    });
  }).catch(function (e) {
    r.error('pay-per-crawl error, passing through: ' + e); // fail open
    return r.internalRedirect('@ppc_origin');
  });
}

export default { gate: gate, keccak256Hex: keccak256Hex, VERSION: VERSION };
