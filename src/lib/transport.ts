import { finalizeEvent, type Event as NostrEvent } from 'nostr-tools';
import type { Ruleset } from './game';

export const WORKER_URL = import.meta.env.VITE_WORKER_URL || 'ws://localhost:8787';

// ── Chain-linked event payloads (signed Nostr events, form the game record) ──

export type ChainPayload =
  | { type: 'genesis'; rules: Ruleset }   // host creates room, records rules
  | { type: 'accept'; opponentPk: string } // host accepts a join_request
  | { type: 'move'; x: number; y: number } // player places a stone (turn derived from chain)
  | { type: 'reset' };                     // either player starts a new round

export type GameEvent = NostrEvent;

// ── Out-of-chain room messages (relayed but not part of the game record) ──

export type RoomMessage =
  | { type: 'chain_event'; event: GameEvent }         // chain event broadcast
  | { type: 'join_request'; pubkey: string }           // guest asks to join
  | { type: 'history_request' }                        // new client requests history
  | { type: 'history_response'; events: GameEvent[] }  // existing client replies with chain
  | { type: 'chat'; text: string; pubkey: string };    // real-time chat (not stored)

export interface TransportCallbacks {
  onOpen: () => void;
  onMessage: (msg: RoomMessage) => void;
  onClose: () => void;
  onError: (err: Error) => void;
}

/** Build and sign a chain-linked Nostr event. prevId="" for the first event (genesis). */
export function createChainEvent(
  payload: ChainPayload,
  sk: Uint8Array,
  roomId: string,
  prevId: string,
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
  private callbacks: TransportCallbacks;
  private workerUrl: string;

  constructor(roomId: string, callbacks: TransportCallbacks, workerUrl = WORKER_URL) {
    this.roomId = roomId;
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
      this.callbacks.onOpen();
    };

    ws.onmessage = (ev) => {
      try {
        this.callbacks.onMessage(JSON.parse(ev.data as string) as RoomMessage);
      } catch (e) {
        console.error('[Transport] parse error', e);
      }
    };

    ws.onerror = () => this.callbacks.onError(new Error('WebSocket error'));

    ws.onclose = () => {
      this.ws = null;
      if (this.destroyed) return;
      this.callbacks.onClose();
      this.reconnectTimer = setTimeout(() => this.openSocket(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
    };
  }

  send(msg: RoomMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }
}
