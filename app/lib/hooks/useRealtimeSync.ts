import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

let sharedEventSource: EventSource | null = null;
let sharedConnected = false;

export function useRealtimeSync(enabled = true) {
  const queryClient = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;
    if (sharedEventSource) return;

    const es = new EventSource("/api/events", { withCredentials: true });
    sharedEventSource = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        for (const key of data.queryKeys) {
          queryClient.invalidateQueries({ queryKey: key });
        }
        void router.invalidate();
      } catch {
        // Ignore malformed messages
      }
    };

    es.onopen = () => {
      if (sharedConnected) {
        queryClient.invalidateQueries();
        void router.invalidate();
      }
      sharedConnected = true;
    };

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED && sharedEventSource === es) {
        sharedEventSource = null;
        sharedConnected = false;
      }
    };

    return () => {
      if (sharedEventSource === es) {
        es.close();
        sharedEventSource = null;
        sharedConnected = false;
      }
    };
  }, [enabled, queryClient, router]);
}
