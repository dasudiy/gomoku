export interface Env {
  GAME_ROOM: DurableObjectNamespace;
}

const MAX_MSG_BYTES   = 64 * 1024;       // 64 KB per message
const RATE_WINDOW_MS  = 1_000;           // sliding window: 1 s
const RATE_MAX_MSGS   = 20;              // max messages per window per client
const MAX_CLIENTS     = 10;             // max concurrent WS connections per room
const IDLE_TIMEOUT_MS = 30 * 60 * 1_000; // 30 min without activity → evict

type SocketState = { count: number; windowStart: number };

// Worker entry — routes WebSocket upgrades to the correct GameRoom DO
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/room\/([^/]+)\/ws$/);
    if (!m) return new Response('Not Found', { status: 404 });
    const id = env.GAME_ROOM.idFromName(m[1]);
    return env.GAME_ROOM.get(id).fetch(request);
  },
} satisfies ExportedHandler<Env>;

// ------------------------------------------------------------------
// GameRoom Durable Object — pure WebSocket relay, no game logic.
// Safeguards: message size cap, per-client rate limit, idle eviction.
// ------------------------------------------------------------------
export class GameRoom {
  private ctx: DurableObjectState;

  constructor(ctx: DurableObjectState, _env: Env) {
    this.ctx = ctx;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }
    if (this.ctx.getWebSockets().length >= MAX_CLIENTS) {
      return new Response('Room full', { status: 503 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ count: 0, windowStart: Date.now() } satisfies SocketState);
    await this.ctx.storage.setAlarm(Date.now() + IDLE_TIMEOUT_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // 1. Size limit
    const byteLen = typeof message === 'string' ? message.length : (message as ArrayBuffer).byteLength;
    if (byteLen > MAX_MSG_BYTES) {
      ws.close(1009, 'Message too large');
      return;
    }

    // 2. Per-client rate limit (state survives hibernation via attachment)
    const now = Date.now();
    const state: SocketState = ws.deserializeAttachment() ?? { count: 0, windowStart: now };
    if (now - state.windowStart > RATE_WINDOW_MS) {
      state.count = 1;
      state.windowStart = now;
    } else {
      state.count++;
    }
    ws.serializeAttachment(state);
    if (state.count > RATE_MAX_MSGS) {
      ws.close(1008, 'Rate limit exceeded');
      return;
    }

    // 3. Reset idle alarm on every valid message
    await this.ctx.storage.setAlarm(Date.now() + IDLE_TIMEOUT_MS);

    // Broadcast to all other clients
    const data = typeof message === 'string' ? message : new TextDecoder().decode(message as ArrayBuffer);
    for (const sock of this.ctx.getWebSockets()) {
      if (sock === ws) continue;
      try { sock.send(data); } catch { /* already closed */ }
    }
  }

  // Idle timeout fired — close all connections and delete DO storage
  async alarm(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.close(1001, 'Room closed: inactivity'); } catch { /* already closed */ }
    }
    await this.ctx.storage.deleteAll();
  }

  webSocketClose(): void {}

  webSocketError(ws: WebSocket): void {
    try { ws.close(1011, 'Internal error'); } catch { /* already closed */ }
  }
}
