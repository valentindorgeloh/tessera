import {Suspense} from "react";
import {ItemScreen} from "../../item-screen";

export default function ItemPage({params}: PageProps<"/items/[id]">) {
  return (
    <Suspense fallback={null}>
      <ItemRoute params={params} />
    </Suspense>
  );
}

async function ItemRoute({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  return <ItemScreen id={id} />;
}
