"use client";

/**
 * The work item the side peek shows (`?peek=<id>`, src/components/detail/peek-url.ts), read from the URL so the board
 * and the table can mark its card or row (`aria-current`; board.css, table.css). Null when no peek is open or the
 * route has no peek host.
 */
import { useSearchParams } from "next/navigation";
import { PEEK_PARAM } from "@/components/detail/peek-url";

export function usePeekedId(): string | null {
  const searchParams = useSearchParams();
  const id = searchParams?.get(PEEK_PARAM);
  return id ? id : null;
}
