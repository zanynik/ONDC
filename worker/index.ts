/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { blake2b } from "blakejs";
import { Buffer } from "node:buffer";
import { createHmac, createPrivateKey, sign, timingSafeEqual } from "node:crypto";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  ONDC_SUBSCRIBER_ID?: string;
  ONDC_SUBSCRIBER_URL?: string;
  ONDC_SIGNING_PRIVATE_KEY?: string;
  ONDC_ENCRYPTION_PRIVATE_KEY?: string;
  ONDC_UNIQUE_KEY_ID?: string;
  ONDC_WORKBENCH_TOKEN?: string;
  ONDC_RUNNER_SIGNING_SECRET?: string;
  N_O_Token?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const ondcCallbacks = new Set([
  "/buyer/on_search", "/buyer/on_select", "/buyer/on_init", "/buyer/on_confirm",
  "/buyer/on_status", "/buyer/on_cancel", "/buyer/on_update", "/buyer/on_track",
  "/buyer/on_issue", "/buyer/on_issue_status",
  "/buyer/on_recon", "/buyer/on_settle", "/buyer/on_report",
  "/buyer/recon", "/buyer/settle", "/buyer/report",
]);

const workbenchActions = new Set([
  "search", "select", "init", "confirm", "status", "track", "cancel", "update",
  "issue", "issue_status", "catalog_rejection",
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function protocolContext(payload: unknown) {
  const context = payload && typeof payload === "object" && "context" in payload
    ? (payload as { context?: Record<string, unknown> }).context : undefined;
  return {
    action: typeof context?.action === "string" ? context.action : "unknown",
    transactionId: typeof context?.transaction_id === "string" ? context.transaction_id : null,
    messageId: typeof context?.message_id === "string" ? context.message_id : null,
  };
}

function writeProtocolLog(
  env: Env,
  direction: "INBOUND" | "OUTBOUND",
  endpoint: string,
  rawPayload: string,
  payload: unknown,
  statusCode: number | null,
) {
  const context = protocolContext(payload);
  return env.DB.prepare(
    "INSERT INTO ondc_protocol_logs (direction, action, transaction_id, message_id, endpoint, status_code, created_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(direction, context.action, context.transactionId, context.messageId, endpoint, statusCode, Date.now(), rawPayload).run();
}

type ProtocolOrder = Record<string, unknown> & {
  id?: string;
  provider?: Record<string, unknown>;
  items?: Array<Record<string, unknown>>;
  fulfillments?: Array<Record<string, unknown>>;
  payment?: Record<string, unknown>;
  quote?: { breakup?: Array<Record<string, unknown>>; [key: string]: unknown };
  tags?: Array<Record<string, unknown>>;
};

async function latestCallbackOrder(env: Env, transactionId: string, action: string): Promise<ProtocolOrder | null> {
  const row = await env.DB.prepare(
    "SELECT payload FROM ondc_callbacks WHERE transaction_id = ? AND action = ? ORDER BY id DESC LIMIT 1"
  ).bind(transactionId, action).first<{ payload?: string }>();
  if (!row?.payload) return null;
  try {
    const payload = JSON.parse(row.payload) as { message?: { order?: ProtocolOrder } };
    return payload.message?.order ?? null;
  } catch {
    return null;
  }
}

async function latestSettlementCallbackOrder(env: Env, transactionId: string): Promise<ProtocolOrder | null> {
  const row = await env.DB.prepare(
    "SELECT payload FROM ondc_callbacks WHERE transaction_id = ? AND action IN ('on_update', 'on_cancel') ORDER BY id DESC LIMIT 1"
  ).bind(transactionId).first<{ payload?: string }>();
  if (!row?.payload) return null;
  try {
    const payload = JSON.parse(row.payload) as { message?: { order?: ProtocolOrder } };
    return payload.message?.order ?? null;
  } catch {
    return null;
  }
}

function protocolItems(items: Array<Record<string, unknown>> | undefined, fulfillmentId: string) {
  const source = items?.length ? items : [{ id: "I1", quantity: { count: 1 }, fulfillment_id: fulfillmentId }];
  return source.map((item) => ({
    id: item.id,
    fulfillment_id: item.fulfillment_id ?? fulfillmentId,
    quantity: item.quantity ?? { count: 1 },
  }));
}

function tagsByCode(tags: Array<Record<string, unknown>> | undefined, code: string) {
  return tags?.filter((tag) => tag.code === code) ?? [];
}

function normalizeIssueResolutionRefs(payload: Record<string, unknown>) {
  const message = payload.message;
  if (!message || typeof message !== "object" || Array.isArray(message)) return payload;
  const issue = (message as Record<string, unknown>).issue;
  if (!issue || typeof issue !== "object" || Array.isArray(issue)) return payload;
  const issueRecord = issue as Record<string, unknown>;
  const resolutions = Array.isArray(issueRecord.resolutions)
    ? issueRecord.resolutions
    : Array.isArray(issueRecord.resolution) ? issueRecord.resolution : [];
  const resolutionIds = resolutions.flatMap((resolution) => {
    if (!resolution || typeof resolution !== "object" || Array.isArray(resolution)) return [];
    const id = (resolution as Record<string, unknown>).id;
    return typeof id === "string" && id.trim() ? [id] : [];
  });
  const actions = Array.isArray(issueRecord.actions) ? issueRecord.actions : [];
  const leafResolutionIds = resolutions.flatMap((resolution) => {
    if (!resolution || typeof resolution !== "object" || Array.isArray(resolution)) return [];
    const resolutionRecord = resolution as Record<string, unknown>;
    const descriptor = resolutionRecord.descriptor;
    const code = descriptor && typeof descriptor === "object" && !Array.isArray(descriptor)
      ? (descriptor as Record<string, unknown>).code
      : undefined;
    const id = resolutionRecord.id;
    return typeof id === "string" && id.trim() && code !== "PARENT" ? [id] : [];
  });

  issueRecord.actions = actions.map((action) => {
    if (!action || typeof action !== "object" || Array.isArray(action)) return action;
    const actionRecord = action as Record<string, unknown>;
    const refId = actionRecord.ref_id;
    if (typeof refId !== "string") return action;

    const normalizedRef = refId.trim().toLowerCase();
    const exactMatch = resolutionIds.find((id) => id.trim().toLowerCase() === normalizedRef);
    if (exactMatch) return { ...actionRecord, ref_id: exactMatch };

    const labelledMatch = resolutionIds.find((id) => {
      const normalizedId = id.trim().toLowerCase();
      return normalizedRef.startsWith(`${normalizedId}-`) || normalizedRef.startsWith(`${normalizedId} `);
    });
    if (labelledMatch) return { ...actionRecord, ref_id: labelledMatch };

    const genericLabelMatch = /^(R(?:_PARENT|\d+))(?:[-\s].*)$/i.exec(refId.trim());
    if (genericLabelMatch && !resolutionIds.length) {
      return { ...actionRecord, ref_id: genericLabelMatch[1].toUpperCase() };
    }

    const descriptor = actionRecord.descriptor;
    const code = descriptor && typeof descriptor === "object" && !Array.isArray(descriptor)
      ? (descriptor as Record<string, unknown>).code
      : undefined;
    const resolutionAction = code === "RESOLUTION_REJECTED" || code === "RESOLUTION_ACCEPTED" || code === "RESOLVED";
    if (resolutionAction && leafResolutionIds.length) {
      return { ...actionRecord, ref_id: leafResolutionIds[leafResolutionIds.length - 1] };
    }
    if (resolutionIds.length === 1) return { ...actionRecord, ref_id: resolutionIds[0] };
    return action;
  });
  return payload;
}

function quoteTrailTotal(order: ProtocolOrder | null) {
  const allFulfillments = order?.fulfillments ?? [];
  const rtoFulfillments = allFulfillments.filter((fulfillment) => fulfillment.type === "RTO");
  const relevantFulfillments = rtoFulfillments.length ? rtoFulfillments : allFulfillments;
  const quoteBreakupValues = rtoFulfillments.length ? [] : order?.quote?.breakup
    ?.filter((entry) => entry["@ondc/org/title_type"] === "quote_trail")
    .map((entry) => (entry.price as { value?: unknown } | undefined)?.value) ?? [];
  const fulfillmentTagValues = relevantFulfillments.flatMap((fulfillment) => {
    const tags = fulfillment.tags as Array<{ code?: unknown; list?: Array<{ code?: unknown; value?: unknown }> }> | undefined;
    return tags?.filter((tag) => tag.code === "quote_trail")
      .flatMap((tag) => tag.list?.filter((entry) => entry.code === "value").map((entry) => entry.value) ?? []) ?? [];
  });
  const total = [...quoteBreakupValues, ...fulfillmentTagValues].reduce((sum, rawValue) => {
    const value = Number(rawValue);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
  return Math.abs(total).toFixed(2);
}

const observabilityEndpoint = "https://analytics-api-pre-prod.aws.ondc.org/v1/api/push-txn-logs";
const piiKeys = new Set([
  "name", "phone", "email", "gps", "building", "locality", "street", "door", "address",
  "beneficiary_name", "settlement_bank_account_no", "settlement_ifsc_code", "bank_name", "branch_name",
]);

function anonymizeForObservability(value: unknown, key = ""): unknown {
  if (piiKeys.has(key.toLowerCase())) {
    if (key.toLowerCase() !== "address" || !value || typeof value !== "object" || Array.isArray(value)) return "REDACTED";
    const source = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(source).map(([childKey, childValue]) =>
      [childKey, ["city", "state", "country", "area_code"].includes(childKey) ? childValue : "REDACTED"]));
  }
  if (Array.isArray(value)) return value.map((item) => anonymizeForObservability(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) =>
      [childKey, anonymizeForObservability(childValue, childKey)]));
  }
  return value;
}

async function pushObservabilityLog(env: Env, type: string, data: unknown) {
  if (!env.N_O_Token) return;
  try {
    const response = await fetch(observabilityEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.N_O_Token}` },
      body: JSON.stringify({ type, data: anonymizeForObservability(data) }),
    });
    const responseText = await response.text();
    if (!response.ok) console.error("ONDC observability submission rejected", { type, status: response.status, response: responseText });
    else console.log("ONDC observability submission accepted", { type, status: response.status, response: responseText });
  } catch (error) {
    console.error("ONDC observability submission failed", { type, error: error instanceof Error ? error.message : "unknown error" });
  }
}

function isExistingWorkbenchAuthorized(request: Request, env: Env) {
  const suppliedToken = request.headers.get("x-ondc-admin-token");
  return Boolean(suppliedToken && env.ONDC_WORKBENCH_TOKEN && suppliedToken === env.ONDC_WORKBENCH_TOKEN);
}

function ondcAuthorization(body: string, env: Env) {
  if (!env.ONDC_SIGNING_PRIVATE_KEY || !env.ONDC_SUBSCRIBER_ID || !env.ONDC_UNIQUE_KEY_ID) {
    throw new Error("ONDC signing configuration is incomplete");
  }
  const privateKey = Buffer.from(env.ONDC_SIGNING_PRIVATE_KEY, "base64");
  const seed = privateKey.length === 64 ? privateKey.subarray(0, 32) : privateKey;
  if (seed.length !== 32) throw new Error("ONDC signing key has an unexpected format");
  const pkcs8Prefix = Buffer.from("302e020100300506032b657004220420", "hex");
  const key = createPrivateKey({ key: Buffer.concat([pkcs8Prefix, seed]), format: "der", type: "pkcs8" });
  const created = Math.floor(Date.now() / 1000);
  const expires = created + 300;
  const digest = Buffer.from(blake2b(Buffer.from(body), undefined, 64)).toString("base64");
  const signingString = `(created): ${created}\n(expires): ${expires}\ndigest: BLAKE-512=${digest}`;
  const signature = sign(null, Buffer.from(signingString), key).toString("base64");
  const keyId = `${env.ONDC_SUBSCRIBER_ID}|${env.ONDC_UNIQUE_KEY_ID}|ed25519`;
  return `Signature keyId="${keyId}",algorithm="ed25519",created="${created}",expires="${expires}",headers="(created) (expires) digest",signature="${signature}"`;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // The ONDC Workbench runner submits signed test actions from its browser
    // origin. Permit only that origin to complete the CORS preflight; every
    // action remains protected by ONDC_WORKBENCH_TOKEN.
    if (request.method === "OPTIONS" && url.pathname.startsWith("/buyer/workbench/")) {
      const origin = request.headers.get("origin");
      if (origin !== "https://workbench.ondc.tech") return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": origin,
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "content-type, x-ondc-admin-token, x-ondc-transaction-id, x-ondc-discovery-mode, x-ondc-workbench-flow, x-ondc-action, x-ondc-update-mode, x-ondc-update-state, x-ondc-order-id",
          "access-control-max-age": "600",
          vary: "Origin",
        },
      });
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    // This reports configuration, not ONDC approval or production readiness.
    if (url.pathname === "/buyer" || url.pathname === "/buyer/health") {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      const configured = Boolean(env.ONDC_SIGNING_PRIVATE_KEY && env.ONDC_ENCRYPTION_PRIVATE_KEY);
      return json({
        status: configured ? "preproduction_configured" : "waiting_for_private_keys",
        environment: "PRE-PRODUCTION",
        subscriber_id: env.ONDC_SUBSCRIBER_ID ?? "not_configured",
        subscriber_url: env.ONDC_SUBSCRIBER_URL ?? `${url.origin}/buyer`,
        unique_key_configured: Boolean(env.ONDC_UNIQUE_KEY_ID),
        callbacks: [...ondcCallbacks],
      });
    }

    if (url.pathname === "/buyer/observability/logs") {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      if (!isExistingWorkbenchAuthorized(request, env)) {
        return json({ error: "not_found" }, 404);
      }
      const transactionId = url.searchParams.get("transaction_id")?.trim();
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 250, 1), 1000);
      const result = transactionId
        ? await env.DB.prepare("SELECT * FROM ondc_protocol_logs WHERE transaction_id = ? ORDER BY id ASC LIMIT ?").bind(transactionId, limit).all()
        : await env.DB.prepare("SELECT * FROM ondc_protocol_logs ORDER BY id DESC LIMIT ?").bind(limit).all();
      return json({ subscriber_id: env.ONDC_SUBSCRIBER_ID, environment: "PRE-PRODUCTION", count: result.results.length, logs: result.results });
    }

    if (url.pathname === "/buyer/search") {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      if (!isExistingWorkbenchAuthorized(request, env)) return json({ error: "not_found" }, 404);
      let requestBody: { query?: string; gps?: string; area_code?: string; city_code?: string };
      try { requestBody = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
      const query = requestBody.query?.trim();
      if (!query) return json({ error: "query_required" }, 400);
      const payload = {
        context: {
          domain: "ONDC:RET10", country: "IND", city: requestBody.city_code ?? "std:040",
          location: { country: { code: "IND" }, city: { code: requestBody.city_code ?? "std:040" } },
          action: "search", version: "1.2.5", core_version: "1.2.5", bap_id: env.ONDC_SUBSCRIBER_ID,
          bap_uri: env.ONDC_SUBSCRIBER_URL, transaction_id: crypto.randomUUID(), message_id: crypto.randomUUID(),
          timestamp: new Date().toISOString(), ttl: "PT30S",
        },
        message: { intent: { fulfillment: { end: { location: { gps: requestBody.gps ?? "17.3950,78.4867", address: { area_code: requestBody.area_code ?? "500068" } } } }, item: { descriptor: { name: query } }, payment: { "@ondc/org/buyer_app_finder_fee_type": "percent", "@ondc/org/buyer_app_finder_fee_amount": "0" } } },
      };
      const rawPayload = JSON.stringify(payload);
      try {
        const gateway = await fetch("https://preprod.gateway.ondc.org/search", {
          method: "POST", headers: { "content-type": "application/json", authorization: ondcAuthorization(rawPayload, env) }, body: rawPayload,
        });
        const responseText = await gateway.text();
        let responsePayload: unknown;
        try { responsePayload = JSON.parse(responseText); } catch { responsePayload = { message: responseText }; }
        const responseWithContext = responsePayload && typeof responsePayload === "object" && "context" in responsePayload
          ? responsePayload
          : { context: payload.context, ...(responsePayload as Record<string, unknown>) };
        ctx.waitUntil(Promise.all([
          writeProtocolLog(env, "OUTBOUND", "https://preprod.gateway.ondc.org/search", rawPayload, payload, gateway.status),
          pushObservabilityLog(env, "search", payload),
          pushObservabilityLog(env, "search_response", responseWithContext),
        ]));
        return new Response(responseText, { status: gateway.status, headers: { "content-type": gateway.headers.get("content-type") ?? "application/json", "cache-control": "no-store" } });
      } catch (error) {
        console.error("ONDC search failed", error);
        return json({ error: "ondc_search_failed", message: error instanceof Error ? error.message : "unknown error" }, 502);
      }
    }

    // Browser-safe bridge used only by the authenticated Workbench runner.
    // A normal HTML form can submit this without exposing signing keys or
    // requiring cross-origin JavaScript access.
    if (url.pathname === "/buyer/workbench/form") {
      if (request.method !== "POST" && request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      const contentType = request.headers.get("content-type") ?? "";
      const form = request.method === "POST" && contentType.includes("form") ? await request.formData() : null;
      const read = (name: string) => form?.get(name) ?? url.searchParams.get(name) ?? null;
      const suppliedToken = String(form?.get("token") ?? "");
      const signedPing = !form && (request.method === "GET" || contentType.includes("text/ping"));
      if (signedPing) {
        const nonce = String(read("nonce") ?? "");
        const expires = Number(read("expires"));
        const suppliedSignature = String(read("sig") ?? "");
        if (!env.ONDC_RUNNER_SIGNING_SECRET || !nonce || !Number.isFinite(expires) || expires < Date.now() || expires > Date.now() + 600_000) {
          return json({ error: "not_found" }, 404);
        }
        const signedParams = new URLSearchParams([...url.searchParams.entries()].filter(([name]) => name !== "sig"));
        signedParams.sort();
        const expectedSignature = createHmac("sha256", env.ONDC_RUNNER_SIGNING_SECRET).update(signedParams.toString()).digest("hex");
        const suppliedBuffer = Buffer.from(suppliedSignature, "hex");
        const expectedBuffer = Buffer.from(expectedSignature, "hex");
        if (suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) return json({ error: "not_found" }, 404);
        await env.DB.prepare("CREATE TABLE IF NOT EXISTS ondc_runner_nonces (nonce TEXT PRIMARY KEY, expires INTEGER NOT NULL)").run();
        const consumed = await env.DB.prepare("INSERT OR IGNORE INTO ondc_runner_nonces (nonce, expires) VALUES (?, ?)").bind(nonce, expires).run();
        if (!consumed.meta.changes) return json({ error: "already_used" }, 409);
      } else if (!env.ONDC_WORKBENCH_TOKEN || suppliedToken !== env.ONDC_WORKBENCH_TOKEN) {
        return json({ error: "not_found" }, 404);
      }
      const target = String(read("target") ?? "");
      const allowedTargets = new Set(["search", "select", "init", "confirm", "cancel", "update", "action"]);
      if (!allowedTargets.has(target)) return json({ error: "unsupported_target" }, 400);
      const headers = new Headers({
        "content-type": "application/json",
        "x-ondc-admin-token": env.ONDC_WORKBENCH_TOKEN ?? "",
      });
      for (const name of [
        "x-ondc-transaction-id", "x-ondc-discovery-mode", "x-ondc-workbench-flow",
        "x-ondc-action", "x-ondc-update-mode", "x-ondc-update-state", "x-ondc-order-id",
      ]) {
        const value = read(name);
        if (value !== null && String(value).trim()) headers.set(name, String(value));
      }
      const body = target === "action" ? String(read("payload") ?? "{}") : "{}";
      return worker.fetch(new Request(new URL(`/buyer/workbench/${target}`, url.origin), {
        method: "POST", headers, body,
      }), env, ctx);
    }

    if (url.pathname === "/buyer/workbench/select") {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      if (!isExistingWorkbenchAuthorized(request, env)) {
        return json({ error: "not_found" }, 404);
      }
      const requestedTransactionId = request.headers.get("x-ondc-transaction-id");
      const transactionId = requestedTransactionId?.trim() || crypto.randomUUID();
      const flow = request.headers.get("x-ondc-workbench-flow") ?? "";
      const buyerDeliveryFlow = flow === "buyer-delivery";
      const multiItemFlow = flow === "rto-part-cancel";
      const fulfillmentId = buyerDeliveryFlow ? "F3" : "F1";
      const workbenchBase = "https://workbench.ondc.tech/api-service/ONDC:RET10/1.2.5/seller";
      const payload = {
        context: {
          domain: "ONDC:RET10", action: "select", timestamp: new Date().toISOString(),
          transaction_id: transactionId, message_id: crypto.randomUUID(),
          bap_id: env.ONDC_SUBSCRIBER_ID, bap_uri: env.ONDC_SUBSCRIBER_URL,
          ttl: "PT30S", bpp_id: "sample-bpp-id", bpp_uri: workbenchBase,
          country: "IND", city: "std:011", core_version: "1.2.5",
        },
        message: {
          order: {
            provider: { id: "P1", locations: [{ id: "L1" }] },
            items: [
              { id: "I1", quantity: { count: 1 }, location_id: "L1" },
              ...(multiItemFlow ? [{ id: "I2", quantity: { count: 1 }, location_id: "L1" }] : []),
            ],
            fulfillments: [{
              id: fulfillmentId,
              end: { location: { gps: "19.129076,72.825803", address: { area_code: "400053" } } },
              type: buyerDeliveryFlow ? "Buyer-Delivery" : "Delivery",
              "@ondc/org/provider_name": "Sample Provider",
              "@ondc/org/category": "Standard Delivery",
            }],
          },
        },
      };
      const rawPayload = JSON.stringify(payload);
      try {
        const response = await fetch(`${workbenchBase}/select`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: ondcAuthorization(rawPayload, env) },
          body: rawPayload,
        });
        const responseText = await response.text();
        let responsePayload: unknown;
        try { responsePayload = JSON.parse(responseText); } catch { responsePayload = { message: responseText }; }
        ctx.waitUntil(Promise.all([
          writeProtocolLog(env, "OUTBOUND", `${workbenchBase}/select`, rawPayload, payload, response.status),
          pushObservabilityLog(env, "select", payload),
          pushObservabilityLog(env, "select_response", { context: payload.context, response: responsePayload }),
        ]));
        return new Response(responseText, {
          status: response.status,
          headers: { "content-type": response.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
        });
      } catch (error) {
        console.error("ONDC Workbench select failed", error);
        return json({ error: "workbench_select_failed", message: error instanceof Error ? error.message : "unknown error" }, 502);
      }
    }

    // Protected protocol test relay. This lets the integration runner submit
    // exact ONDC Workbench scenario payloads while keeping signing keys server-side.
    if (url.pathname === "/buyer/workbench/action") {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      if (!isExistingWorkbenchAuthorized(request, env)) {
        return json({ error: "not_found" }, 404);
      }
      const action = request.headers.get("x-ondc-action")?.trim() ?? "";
      if (!workbenchActions.has(action)) return json({ error: "unsupported_action" }, 400);
      let payload: Record<string, unknown>;
      try { payload = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
      if (!payload || typeof payload !== "object") return json({ error: "invalid_payload" }, 400);
      if (action === "issue") payload = normalizeIssueResolutionRefs(payload);
      const rawPayload = JSON.stringify(payload);
      const workbenchBase = "https://workbench.ondc.tech/api-service/ONDC:RET10/1.2.5/seller";
      try {
        const response = await fetch(`${workbenchBase}/${action}`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: ondcAuthorization(rawPayload, env) },
          body: rawPayload,
        });
        const responseText = await response.text();
        let responsePayload: unknown;
        try { responsePayload = JSON.parse(responseText); } catch { responsePayload = { message: responseText }; }
        const responseWithContext = responsePayload && typeof responsePayload === "object" && "context" in responsePayload
          ? responsePayload
          : { context: (payload as { context?: unknown }).context, ...(responsePayload as Record<string, unknown>) };
        ctx.waitUntil(Promise.all([
          writeProtocolLog(env, "OUTBOUND", `${workbenchBase}/${action}`, rawPayload, payload, response.status),
          pushObservabilityLog(env, action, payload),
          pushObservabilityLog(env, `${action}_response`, responseWithContext),
        ]));
        return new Response(responseText, {
          status: response.status,
          headers: { "content-type": response.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
        });
      } catch (error) {
        console.error(`ONDC Workbench ${action} relay failed`, error);
        return json({ error: "workbench_action_failed", message: error instanceof Error ? error.message : "unknown error" }, 502);
      }
    }

    if (url.pathname === "/buyer/workbench/init" || url.pathname === "/buyer/workbench/confirm") {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      if (!isExistingWorkbenchAuthorized(request, env)) {
        return json({ error: "not_found" }, 404);
      }
      const transactionId = request.headers.get("x-ondc-transaction-id")?.trim();
      if (!transactionId) return json({ error: "transaction_id_required" }, 400);
      const action = url.pathname.endsWith("/confirm") ? "confirm" : "init";
      const flow = request.headers.get("x-ondc-workbench-flow") ?? "";
      const deliveryFlow = flow === "delivery" || flow === "rto-part-cancel";
      const buyerDeliveryFlow = flow === "buyer-delivery";
      const fulfillmentId = deliveryFlow ? "F1" : "F3";
      const now = new Date().toISOString();
      const workbenchBase = "https://workbench.ondc.tech/api-service/ONDC:RET10/1.2.5/seller";
      const sourceOrder = await latestCallbackOrder(env, transactionId, action === "confirm" ? "on_init" : "on_select");
      const confirmedOrderId = typeof sourceOrder?.id === "string" && sourceOrder.id.trim()
        ? sourceOrder.id : deliveryFlow ? "501218" : "866433";
      const selectedOrder = action === "confirm"
        ? await latestCallbackOrder(env, transactionId, "on_select")
        : sourceOrder;
      const billing = {
        address: { name: "Door no. or building name", building: "New_Building", locality: "6th Cross Road", city: "Bengaluru", state: "Karnataka", country: "IND", area_code: "560027" },
        phone: "9399788618", name: "John Doe", email: "nobody@nomail.com", created_at: now, updated_at: now,
      };
      const selectedFulfillment = selectedOrder?.fulfillments?.find((candidate) => candidate.id === fulfillmentId)
        ?? selectedOrder?.fulfillments?.[0] ?? {};
      const sourceFulfillment = sourceOrder?.fulfillments?.find((candidate) => candidate.id === fulfillmentId)
        ?? sourceOrder?.fulfillments?.[0] ?? {};
      const delivery = {
        ...(buyerDeliveryFlow ? {} : selectedFulfillment),
        ...(buyerDeliveryFlow ? {} : sourceFulfillment),
        id: sourceFulfillment.id ?? fulfillmentId,
        type: sourceFulfillment.type ?? (deliveryFlow ? "Delivery" : "Buyer-Delivery"),
        end: {
          ...((sourceFulfillment.end as Record<string, unknown> | undefined) ?? {}),
          contact: { email: "nobody@nomail.com", phone: "9898989898" },
          ...(action === "confirm" ? { person: { name: "mock-person" } } : {}),
          location: { gps: "19.129076,72.825803", address: { building: "mock-building", city: "mock-city", state: "mock-state", country: "IND", area_code: "400053", locality: "mock-locality", name: "mock-house-name" } },
        },
        ...(action === "confirm" ? { tracking: true, "@ondc/org/category": deliveryFlow ? "Standard Delivery" : "", "@ondc/org/TAT": "P2D" } : {}),
        ...(action === "confirm" && buyerDeliveryFlow ? {
          tags: [{
            code: "order_details",
            list: [
              { code: "id", value: confirmedOrderId },
              { code: "weight_unit", value: "kilogram" },
              { code: "weight_value", value: "3.0" },
              { code: "dim_unit", value: "centimeter" },
              { code: "length", value: "1.0" },
              { code: "breadth", value: "1.0" },
              { code: "height", value: "1.0" },
            ],
          }],
        } : {}),
      };
      const order: Record<string, unknown> = {
        provider: sourceOrder?.provider ?? { id: "P1", locations: [{ id: "L1" }] },
        items: protocolItems(sourceOrder?.items, String(delivery.id)),
        billing,
        fulfillments: [delivery],
        payment: {
          type: "ON-ORDER", collected_by: "BAP",
          "@ondc/org/buyer_app_finder_fee_type": "percent",
          "@ondc/org/buyer_app_finder_fee_amount": "3.0",
          "@ondc/org/settlement_details": [{
            settlement_counterparty: "seller-app", settlement_phase: "sale-amount",
            settlement_type: "upi", upi_address: "merchant@upi",
            beneficiary_name: "xxxx", settlement_bank_account_no: "xxxx",
            settlement_ifsc_code: "xxxx", bank_name: "xxxx", branch_name: "xxxx",
          }],
        },
      };
      if (action === "confirm") {
        Object.assign(order, {
          id: confirmedOrderId, state: "Created",
          payment: {
            params: {
              amount: String((sourceOrder?.quote?.price as { value?: unknown } | undefined)?.value ?? "200.00"),
              currency: "INR", transaction_id: "mock_payment_id_123",
            },
            status: "PAID", type: "ON-ORDER", collected_by: "BAP",
            "@ondc/org/buyer_app_finder_fee_type": "percent", "@ondc/org/buyer_app_finder_fee_amount": "3.0",
            "@ondc/org/settlement_basis": "delivery", "@ondc/org/settlement_window": "P1D", "@ondc/org/withholding_amount": "00.00",
            "@ondc/org/settlement_details": [{ settlement_counterparty: "seller-app", settlement_phase: "sale-amount", settlement_type: "upi", upi_address: "merchant@upi", beneficiary_name: "xxxx", settlement_bank_account_no: "xxxx", settlement_ifsc_code: "xxxx", bank_name: "xxxx", branch_name: "xxxx" }],
          },
          quote: sourceOrder?.quote ?? {
            breakup: [
              { "@ondc/org/item_id": "I1", "@ondc/org/item_quantity": { count: 1 }, title: "Plain Atta", "@ondc/org/title_type": "item", price: { currency: "INR", value: "200.00" }, item: { price: { currency: "INR", value: "200.00" } } },
              { "@ondc/org/item_id": fulfillmentId, title: "Delivery charges", "@ondc/org/title_type": "delivery", price: { currency: "INR", value: "00.00" } },
              { "@ondc/org/item_id": fulfillmentId, title: "Convenience Fee", "@ondc/org/title_type": "misc", price: { currency: "INR", value: "00.00" } },
            ],
            price: { currency: "INR", value: "200.00" }, ttl: "P1D",
          },
          tags: [
            ...tagsByCode(sourceOrder?.tags, "bpp_terms"),
            { code: "bap_terms", list: [{ code: "accept_bpp_terms", value: "Y" }, { code: "static_terms", value: "https://github.com/ONDC-Official/NP-Static-Terms/buyerNP_BNP/1.0/tc.pdf" }, { code: "tax_number", value: "00ABCCH7409R1ZZ" }] },
          ],
          created_at: now, updated_at: now,
        });
      }
      const payload = {
        context: {
          domain: "ONDC:RET10", action, timestamp: now, transaction_id: transactionId, message_id: crypto.randomUUID(),
          bap_id: env.ONDC_SUBSCRIBER_ID, bap_uri: env.ONDC_SUBSCRIBER_URL, ttl: "PT30S",
          bpp_id: "sample-bpp-id", bpp_uri: workbenchBase, country: "IND", city: "std:011", core_version: "1.2.5",
        },
        message: { order },
      };
      const rawPayload = JSON.stringify(payload);
      try {
        const response = await fetch(`${workbenchBase}/${action}`, {
          method: "POST", headers: { "content-type": "application/json", authorization: ondcAuthorization(rawPayload, env) }, body: rawPayload,
        });
        const responseText = await response.text();
        let responsePayload: unknown;
        try { responsePayload = JSON.parse(responseText); } catch { responsePayload = { message: responseText }; }
        ctx.waitUntil(Promise.all([
          writeProtocolLog(env, "OUTBOUND", `${workbenchBase}/${action}`, rawPayload, payload, response.status),
          pushObservabilityLog(env, action, payload),
          pushObservabilityLog(env, `${action}_response`, { context: payload.context, response: responsePayload }),
        ]));
        return new Response(responseText, { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/json", "cache-control": "no-store" } });
      } catch (error) {
        console.error(`ONDC Workbench ${action} failed`, error);
        return json({ error: `workbench_${action}_failed`, message: error instanceof Error ? error.message : "unknown error" }, 502);
      }
    }

    if (url.pathname === "/buyer/workbench/track") {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      if (!isExistingWorkbenchAuthorized(request, env)) return json({ error: "not_found" }, 404);
      const transactionId = request.headers.get("x-ondc-transaction-id")?.trim();
      if (!transactionId) return json({ error: "transaction_id_required" }, 400);
      const workbenchBase = "https://workbench.ondc.tech/api-service/ONDC:RET10/1.2.5/seller";
      const payload = {
        context: {
          domain: "ONDC:RET10", action: "track", timestamp: new Date().toISOString(), transaction_id: transactionId,
          message_id: crypto.randomUUID(), bap_id: env.ONDC_SUBSCRIBER_ID, bap_uri: env.ONDC_SUBSCRIBER_URL,
          ttl: "PT30S", bpp_id: "sample-bpp-id", bpp_uri: workbenchBase,
          country: "IND", city: "std:011", core_version: "1.2.5",
        },
        message: { order_id: "501218" },
      };
      const rawPayload = JSON.stringify(payload);
      try {
        const response = await fetch(`${workbenchBase}/track`, {
          method: "POST", headers: { "content-type": "application/json", authorization: ondcAuthorization(rawPayload, env) }, body: rawPayload,
        });
        const responseText = await response.text();
        return new Response(responseText, { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/json", "cache-control": "no-store" } });
      } catch (error) {
        console.error("ONDC Workbench track failed", error);
        return json({ error: "workbench_track_failed", message: error instanceof Error ? error.message : "unknown error" }, 502);
      }
    }

    if (url.pathname === "/buyer/workbench/cancel") {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      if (!isExistingWorkbenchAuthorized(request, env)) return json({ error: "not_found" }, 404);
      const transactionId = request.headers.get("x-ondc-transaction-id")?.trim();
      if (!transactionId) return json({ error: "transaction_id_required" }, 400);
      const orderId = request.headers.get("x-ondc-order-id")?.trim() || "501218";
      const cancellationReasonId = request.headers.get("x-ondc-cancellation-reason")?.trim() || "001";
      const forceHeader = request.headers.get("x-ondc-force-cancel");
      const workbenchBase = "https://workbench.ondc.tech/api-service/ONDC:RET10/1.2.5/seller";
      const payload = {
        context: {
          domain: "ONDC:RET10", action: "cancel", timestamp: new Date().toISOString(), transaction_id: transactionId,
          message_id: crypto.randomUUID(), bap_id: env.ONDC_SUBSCRIBER_ID, bap_uri: env.ONDC_SUBSCRIBER_URL,
          ttl: "PT30S", bpp_id: "sample-bpp-id", bpp_uri: workbenchBase,
          country: "IND", city: "std:011", core_version: "1.2.5",
        },
        message: {
          order_id: orderId, cancellation_reason_id: cancellationReasonId,
          descriptor: {
            name: "fulfillment", short_desc: "F1",
            tags: [{ code: "params", list: [
              { code: "force", value: forceHeader === "true" ? "yes" : "no" },
              { code: "ttl_response", value: "PT10S" },
            ] }],
          },
        },
      };
      const rawPayload = JSON.stringify(payload);
      try {
        const response = await fetch(`${workbenchBase}/cancel`, {
          method: "POST", headers: { "content-type": "application/json", authorization: ondcAuthorization(rawPayload, env) }, body: rawPayload,
        });
        const responseText = await response.text();
        let responsePayload: unknown;
        try { responsePayload = JSON.parse(responseText); } catch { responsePayload = { message: responseText }; }
        ctx.waitUntil(Promise.all([
          writeProtocolLog(env, "OUTBOUND", `${workbenchBase}/cancel`, rawPayload, payload, response.status),
          pushObservabilityLog(env, "cancel", payload),
          pushObservabilityLog(env, "cancel_response", { context: payload.context, response: responsePayload }),
        ]));
        return new Response(responseText, { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/json", "cache-control": "no-store" } });
      } catch (error) {
        console.error("ONDC Workbench cancel failed", error);
        return json({ error: "workbench_cancel_failed", message: error instanceof Error ? error.message : "unknown error" }, 502);
      }
    }

    if (url.pathname === "/buyer/workbench/search") {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      const suppliedToken = request.headers.get("x-ondc-admin-token");
      if (!env.ONDC_WORKBENCH_TOKEN || suppliedToken !== env.ONDC_WORKBENCH_TOKEN) return json({ error: "not_found" }, 404);
      const transactionId = request.headers.get("x-ondc-transaction-id")?.trim();
      if (!transactionId) return json({ error: "transaction_id_required" }, 400);
      const mode = request.headers.get("x-ondc-discovery-mode") || "full";
      const now = new Date();
      const workbenchBase = "https://workbench.ondc.tech/api-service/ONDC:RET10/1.2.5/seller";
      const tags = mode.startsWith("incremental-")
        ? [{ code: "catalog_inc", list: [{ code: "mode", value: mode.endsWith("stop") ? "stop" : "start" }] }]
        : [
            { code: "bap_terms", list: [
              { code: "static_terms", value: "https://github.com/ONDC-Official/NP-Static-Terms/buyerNP_BNP/0.9/tc.pdf" },
              { code: "static_terms_new", value: "https://github.com/ONDC-Official/NP-Static-Terms/buyerNP_BNP/1.0/tc.pdf" },
              { code: "effective_date", value: new Date(now.getTime() + 10 * 86400000).toISOString() },
            ] },
            { code: "bap_features", list: [{ code: "001", value: "yes" }, { code: "001", value: "yes" }] },
          ];
      const payload = {
        context: {
          domain: "ONDC:RET10", action: "search", timestamp: now.toISOString(), transaction_id: transactionId,
          message_id: crypto.randomUUID(), bap_id: env.ONDC_SUBSCRIBER_ID, bap_uri: env.ONDC_SUBSCRIBER_URL,
          ttl: "PT30S", country: "IND", city: mode.startsWith("incremental-") ? "*" : "std:080", core_version: "1.2.5",
        },
        message: { intent: { payment: { "@ondc/org/buyer_app_finder_fee_type": "percent", "@ondc/org/buyer_app_finder_fee_amount": "3" }, tags } },
      };
      const rawPayload = JSON.stringify(payload);
      try {
        const response = await fetch(`${workbenchBase}/search`, {
          method: "POST", headers: { "content-type": "application/json", authorization: ondcAuthorization(rawPayload, env) }, body: rawPayload,
        });
        const responseText = await response.text();
        return new Response(responseText, { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/json", "cache-control": "no-store" } });
      } catch (error) {
        console.error("ONDC Workbench search failed", error);
        return json({ error: "workbench_search_failed", message: error instanceof Error ? error.message : "unknown error" }, 502);
      }
    }

    if (url.pathname === "/buyer/workbench/catalog-rejection") {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      const suppliedToken = request.headers.get("x-ondc-admin-token");
      if (!env.ONDC_WORKBENCH_TOKEN || suppliedToken !== env.ONDC_WORKBENCH_TOKEN) return json({ error: "not_found" }, 404);
      const transactionId = request.headers.get("x-ondc-transaction-id")?.trim();
      if (!transactionId) return json({ error: "transaction_id_required" }, 400);
      const workbenchBase = "https://workbench.ondc.tech/api-service/ONDC:RET10/1.2.5/seller";
      const payload = {
        context: {
          domain: "ONDC:RET10", action: "catalog_rejection", timestamp: new Date().toISOString(), transaction_id: transactionId,
          message_id: crypto.randomUUID(), bap_id: env.ONDC_SUBSCRIBER_ID, bap_uri: env.ONDC_SUBSCRIBER_URL,
          ttl: "PT30S", bpp_id: "sample-bpp-id", bpp_uri: workbenchBase,
          country: "IND", city: "std:011", core_version: "1.2.5",
        },
        message: { errors: [
          { type: "ITEM-ERROR", code: "91001", message: "Item price > MRP", path: "sessionData.on_search_items[?(@.id=='I1')].price.value" },
          { type: "ITEM-ERROR", code: "91001", message: "Item price > MRP", path: "sessionData.on_search_items[?(@.id=='I2')].price.value" },
        ] },
      };
      const rawPayload = JSON.stringify(payload);
      try {
        const response = await fetch(`${workbenchBase}/catalog_rejection`, {
          method: "POST", headers: { "content-type": "application/json", authorization: ondcAuthorization(rawPayload, env) }, body: rawPayload,
        });
        const responseText = await response.text();
        return new Response(responseText, { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/json", "cache-control": "no-store" } });
      } catch (error) {
        console.error("ONDC Workbench catalog rejection failed", error);
        return json({ error: "workbench_catalog_rejection_failed", message: error instanceof Error ? error.message : "unknown error" }, 502);
      }
    }

    if (url.pathname === "/buyer/workbench/update") {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      const suppliedToken = request.headers.get("x-ondc-admin-token");
      if (!env.ONDC_WORKBENCH_TOKEN || suppliedToken !== env.ONDC_WORKBENCH_TOKEN) return json({ error: "not_found" }, 404);
      const transactionId = request.headers.get("x-ondc-transaction-id")?.trim();
      if (!transactionId) return json({ error: "transaction_id_required" }, 400);
      const updateMode = request.headers.get("x-ondc-update-mode") ?? "return-request";
      const settlementCancel = updateMode === "settlement-cancel";
      const buyerInstructions = updateMode === "buyer-instructions";
      const delivered = request.headers.get("x-ondc-update-state") === "Order-delivered";
      const buyerDeliveryFlow = request.headers.get("x-ondc-workbench-flow") === "buyer-delivery";
      const priorOrder = settlementCancel
        ? await latestSettlementCallbackOrder(env, transactionId)
        : await latestCallbackOrder(env, transactionId, "on_confirm");
      const orderId = request.headers.get("x-ondc-order-id")?.trim()
        || priorOrder?.id || (buyerDeliveryFlow ? "866433" : "501218");
      const fulfillmentId = buyerDeliveryFlow ? "F3" : "F1";
      const state = delivered ? "Order-delivered" : "Order-picked-up";
      const now = new Date().toISOString();
      const workbenchBase = "https://workbench.ondc.tech/api-service/ONDC:RET10/1.2.5/seller";
      const returnTags: Array<Record<string, unknown>> = [{
        code: "return_request",
        list: [
          { code: "id", value: crypto.randomUUID() },
          { code: "item_id", value: "I1" },
          { code: "item_quantity", value: "1" },
          { code: "reason_id", value: "001" },
          { code: "reason_desc", value: "the product is damaged" },
          { code: "images", value: "https://reference-buyer-app-assets.s3-ap-south-1.amazonaws.com/public-assets/2025-02-10-293522/9d13d0d3-6b21-405e-bfc0-b014485adaa2.png" },
          { code: "ttl_approval", value: "PT24H" },
          { code: "ttl_reverseqc", value: "P3D" },
        ],
      }];
      const buyerDeliveryTags: Array<Record<string, unknown>> = [
        { code: "update_state", list: [{ code: "state", value: state }] },
        { code: "update_fulfillment_time", list: [
          { code: "state", value: state },
          { code: "timestamp", value: now },
        ] },
        ...(delivered ? [] : [
          { code: "update_agent_details", list: [
            { code: "name", value: "agent_name" },
            { code: "phone", value: "9886098860" },
            { code: "provider_id", value: "P1" },
          ] },
          { code: "update_label", list: [
            { code: "type", value: "pdf" },
            { code: "url", value: "https://ondc.zeroprofit.food/buyer/shipping-label.pdf" },
            { code: "shipping", value: "yes" },
          ] },
          { code: "update_verification", list: [
            { code: "type", value: "OTP" },
            { code: "value", value: "1234" },
          ] },
          { code: "update_fulfillment_delay", list: [
            { code: "state", value: state },
            { code: "reason_id", value: "001" },
            { code: "start_time", value: now },
            { code: "end_time", value: new Date(Date.now() + 15 * 60 * 1000).toISOString() },
            { code: "attempt", value: "no" },
          ] },
          { code: "bnp_diff_weight", list: [{ code: "unit", value: "kilogram" }, { code: "value", value: "1.5" }] },
          { code: "bnp_diff_length", list: [{ code: "unit", value: "centimeter" }, { code: "value", value: "1.5" }] },
          { code: "bnp_diff_breadth", list: [{ code: "unit", value: "centimeter" }, { code: "value", value: "1.5" }] },
          { code: "bnp_diff_height", list: [{ code: "unit", value: "centimeter" }, { code: "value", value: "1.5" }] },
        ]),
      ];
      const settlementFulfillment = priorOrder?.fulfillments?.find((fulfillment) =>
        ["RTO", "Return"].includes(String(fulfillment.type)))
        ?? priorOrder?.fulfillments?.find((fulfillment) => fulfillment.type === "Cancel")
        ?? priorOrder?.fulfillments?.[0];
      const message = settlementCancel ? {
        update_target: "payment",
        order: {
          id: orderId,
          fulfillments: settlementFulfillment ? [{
            id: settlementFulfillment.id,
            type: settlementFulfillment.type === "RTO" ? "Return" : settlementFulfillment.type,
          }] : [],
          payment: { "@ondc/org/settlement_details": [{
            settlement_counterparty: "buyer", settlement_phase: "refund",
            settlement_type: "netbanking", settlement_amount: quoteTrailTotal(priorOrder),
            settlement_timestamp: now,
          }] },
        },
      } : buyerInstructions ? {
        update_target: "fulfillment",
        order: {
          id: orderId,
          fulfillments: [{
            id: fulfillmentId,
            type: buyerDeliveryFlow ? "Buyer-Delivery" : "Delivery",
            instructions: { code: "1", short_desc: "Leave the order at the door" },
          }],
        },
      } : buyerDeliveryFlow ? {
        update_target: "fulfillment",
        order: {
          id: orderId,
          fulfillments: [{
            id: fulfillmentId,
            tags: buyerDeliveryTags,
          }],
        },
      } : {
        update_target: "item",
        order: {
          id: orderId,
          fulfillments: [{ type: "Return", tags: returnTags }],
        },
      };
      const payload = {
        context: {
          domain: "ONDC:RET10", action: "update", timestamp: now, transaction_id: transactionId, message_id: crypto.randomUUID(),
          bap_id: env.ONDC_SUBSCRIBER_ID, bap_uri: env.ONDC_SUBSCRIBER_URL, ttl: "PT30S",
          bpp_id: "sample-bpp-id", bpp_uri: workbenchBase, country: "IND", city: "std:011", core_version: "1.2.5",
        },
        message,
      };
      const rawPayload = JSON.stringify(payload);
      try {
        const response = await fetch(`${workbenchBase}/update`, {
          method: "POST", headers: { "content-type": "application/json", authorization: ondcAuthorization(rawPayload, env) }, body: rawPayload,
        });
        const responseText = await response.text();
        return new Response(responseText, { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/json", "cache-control": "no-store" } });
      } catch (error) {
        console.error("ONDC Workbench update failed", error);
        return json({ error: "workbench_update_failed", message: error instanceof Error ? error.message : "unknown error" }, 502);
      }
    }

    if (ondcCallbacks.has(url.pathname)) {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      const contentType = request.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) return json({ error: "json_required" }, 415);
      let callbackContext: unknown;
      try {
        const rawPayload = await request.text();
        const payload = JSON.parse(rawPayload) as { context?: { action?: unknown; transaction_id?: unknown; message_id?: unknown } };
        callbackContext = payload.context;
        const action = typeof payload === "object" && payload !== null && "context" in payload
          ? payload.context?.action : undefined;
        console.log("ONDC callback received", { path: url.pathname, action });
        if (typeof action === "string") {
          // ACK callbacks immediately; Workbench treats a slow persistence write as
          // a NACK even when the payload is valid. Test actions wait for their paired
          // callback before reading this stored state.
          ctx.waitUntil(Promise.all([
            env.DB.prepare("INSERT INTO ondc_callbacks (action, transaction_id, message_id, received_at, payload) VALUES (?, ?, ?, ?, ?)")
              .bind(action, typeof payload.context?.transaction_id === "string" ? payload.context.transaction_id : null, typeof payload.context?.message_id === "string" ? payload.context.message_id : null, Date.now(), rawPayload).run(),
            writeProtocolLog(env, "INBOUND", url.pathname, rawPayload, payload, 200),
          ]));
          const ack = { context: payload.context, message: { ack: { status: "ACK" } } };
          ctx.waitUntil(Promise.all([
            pushObservabilityLog(env, action, payload),
            pushObservabilityLog(env, `${action}_response`, ack),
          ]));
        }
      } catch {
        return json({ error: "invalid_json" }, 400);
      }
      return json({ context: callbackContext, message: { ack: { status: "ACK" } } });
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
