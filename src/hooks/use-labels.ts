import { useEffect, useState } from "react";
import { getLabels, LABELS_EVENT } from "@/lib/labels-store";

export function useLabels() {
  const [labels, setL] = useState(() => getLabels());
  useEffect(() => {
    const sync = () => setL(getLabels());
    window.addEventListener(LABELS_EVENT, sync);
    return () => window.removeEventListener(LABELS_EVENT, sync);
  }, []);
  return labels;
}
