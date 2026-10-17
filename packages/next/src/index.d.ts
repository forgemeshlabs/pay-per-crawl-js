import type { GateOptions, Gate } from "@forgemeshlabs/pay-per-crawl-core";
export const recommendedMatcher: string;
export interface PayPerCrawlOptions extends GateOptions { pro?: { key?: string; listed?: boolean }; env?: Record<string, string | undefined> }
type RouteHandler = { GET: (request: Request) => Promise<Response> };
export function createPayPerCrawl(options?: PayPerCrawlOptions): {
  middleware: (request: any, event?: any) => Promise<Response>;
  proxy: (request: any, event?: any) => Promise<Response>;
  handlers: { x402Json: RouteHandler; llmsTxt: RouteHandler; agentsTxt: RouteHandler };
  readonly gate: Gate;
};
