/**
 * Local webhook echo receiver for acceptance and manual checks
 * (docs/drafts/p10-plan.md §4.3). Listens on 127.0.0.1:4010, verifies
 * X-Tessera-Signature when --secret is set, logs each delivery, and
 * answers with --status (default 200).
 *
 * Usage:
 *   npx tsx scripts/webhook-echo.ts --secret <hex>
 *   npx tsx scripts/webhook-echo.ts --secret <hex> --status 500
 *   npx tsx scripts/webhook-echo.ts --secret <hex> --status 410
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";

const HOST = "127.0.0.1";
const PORT = 4010;

type Args = { secret?: string; status: number };

function parseArgs(argv: string[]): Args {
  const args: Args = { status: 200 };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--secret" || token === "--status") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${token} needs a value`);
      }
      i += 1;
      if (token === "--secret") {
        args.secret = value;
        continue;
      }
      const status = Number(value);
      if (!Number.isInteger(status) || status < 100 || status > 599) {
        throw new Error(`--status must be an HTTP status code, got ${value}`);
      }
      args.status = status;
      continue;
    }
    throw new Error(`Unknown argument ${token}`);
  }
  return args;
}

function header(req: IncomingMessage, name: string): string {
  const raw = req.headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0] ?? "";
  return raw ?? "";
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function expectedSignature(secret: string, timestamp: string, body: string): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
  return `sha256=${digest}`;
}

function signaturesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

async function handle(req: IncomingMessage, res: ServerResponse, args: Args): Promise<void> {
  const bodyBuf = await readBody(req);
  const body = bodyBuf.toString("utf8");
  const event = header(req, "x-tessera-event");
  const delivery = header(req, "x-tessera-delivery");
  const timestamp = header(req, "x-tessera-timestamp");
  const signature = header(req, "x-tessera-signature");

  let sigOk: boolean | "skipped" = "skipped";
  if (args.secret !== undefined) {
    if (!timestamp || !signature) {
      sigOk = false;
    } else {
      const expected = expectedSignature(args.secret, timestamp, body);
      sigOk = signaturesMatch(signature, expected);
    }
  }

  let eventFromBody = "";
  try {
    const parsed = JSON.parse(body) as { event?: unknown };
    if (typeof parsed.event === "string") eventFromBody = parsed.event;
  } catch {
    // keep empty
  }

  const line = [
    new Date().toISOString(),
    `${req.method ?? "?"} ${req.url ?? "/"}`,
    `event=${event || eventFromBody || "?"}`,
    `delivery=${delivery || "?"}`,
    `sig=${sigOk === "skipped" ? "skipped" : sigOk ? "ok" : "BAD"}`,
    `bytes=${bodyBuf.length}`,
    `→ ${args.status}`,
  ].join(" ");
  console.log(line);
  if (body.length > 0 && body.length < 4_000) {
    console.log(body);
  }

  res.writeHead(args.status, { "content-type": "text/plain; charset=utf-8" });
  res.end(args.status >= 200 && args.status < 300 ? "ok\n" : `echo ${args.status}\n`);
}

function main(): number {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : "Invalid arguments");
    console.error("Usage: npx tsx scripts/webhook-echo.ts [--secret <hex>] [--status <code>]");
    return 1;
  }

  const server = createServer((req, res) => {
    void handle(req, res, args).catch((err) => {
      console.error("handler error", err);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end("echo error\n");
      }
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(
      `webhook-echo listening on http://${HOST}:${PORT}` +
        (args.secret ? " (signature check on)" : " (signature check off)") +
        ` status=${args.status}`,
    );
  });

  server.on("error", (err) => {
    console.error(err);
    process.exit(1);
  });

  return 0;
}

process.exitCode = main();
