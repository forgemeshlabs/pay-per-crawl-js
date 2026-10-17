import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { payPerCrawl } from "@forgemesh/pay-per-crawl-node/hono";

const app = new Hono();
app.use("*", payPerCrawl({ siteName: "Hono example" }));
app.get("/robots.txt", (c) => c.text("User-agent: *\nAllow: /\n"));
app.get("/paid-test", (c) => c.html("<h1>ZZPAIDZZ</h1>"));
app.get("/", (c) => c.html("<h1>Home</h1>"));
serve({ fetch: app.fetch, port: Number(process.env.PORT || 3000), hostname: "127.0.0.1" });
