import type { GateOptions, Gate } from "@forgemeshlabs/pay-per-crawl-core";
export const recommendedMatcher: string;
export function next(init?: { headers?: HeadersInit }): Response;
export interface PayPerCrawlOptions extends GateOptions { pro?: { key?: string; listed?: boolean }; env?: Record<string, string | undefined> }
type EdgeHandler = (request: Request) => Promise<Response>;
export function createPayPerCrawl(options?: PayPerCrawlOptions): {
  middleware: (request: Request, context?: { waitUntil?: (p: Promise<unknown>) => void }) => Promise<Response>;
  handlers: { x402Json: EdgeHandler; llmsTxt: EdgeHandler; agentsTxt: EdgeHandler };
  readonly gate: Gate;
};
