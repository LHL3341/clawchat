import { useEffect, useRef, useCallback, useState } from "react";

type WSStatus = "connecting" | "connected" | "disconnected";

interface UseWebSocketOptions {
  enabled?: boolean;
}

export function useWebSocket(
  url: string | null,
  onMessage: (data: unknown) => void,
  options?: UseWebSocketOptions
) {
  const { enabled = true } = options ?? {};
  const [status, setStatus] = useState<WSStatus>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const onMessageRef = useRef(onMessage);
  const mountedRef = useRef(true);

  // Keep callback ref fresh to avoid stale closures
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    mountedRef.current = true;
    if (!url || !enabled) {
      setStatus("disconnected");
      return;
    }

    let cancelled = false;

    function connect() {
      if (cancelled) return;

      const ws = new WebSocket(url!);
      wsRef.current = ws;
      setStatus("connecting");

      ws.onopen = () => {
        if (cancelled) { ws.close(); return; }
        retriesRef.current = 0;
        setStatus("connected");
      };

      ws.onmessage = (ev) => {
        if (cancelled) return;
        try {
          const data = JSON.parse(ev.data);
          onMessageRef.current(data);
        } catch {
          console.warn("[useWebSocket] failed to parse message:", ev.data);
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        wsRef.current = null;
        setStatus("disconnected");
        scheduleReconnect();
      };

      ws.onerror = () => {
        // onerror is always followed by onclose, so just log
        if (!cancelled) {
          console.warn("[useWebSocket] connection error");
        }
      };
    }

    function scheduleReconnect() {
      if (cancelled) return;
      const delay = Math.min(1000 * Math.pow(2, retriesRef.current), 30000);
      retriesRef.current += 1;
      timerRef.current = setTimeout(connect, delay);
    }

    connect();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      clearTimeout(timerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on intentional close
        wsRef.current.close();
        wsRef.current = null;
      }
      setStatus("disconnected");
    };
  }, [url, enabled]);

  const sendMessage = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return { status, sendMessage };
}
