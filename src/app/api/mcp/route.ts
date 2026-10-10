import {createMcpHandler} from "mcp-handler";
import {revalidatePath} from "next/cache";
import {z} from "zod";
import {getDb} from "@/lib/tessera/server";
import {
  createMcpActorResolver,
  registerTesseraTools,
  type McpActorResolver,
} from "@/lib/tessera/tools/mcp";
import {
  createNode,
  deleteNode,
  editNodeContent,
  getNode,
  listNodes,
  moveNode,
  searchWorkspace,
  updateNode,
} from "../../../lib/workspace";

const instructions = [
  "Handbook is a local workspace of collections and pages.",
  "Search before you read. search_items returns titles and summaries; call get_item only for the page you need.",
  "Prefer edit_item_content when changing a sentence, so the rest of the page stays put.",
  "update_item replaces the whole body. create_item adds a page or a collection. move_item changes which collection a page is in.",
  "Tessera tools (tessera_*) track projects and work items: start with tessera_list_projects, pass ids (fields ending in _id) rather than keys, call tessera_describe_filters before filtering lists, and pass confirm: true to destructive tools.",
].join(" ");

let tesseraActorResolver: McpActorResolver | null = null;

/** One resolver per process, so a reconnecting client only touches its mcp:<name> actor row. */
function resolveTesseraActor(): McpActorResolver {
  tesseraActorResolver ??= createMcpActorResolver(getDb());
  return tesseraActorResolver;
}

function text(value: unknown) {
  return {
    content: [{type: "text" as const, text: JSON.stringify(value, null, 2)}],
  };
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return {
    isError: true as const,
    content: [{type: "text" as const, text: message}],
  };
}

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "list_items",
      {
        title: "List pages",
        description:
          "List collections and pages. Pass a parent id to list one collection's children. Omit it to list the whole workspace. Results include id, title, kind, summary, and parent. Summaries are the first thing to scan.",
        inputSchema: z.object({
          parent: z
            .string()
            .optional()
            .describe("Collection id. Omit for the whole workspace."),
        }),
      },
      async ({parent}) => {
        const nodes = await listNodes();
        const listed = nodes
          .filter((node) => (parent ? node.parent === parent : true))
          .map(({id, title, kind, summary, parent: nodeParent, order}) => ({
            id,
            title,
            kind,
            summary,
            parent: nodeParent,
            order,
          }));
        return text(listed);
      },
    );

    server.registerTool(
      "search_items",
      {
        title: "Search pages",
        description:
          "Keyword search over titles, summaries, and page bodies. Use this before get_item. Results are short: id, title, kind, summary, and a snippet. Every word in the query must appear.",
        inputSchema: z.object({
          query: z.string().describe("Words to find. All of them must match."),
        }),
      },
      async ({query}) => text(await searchWorkspace(query)),
    );

    server.registerTool(
      "get_item",
      {
        title: "Read a page",
        description:
          "Read one page or collection by id, including its full markdown body. Use search_items first when you do not already know the id.",
        inputSchema: z.object({
          id: z.string().describe("Page or collection id."),
        }),
      },
      async ({id}) => {
        const node = await getNode(id);
        if (!node) {
          return failure(`No page with id "${id}".`);
        }
        return text(node);
      },
    );

    server.registerTool(
      "create_item",
      {
        title: "Create a page",
        description:
          "Create a page or a collection. A page holds markdown. A collection groups pages. Parent must be a collection id, or omitted to place it at the top of the handbook. Always include a one-line summary so search can find it.",
        inputSchema: z.object({
          title: z.string(),
          kind: z.enum(["item", "collection"]),
          parent: z.string().nullable().optional(),
          summary: z.string().optional(),
          body: z.string().optional().describe("Markdown body."),
        }),
      },
      async ({title, kind, parent, summary, body}) => {
        try {
          const node = await createNode({
            title,
            kind,
            parent: parent ?? null,
            summary,
            body,
          });
          return text({id: node.id, title: node.title, kind: node.kind});
        } catch (error) {
          return failure(error);
        }
      },
    );

    server.registerTool(
      "update_item",
      {
        title: "Replace page fields",
        description:
          "Replace a page's title, summary, or entire markdown body. Omitted fields stay as they are. To change one sentence, use edit_item_content instead.",
        inputSchema: z.object({
          id: z.string(),
          title: z.string().optional(),
          summary: z.string().optional(),
          body: z.string().optional().describe("Full markdown body."),
        }),
      },
      async ({id, title, summary, body}) => {
        try {
          const node = await updateNode(id, {title, summary, body});
          return text({id: node.id, title: node.title, summary: node.summary});
        } catch (error) {
          return failure(error);
        }
      },
    );

    server.registerTool(
      "edit_item_content",
      {
        title: "Edit a snippet",
        description:
          "Replace one exact snippet in a page body and leave the rest untouched. The snippet must appear exactly once. Include surrounding words when the phrase is not unique.",
        inputSchema: z.object({
          id: z.string(),
          find: z.string().describe("Exact text to replace. Must occur once."),
          replace: z.string().describe("Text to insert instead."),
        }),
      },
      async ({id, find, replace}) => {
        try {
          const node = await editNodeContent(id, find, replace);
          return text({id: node.id, body: node.body});
        } catch (error) {
          return failure(error);
        }
      },
    );

    server.registerTool(
      "move_item",
      {
        title: "Move a page",
        description:
          "Move a page or collection into another collection, or to the top of the handbook when parent is null. This changes the board column and the sidebar branch.",
        inputSchema: z.object({
          id: z.string(),
          parent: z
            .string()
            .nullable()
            .describe("Collection id, or null for the top level."),
        }),
      },
      async ({id, parent}) => {
        try {
          const node = await moveNode(id, parent);
          return text({id: node.id, parent: node.parent});
        } catch (error) {
          return failure(error);
        }
      },
    );

    server.registerTool(
      "delete_item",
      {
        title: "Delete a page",
        description:
          "Delete a page or collection and everything nested inside it. This cannot be undone.",
        inputSchema: z.object({
          id: z.string(),
        }),
      },
      async ({id}) => {
        try {
          await deleteNode(id);
          return text({deleted: id});
        } catch (error) {
          return failure(error);
        }
      },
    );

    registerTesseraTools(server, {
      handles: getDb(),
      actorResolver: (clientInfo) => resolveTesseraActor()(clientInfo),
      // Route handlers may revalidate; the open page re-renders on its next visit.
      afterWrite: () => revalidatePath("/", "layout"),
    });
  },
  {
    serverInfo: {name: "handbook", version: "1.0.0"},
    instructions,
  },
);

export {handler as GET, handler as POST, handler as DELETE};
