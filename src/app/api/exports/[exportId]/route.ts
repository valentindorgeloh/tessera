import { type NextRequest } from "next/server";
import { isSameOriginRequest } from "@/app/api/request-guards";
import { getExport, isTrackerError, readTessera } from "@/lib/tessera/server";
import fs from "node:fs";
import path from "node:path";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function refuse(): Response {
  return Response.json({ code: "FORBIDDEN", message: "Cross-origin requests are refused" }, { status: 403, headers: NO_STORE });
}

/** Download an export file. Same-origin only. 404 when the job or the file is missing. */
export async function GET(request: NextRequest, context: { params: Promise<{ exportId: string }> }): Promise<Response> {
  if (!isSameOriginRequest(request.headers)) return refuse();
  const { exportId } = await context.params;
  try {
    const job = await readTessera((ctx) => getExport(ctx, exportId));
    if (job.status !== "done" || job.file_path === null || !fs.existsSync(job.file_path)) {
      return Response.json({ code: "NOT_FOUND", message: "Export file not found" }, { status: 404, headers: NO_STORE });
    }
    const body = fs.readFileSync(job.file_path);
    const name = path.basename(job.file_path);
    const type = job.format === "csv" ? "text/csv; charset=utf-8" : "application/json";
    return new Response(body, {
      headers: {
        ...NO_STORE,
        "Content-Type": type,
        "Content-Disposition": `attachment; filename="${name.replace(/"/g, "")}"`,
      },
    });
  } catch (err) {
    if (isTrackerError(err) && err.code === "NOT_FOUND") {
      return Response.json({ code: "NOT_FOUND", message: err.message }, { status: 404, headers: NO_STORE });
    }
    throw err;
  }
}
