import { useEffect, useRef } from "react";
import type { ClientToServerMessage } from "@agent-tel/shared";
import { useStore } from "../state/store.js";

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

/** Owns the single WebSocket connection for the app: connects on mount,
 * reconnects with backoff on drop, and feeds every incoming message straight
 * into the zustand store. Returns a `subscribe`/`unsubscribe` pair so views
 * can (un)subscribe to a specific session's event stream as the user
 * navigates between them. */
export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const applyServerMessage = useStore((s) => s.applyServerMessage);
  const pendingSubs = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    let retryDelay = 500;
    let socket: WebSocket | null = null;

    function connect() {
      if (cancelled) return;
      socket = new WebSocket(wsUrl());
      wsRef.current = socket;

      socket.onopen = () => {
        retryDelay = 500;
        for (const sessionId of pendingSubs.current) send({ type: "subscribe", sessionId });
      };

      socket.onmessage = (ev) => {
        try {
          applyServerMessage(JSON.parse(ev.data));
        } catch {
          // ignore malformed frame
        }
      };

      socket.onclose = () => {
        if (cancelled) return;
        setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 8000);
      };

      socket.onerror = () => socket?.close();
    }

    connect();
    return () => {
      cancelled = true;
      socket?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function send(msg: ClientToServerMessage) {
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
  }

  function subscribe(sessionId: string) {
    pendingSubs.current.add(sessionId);
    send({ type: "subscribe", sessionId });
  }

  function unsubscribe(sessionId: string) {
    pendingSubs.current.delete(sessionId);
    send({ type: "unsubscribe", sessionId });
  }

  return { subscribe, unsubscribe };
}
