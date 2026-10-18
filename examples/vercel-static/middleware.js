// Vercel Edge Middleware for a static site. Deploy this folder with `vercel` and set PAY_TO / PRICE_USD / MODE in the project env.
import { createPayPerCrawl } from "@forgemeshlabs/pay-per-crawl-vercel";
const ppc = createPayPerCrawl({ siteName: "Pay-per-Crawl static demo" });
export default ppc.middleware;
// Vercel needs `config` as a literal in this file; it cannot be re-exported.
export const config = { matcher: ["/((?!_vercel|favicon.ico).*)"] };
