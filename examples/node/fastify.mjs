import Fastify from "fastify";
import { payPerCrawl } from "@forgemeshlabs/pay-per-crawl-node/fastify";

const app = Fastify();
await app.register(payPerCrawl, { siteName: "Fastify example" });
app.get("/robots.txt", async (_req, reply) => reply.type("text/plain").send("User-agent: *\nAllow: /\n"));
app.get("/paid-test", async (_req, reply) => reply.type("text/html").send("<h1>ZZPAIDZZ</h1>"));
app.get("/", async (_req, reply) => reply.type("text/html").send("<h1>Home</h1>"));
await app.listen({ port: Number(process.env.PORT || 3000), host: "127.0.0.1" });
