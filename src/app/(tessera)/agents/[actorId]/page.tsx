import { notFound, redirect } from "next/navigation";
import { IdSchema } from "@/lib/tessera/schemas";

type Props = { params: Promise<{ actorId: string }> };

/** `/agents/<id>` opens the summary tab. */
export default async function AgentIndexPage({ params }: Props) {
  const { actorId } = await params;
  if (!IdSchema.safeParse(actorId).success) notFound();
  redirect(`/agents/${actorId}/summary`);
}
