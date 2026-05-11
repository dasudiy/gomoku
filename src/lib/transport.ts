import { finalizeEvent, type Event as NostrEvent } from 'nostr-tools';

// Set VITE_WORKER_URL to your deployed Worker URL, e.g.:
//   wss://gomoku-server.<your-account>.workers.dev
// For local dev: wss://localhost:8787
export const WORKER_URL = import.meta.env.VITE_WORKER_URL || 'wss://localhost:8787';

export type GamePayload =
  | { type: 'move'; x: number; y: number; player: 1 | 2 }
  | { type: 'chat'; text: string }
  | { type: 'reset' };

export type GameEvent = NostrEvent;

export interface TransportCallbacks {
  onAssign: (color: 1 | 2, opponentPk: string | null) => void;
  onJoined: (opponentPk: string) => void;
  onHistory: (events: GameEvent[]) => void;
  onEvent: (event: GameEvent) => void;
  onClose: () => void;
  onError: (err: Error) => void;
}

/** Build and sign a game event forming a chain with the previous event. */
export function createGameEvent(
  payload: GamePayload,
  sk: Uint8Array,
  roomId: string,
  prevId: string,  // "" for first event
): GameEvent {
  return finalizeEvent({
    kind: 29003,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['prev', prevId], ['room', roomId]],
    content: JSON.stringify(payload),
  }, sk);
}

const MAX_RECONNECT_DELAY_MS = 30_000;

export class GameTransport {
  private ws: WebSocket | null = null;
  private destroyed = false;
  private reconnectDelay = 1000;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private roomId: string;
  private pubkey: string;
  private callbacks: TransportCallbacks;
  private workerUrl: string;

  constructor(
    roomId: string,
    pubkey: string,
    callbacks: TransportCallbacks,
    workerUrl = WORKER_URL,
  ) {
    this.roomId = roomId;
    this.pubkey = pubkey;
    this.callbacks = callbacks;
    this.workerUrl = workerUrl;
    this.openSocket();
  }

  private openSocket(): void {
    if (this.destroyed) return;
    const url = `${this.workerUrl}/room/${encodeURIComponent(this.roomId)}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelay = 1000;
      ws.send(JSON.stringify({ type: 'join', pubkey: this.pubkey }));
    };

    ws.onmessage = (ev) => {
      try {
        this.handleServerMessage(JSON.parse(ev.data as string));
      } catch (e) {
        console.error('[Transport] parse error', e);
      }
    };

    ws.onerror = () => {
      this.callbacks.onError(new Error('WebSocket error'));
    };

    ws.onclose = () => {
      this.ws = null;
      if (this.destroyed) return;
      this.callbacks.onClose();
      this.reconnectTimer = setTimeout(() => this.openSocket(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
    };
  }

  private handleServerMessage(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case 'assign':
        this.callbacks.onAssign(msg.color as 1 | 2, (msg.opponentPk as string) || null);
        break;
      case 'joined':
        this.callbacks.onJoined(msg.opponentPk as string);
        break;
      case 'history':
        this.callbacks.onHistory(msg.events as GameEvent[]);
        break;
      case 'event':
        this.callbacks.onEvent(msg.event as GameEvent);
        break;
      case 'error':
        console.warn('[Transport] server error:', msg.message);
        break;
    }
  }

  sendEvent(event: GameEvent): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'event', event }));
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }
}
