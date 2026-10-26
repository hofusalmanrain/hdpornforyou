import { useEffect, useState } from "react";
import {
  getCounts,
  getUserReaction,
  REACTIONS_EVENT,
  type ReactionKind,
  type VideoCounts,
} from "@/lib/reactions-store";

export function useReactions(
  videoId: string,
  userId: string | null,
): {
  counts: VideoCounts;
  reaction: ReactionKind | null;
} {
  const [state, setState] = useState(() => ({
    counts: getCounts(videoId),
    reaction: getUserReaction(userId, videoId),
  }));
  useEffect(() => {
    const sync = () =>
      setState({
        counts: getCounts(videoId),
        reaction: getUserReaction(userId, videoId),
      });
    sync();
    window.addEventListener(REACTIONS_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(REACTIONS_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [videoId, userId]);
  return state;
}
