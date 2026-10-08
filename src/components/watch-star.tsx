"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleWatchlist } from "@/app/actions";

export function WatchStar({ itemId, watched }: { itemId: number; watched: boolean }) {
  const [isWatched, setIsWatched] = useState(watched);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  // Server re-render (router.refresh / revalidatePath) may deliver a new
  // watched prop; keep every star instance in sync with the source of truth.
  useEffect(() => {
    setIsWatched(watched);
  }, [watched]);

  return (
    <button
      onClick={() => {
        const next = !isWatched;
        setIsWatched(next); // optimistic: flip immediately
        startTransition(async () => {
          try {
            await toggleWatchlist(itemId);
            router.refresh(); // pull fresh RSC so panels & other stars update without a manual reload
          } catch {
            setIsWatched(!next); // roll back on failure
          }
        });
      }}
      disabled={pending}
      title={isWatched ? "移出关注" : "加入关注"}
      className={isWatched ? "text-terminal-amber" : "text-terminal-muted hover:text-slate-300"}
    >
      {isWatched ? "★" : "☆"}
    </button>
  );
}
