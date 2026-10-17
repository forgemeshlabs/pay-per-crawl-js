// Mock x402 facilitator for local tests. PORT (default 8403), LOG file, MODE ok|reject|notx.
import http from "node:http";
import fs from "node:fs";

const port = Number(process.env.PORT || 8403);
const log = process.env.LOG || "/tmp/ppc-mock.log";
const mode = process.env.MODE || "ok";
fs.writeFileSync(log, "");
http.createServer((req, res) => {
  let data = "";
  req.on("data", (c) => (data += c));
  req.on("end", () => {
    let body = null; try { body = JSON.parse(data); } catch { /* none */ }
    fs.appendFileSync(log, JSON.stringify({ path: req.url, body }) + "\n");
    res.setHeader("content-type", "application/json");
    const from = body?.paymentPayload?.payload?.authorization?.from || "0x0";
    if (req.url === "/verify") return res.end(JSON.stringify(mode === "reject" ? { isValid: false, invalidReason: "insufficient_funds" } : { isValid: true, payer: from }));
    if (req.url === "/settle") return res.end(JSON.stringify(mode === "notx" ? { success: true, transaction: "" } : { success: true, transaction: "0x" + "ab".repeat(32), network: body.paymentRequirements.network, payer: from }));
    res.statusCode = 404; res.end("{}");
  });
}).listen(port, "127.0.0.1", () => console.log("mock facilitator on", port));
