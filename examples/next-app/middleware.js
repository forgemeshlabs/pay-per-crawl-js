import { createPayPerCrawl } from "@forgemesh/pay-per-crawl-next";

// Reads PAY_TO, PRICE_USD, MODE, FACILITATOR_URL, ... from the environment; options here win.
const ppc = createPayPerCrawl({ siteName: "Example Next Site" });

export const middleware = ppc.middleware;

// Next requires `config` to be a literal in this file (it cannot be re-exported).
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
