import Koa from "koa";
import { payPerCrawl } from "@forgemeshlabs/pay-per-crawl-node/koa";

const app = new Koa();
app.use(payPerCrawl({ siteName: "Koa example" }));
app.use(async (ctx) => {
  if (ctx.path === "/robots.txt") { ctx.type = "text/plain"; ctx.body = "User-agent: *\nAllow: /\n"; }
  else if (ctx.path === "/paid-test") { ctx.type = "text/html"; ctx.body = "<h1>ZZPAIDZZ</h1>"; }
  else { ctx.type = "text/html"; ctx.body = "<h1>Home</h1>"; }
});
app.listen(Number(process.env.PORT || 3000), "127.0.0.1");
