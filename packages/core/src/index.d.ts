export type Policy = "free" | "paid" | "block";
export interface Store { get(k: string): Promise<string | null>; put(k: string, v: string, o?: { ttl?: number }): Promise<void>; delete(k: string): Promise<void>; }
export interface Resolver { reverse(ip: string): Promise<string[]>; forward(host: string): Promise<string[]>; }
export interface GateEvent {
  ts: string; ua_class: string; bot_name: string; verified: boolean | null; method: string; path: string; ip_hash: string; ua: string;
  status: "passed" | "blocked" | "monitor" | "unpaid" | "rejected" | "settle_failed" | "paid";
  rail?: "x402v2" | "x402v1" | "mpp"; amount_units?: number; tx_hash?: string; payer?: string; reason?: string;
}
export interface GateOptions {
  payTo?: string; priceUsd?: number; mode?: "monitor" | "gate"; facilitatorUrl?: string; facilitatorAuth?: string;
  classPolicy?: Partial<Record<string, Policy>>; botOverrides?: Record<string, Policy>; allowPaths?: string[];
  gateAssets?: boolean; gateAllMethods?: boolean; discovery?: boolean; siteName?: string; siteDescription?: string; contact?: string;
  llmsLinks?: { title: string; url: string }[]; mppSecret?: string; trustHeader?: string; logHumans?: boolean; baseUrl?: string;
  store?: Store; resolver?: Resolver; fetch?: typeof fetch; catalog?: object[] | (() => Promise<object[]>); onEvent?: (e: GateEvent) => unknown; ipSalt?: string;
}
export type GateResult = { type: "pass"; headers: Headers; event?: GateEvent } | { type: "respond"; response: Response; event?: GateEvent };
export interface Gate {
  settings: Record<string, unknown>;
  handle(request: Request, ctx?: { ip?: string; waitUntil?: (p: Promise<unknown>) => void }): Promise<GateResult>;
  discovery(request: Request): Response | null;
  linkHeader(url: string): string;
  store: Store;
}
export function createGate(options?: GateOptions): Gate;
export function resolveSettings(options?: GateOptions): Record<string, unknown>;
export function parseConfig(env?: Record<string, unknown>): GateOptions;
export function applyToResponse(res: Response, headers: Headers): Response;
export function classify(ua: string, headers?: Record<string, string>, ip?: string, opts?: { catalog?: object[]; resolver?: Resolver; store?: Store }): Promise<{ class: string; name: string; verified: boolean | null; impersonation: boolean }>;
export function dohResolver(o?: { fetch?: typeof fetch; endpoint?: string; timeoutMs?: number }): Resolver;
export function memoryStore(max?: number): Store;
export function kvStore(kv: unknown): Store;
export function createProReporter(o: { key: string; site: Record<string, unknown>; store?: Store; fetch?: typeof fetch; base?: string }): {
  enabled: boolean; record(e: GateEvent): Promise<void>; flush(o?: { force?: boolean }): Promise<unknown>; verify(): Promise<unknown>; fetchIntel(): Promise<unknown>; catalog(): Promise<object[]>;
};
export function proEnabled(key: string): boolean;
export const SHIPPED_CATALOG: object[];
export const CLASSES: string[];
export const VERSION: string;
export function keccakHex(s: string): string;
export function usdToUnits(usd: number | string): string;
export class X402 { constructor(cfg: Record<string, unknown>); [k: string]: any }
export function discoveryResponse(pathname: string, settings: Record<string, unknown>, base: string, version: string): Response | null;
export function robotsLines(base: string): string;
