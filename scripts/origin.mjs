// Tiny origin for the Worker test: serves a page containing ZZPAIDZZ.
import http from "node:http";
http.createServer((req, res) => {
  if (req.url.startsWith("/robots.txt")) { res.setHeader("content-type", "text/plain"); return res.end("User-agent: *\nAllow: /\n"); }
  res.setHeader("content-type", "text/html");
  res.end("<html><body><h1>ZZPAIDZZ</h1></body></html>");
}).listen(Number(process.env.PORT || 8410), "127.0.0.1");
