import { listActors, registerActor, RegisterActorInput, updateActor, UpdateActorInput } from "../../actors";
import { defineTool } from "../define";
import { ActorId, EmptyInput, toListResult } from "./shared";

// ---------------------------------------------------------------------------
// Actors (P1)
// ---------------------------------------------------------------------------

export const actorTools = [
  defineTool({
    name: "list_actors",
    title: "List actors",
    description: "Lists every actor: the built-in user, assistant and system actors plus the registered agents, with kind, colour and last_seen.",
    input: EmptyInput,
    mutates: false,
    core: true,
    phase: "P1",
    run: (ctx) => toListResult(ctx, listActors(ctx)),
  }),
  defineTool({
    name: "register_actor",
    title: "Register actor",
    description:
      "Registers an agent actor so its changes are attributed; only kind agent registers itself, the built-in actors are seeded. MCP clients use the name mcp:<client_name>. Registering a name that already exists updates that actor's last_seen and client name and returns it instead of creating a duplicate. Returns the actor row to pass as actorId on later calls.",
    input: RegisterActorInput.strict(),
    mutates: true,
    phase: "P1",
    run: (ctx, input) => registerActor(ctx, input),
  }),
  defineTool({
    name: "update_actor",
    title: "Update actor",
    description: "Renames or recolours an actor (display name and palette colour); the kind never changes.",
    input: UpdateActorInput.strict().extend({ actor_id: ActorId }),
    mutates: true,
    phase: "P1",
    run: (ctx, { actor_id, ...patch }) => updateActor(ctx, actor_id, patch),
  }),
];
