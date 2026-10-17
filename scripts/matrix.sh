#!/usr/bin/env bash
# Curl matrix against a running gate. usage: matrix.sh <base-url> [mock-facilitator-log]
# Needs the mock facilitator (scripts/mock-facilitator.mjs) as the gate's FACILITATOR_URL,
# PAY_TO=0x13C3C28c64cc9d60eEb8a675F3fe27eBC6a4Cd09, PRICE_USD=0.01, MODE=gate. Page body must contain ZZPAIDZZ.
set -u
B=${1:?base url}; LOG=${2:-/tmp/ppc-mock.log}
HERE="$(cd "$(dirname "$0")" && pwd)"
T=$(mktemp -d); pass=0; fail=0
ok(){ if [ "$1" = "$2" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: $3 (got '$1' want '$2')"; fi; }
code(){ curl -s -o $T/body -D $T/h -w '%{http_code}' "$@"; }
hdr(){ grep -i "^$1:" $T/h | head -1 | cut -d' ' -f2- | tr -d '\r'; }
pay(){ node "$HERE/mk-payment.mjs" "$@"; }
UA_H='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'
UA_G='Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)'
URL=$B/paid-test

ok "$(code -A "$UA_H" -H 'Accept: text/html' $URL)" 200 "human gets page"
grep -q ZZPAIDZZ $T/body; ok $? 0 "human sees content"
ok "$(code -A "$UA_G" $URL)" 402 "gptbot gets 402"
grep -q ZZPAIDZZ $T/body; ok $? 1 "402 body has no content"
ok "$(hdr content-type)" "application/json; charset=utf-8" "402 content-type"
ok "$(hdr cache-control | grep -c no-store)" 1 "402 no-store"
ok "$(hdr payment-required | base64 -d | node -e 'const j=JSON.parse(require("fs").readFileSync(0));console.log(j.x402Version+"|"+j.accepts[0].network+"|"+j.accepts[0].amount+"|"+j.accepts[0].payTo)')" "2|eip155:8453|10000|0x13C3C28c64cc9d60eEb8a675F3fe27eBC6a4Cd09" "PAYMENT-REQUIRED v2 envelope"
ok "$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(j.x402Version+"|"+j.accepts[0].network+"|"+j.accepts[0].maxAmountRequired)' $T/body)" "1|base|10000" "v1 body"
ok "$(hdr www-authenticate | grep -c 'Payment id=".*method="evm".*intent="charge".*request="')" 1 "MPP WWW-Authenticate"
ok "$(hdr link | grep -c 'x402.json.*describedby')" 1 "402 Link describedby"
ok "$(code -I -A "$UA_G" $URL)" 402 "HEAD gets 402"
ok "$(code -A 'curl/8.5' $B/)" 402 "curl on home gets 402"
ok "$(code -A 'curl/8.5' "$B/?p=1")" 402 "curl on query url gets 402"
ok "$(code -A 'facebookexternalhit/1.1' $URL)" 200 "social preview free"
ok "$(code -A "$UA_G" $B/robots.txt)" 200 "robots free"
ok "$(code -A "$UA_G" $B/.well-known/x402.json)" 200 "manifest free"
ok "$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(j.x402Version+"|"+j.resources[0].accepts[0].payTo+"|"+(j.resources[0].metadata.paid?"paid":"free"))' $T/body)" "2|0x13C3C28c64cc9d60eEb8a675F3fe27eBC6a4Cd09|paid" "manifest content"
ok "$(code -A "$UA_G" $B/llms.txt)" 200 "llms free"; grep -q "answer HTTP 402" $T/body; ok $? 0 "llms describes payment"
ok "$(code -A "$UA_G" $B/agents.txt)" 200 "agents free"; grep -q "Payments: required" $T/body; ok $? 0 "agents.txt payments required"

# payments through the mock facilitator
V2=$(pay v2 $URL)
ok "$(code -A "$UA_G" -H "$V2" $URL)" 200 "v2 paid gets 200"
grep -q ZZPAIDZZ $T/body; ok $? 0 "v2 paid sees content"
ok "$(hdr payment-response | base64 -d | node -e 'const j=JSON.parse(require("fs").readFileSync(0));console.log((j.success?"ok":"no")+"|"+j.transaction.slice(0,6))')" "ok|0xabab" "PAYMENT-RESPONSE receipt"
ok "$(hdr x-payment-response | wc -c | awk '{print ($1>10)?"yes":"no"}')" yes "X-PAYMENT-RESPONSE mirrored"
ok "$(code -A "$UA_G" -H "$V2" $URL)" 402 "replayed nonce rejected"
grep -q payment_in_flight $T/body; ok $? 0 "replay reason in body"
V1=$(pay v1 $URL)
ok "$(code -A 'x402-fetch/1.2.0' -H "$V1" $URL)" 200 "v1 paid gets 200"
ok "$(grep '"/settle"' $LOG | tail -1 | node -e 'const j=JSON.parse(require("fs").readFileSync(0));console.log(j.body.x402Version+"|"+j.body.paymentRequirements.network)')" "1|base" "v1 forwarded as v1 to facilitator"
ok "$(code -A 'x402-fetch/1.2.0' -H "$(pay v1-under $URL)" $URL)" 402 "underpayment rejected"
grep -q wrong_amount $T/body; ok $? 0 "underpayment reason"
code -A "$UA_G" $URL >/dev/null; WA=$(hdr www-authenticate)
CRED=$(pay mpp $URL "$WA")
ok "$(code -A 'mpp-client/1' -H "$CRED" $URL)" 200 "MPP paid gets 200"
ok "$(hdr payment-receipt | wc -c | awk '{print ($1>10)?"yes":"no"}')" yes "Payment-Receipt header"
ok "$(code -A 'mpp-client/1' -H "$CRED" $URL)" 402 "MPP replay rejected"
ok "$(hdr content-type)" "application/problem+json; charset=utf-8" "MPP problem+json"
ok "$(grep -c '"/verify"' $LOG)" 3 "facilitator verify called once per valid payment"
ok "$(grep -c '"/settle"' $LOG)" 3 "facilitator settle called once per valid payment"
echo "matrix pass=$pass fail=$fail"
rm -rf $T
exit $fail
