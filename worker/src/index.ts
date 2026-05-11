import { verifyEvent, type Event as NostrEvent } from 'nostr-tools';

export interface Env {
  GAME_ROOM: DurableObjectNamespace;
}

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
// Types
// ------------------------------------------------------------------
interface PlayerRow { pubkey: string; color: number; [k: string]: string | number }
interface EventRow  { id: string; event_json: string; [k: string]: string | number }

type ServerMsg =
  | { type: 'assign';  color: 1 | 2; opponentPk: string | null }
  | { type: 'joined';  opponentPk: string }
  | { type: 'history'; events: NostrEvent[] }
  | { type: 'event';   event: NostrEvent }
  | { type: 'error';   message: string };

type ClientMsg =
  | { type: 'join';  pubkey: string }
  | { type: 'event'; event: NostrEvent };

interface WsAttachment { pubkey: string; color: 1 | 2 }

// ------------------------------------------------------------------
// Durable Object — one instance per game room
// ------------------------------------------------------------------
export class GameRoom {
  private ctx: DurableObjectState;

  constructor(ctx: DurableObjectState, _env: Env) {
    this.ctx = ctx;
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS players (
          pubkey TEXT PRIMARY KEY,
          color  INTEGER NOT NULL
        )
      `);
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS events (
          seq          INTEGER PRIMARY KEY AUTOINCREMENT,
          id           TEXT UNIQUE NOT NULL,
          pubkey       TEXT NOT NULL,
          content_type TEXT NOT NULL,
          event_json   TEXT NOT NULL
        )
      `);
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    let msg: ClientMsg;
    try { msg = JSON.parse(message); } catch { return; }

    if (msg.type === 'join') {
      await this.handleJoin(ws, msg.pubkey);
    } else if (msg.type === 'event') {
      await this.handleEvent(ws, msg.event);
    }
  }

  webSocketClose(ws: WebSocket): void {
    const att = ws.deserializeAttachment() as WsAttachment | null;
    if (att) console.log(`[GameRoom] disconnected: ${att.pubkey.slice(0, 8)}`);
  }

  webSocketError(ws: WebSocket, _error: unknown): void {
    ws.close(1011, 'Internal error');
  }

  // ─── Join ─────────────────────────────────────────────────────────

  private handleJoin(ws: WebSocket, pubkey: string): void {
    const existing = this.ctx.storage.sql
      .exec<PlayerRow>(`SELECT pubkey, color FROM players WHERE pubkey = ?`, pubkey)
      .one() as PlayerRow | null;

    let color: 1 | 2;

    if (existing) {
      // Reconnect
      color = existing.color as 1 | 2;
    } else {
      // New player — check capacity
      const count = (this.ctx.storage.sql
        .exec<{ n: number }>(`SELECT COUNT(*) AS n FROM players`)
        .one() as { n: number }).n;

      if (count >= 2) {
        this.send(ws, { type: 'error', message: 'Room is full' });
        ws.close(4000, 'Room full');
        return;
      }

      color = count === 0 ? 1 : 2;
      this.ctx.storage.sql.exec(
        `INSERT INTO players (pubkey, color) VALUES (?, ?)`, pubkey, color
      );

      // Notify existing player 1 that opponent arrived
      if (color === 2) {
        for (const sock of this.ctx.getWebSockets()) {
          if (sock === ws) continue;
          this.send(sock, { type: 'joined', opponentPk: pubkey });
        }
      }
    }

    ws.serializeAttachment({ pubkey, color } satisfies WsAttachment);

    // Tell this player their color + current opponent (null if not here yet)
    const opponent = this.ctx.storage.sql
      .exec<PlayerRow>(`SELECT pubkey FROM players WHERE pubkey != ?`, pubkey)
      .one() as PlayerRow | null;

    this.send(ws, { type: 'assign', color, opponentPk: opponent?.pubkey ?? null });

    // Replay full history
    const rows = this.ctx.storage.sql
      .exec<EventRow>(`SELECT event_json FROM events ORDER BY seq`)
      .toArray() as EventRow[];
    this.send(ws, { type: 'history', events: rows.map(r => JSON.parse(r.event_json) as NostrEvent) });
  }

  // ─── Incoming game event ──────────────────────────────────────────

  private handleEvent(ws: WebSocket, event: NostrEvent): void {
    const att = ws.deserializeAttachment() as WsAttachment | null;
    if (!att) {
      this.send(ws, { type: 'error', message: 'Send join first' });
      return;
    }

    // 1. Verify Nostr signature + ID
    if (!verifyEvent(event)) {
      this.send(ws, { type: 'error', message: 'Invalid signature' });
      return;
    }

    // 2. Pubkey must match what joined
    if (event.pubkey !== att.pubkey) {
      this.send(ws, { type: 'error', message: 'Pubkey mismatch' });
      return;
    }

    // 3. Verify prevId chain
    const prevId = event.tags.find(t => t[0] === 'prev')?.[1] ?? null;
    if (prevId === null) {
      this.send(ws, { type: 'error', message: 'Missing prev tag' });
      return;
    }
    const lastRow = this.ctx.storage.sql
      .exec<{ id: string }>(`SELECT id FROM events ORDER BY seq DESC LIMIT 1`)
      .one() as { id: string } | null;
    const expectedPrev = lastRow?.id ?? '';
    if (prevId !== expectedPrev) {
      this.send(ws, { type: 'error', message: `Chain broken: expected prev=${expectedPrev.slice(0,8)}` });
      return;
    }

    // 4. Validate turn order for move events
    const content = JSON.parse(event.content) as { type: string };
    if (content.type === 'move') {
      const moveCount = (this.ctx.storage.sql
        .exec<{ n: number }>(`SELECT COUNT(*) AS n FROM events WHERE content_type = 'move'`)
        .one() as { n: number }).n;
      const expectedColor: 1 | 2 = moveCount % 2 === 0 ? 1 : 2;
      if (att.color !== expectedColor) {
        this.send(ws, { type: 'error', message: 'Not your turn' });
        return;
      }
    }

    // 5. Store (ignore duplicate IDs — idempotent)
    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO events (id, pubkey, content_type, event_json) VALUES (?, ?, ?, ?)`,
      event.id, event.pubkey, content.type, JSON.stringify(event)
    );

    // 6. Broadcast to everyone in the room
    const msg = JSON.stringify({ type: 'event', event } satisfies ServerMsg);
    for (const sock of this.ctx.getWebSockets()) {
      try { sock.send(msg); } catch { /* closed */ }
    }
  }

  private send(ws: WebSocket, msg: ServerMsg): void {
    try { ws.send(JSON.stringify(msg)); } catch { /* closed */ }
  }
}
