// PAY_TO=0x... MODE=gate node express.mjs
import express from "express";
import { payPerCrawl } from "@forgemesh/pay-per-crawl-node/express";

const app = express();
app.use(payPerCrawl({ siteName: "Express example" })); // PAY_TO, PRICE_USD, MODE... come from env
app.get("/robots.txt", (_req, res) => res.type("text/plain").send("User-agent: *\nAllow: /\n"));
app.get("/paid-test", (_req, res) => res.send("<h1>ZZPAIDZZ</h1>"));
app.get("/", (_req, res) => res.send("<h1>Home</h1>"));
app.listen(Number(process.env.PORT || 3000), "127.0.0.1");
