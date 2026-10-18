import { createMcpHandler } from "mcp-handler";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/tessera/server";
import { createMcpActorResolver, registerTesseraTools, type McpActorResolver } from "@/lib/tessera/tools/mcp";

const instructions =
  "Tessera tools (tessera_*) track projects and work items: start with tessera_list_projects, pass ids (fields ending in _id) rather than keys, call tessera_describe_filters before filtering lists, and pass confirm: true to destructive tools.";

let tesseraActorResolver: McpActorResolver | null = null;

/** One resolver per process, so a reconnecting client only touches its mcp:<name> actor row. */
function resolveTesseraActor(): McpActorResolver {
  tesseraActorResolver ??= createMcpActorResolver(getDb());
  return tesseraActorResolver;
}

const handler = createMcpHandler(
  (server) => {
    registerTesseraTools(server, {
      handles: getDb(),
      actorResolver: (clientInfo) => resolveTesseraActor()(clientInfo),
      // Route handlers may revalidate; the open page re-renders on its next visit.
      afterWrite: () => revalidatePath("/", "layout"),
    });
  },
  {
    serverInfo: { name: "tessera", version: "1.0.0" },
    instructions,
  },
);

export { handler as GET, handler as POST, handler as DELETE };
