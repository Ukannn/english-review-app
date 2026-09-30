import { useEffect, useState } from "react";
import type { ApiClient, PhraseSummary } from "./contracts";
import { readPhraseInventory } from "./learningMetrics";

export function usePhraseInventory(client: ApiClient, enabled: boolean, revision: number) {
  const [items, setItems] = useState<PhraseSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true); setError("");
    void readPhraseInventory(client, () => cancelled).then(next => { if (!cancelled) setItems(next); }).catch(caught => { if (!cancelled) setError(caught instanceof Error ? caught.message : "表达统计加载失败。"); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [client, enabled, revision]);
  return { items, loading, error };
}
