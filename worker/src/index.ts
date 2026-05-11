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
// GameRoom Durable Object — pure WebSocket relay, no game logic
// All messages are broadcast to every other client in the room.
// History / chain validation is fully client-side.
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
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const data = typeof message === 'string' ? message : new TextDecoder().decode(message);
    for (const sock of this.ctx.getWebSockets()) {
      if (sock === ws) continue;
      try { sock.send(data); } catch { /* closed */ }
    }
  }

  webSocketClose(): void {}

  webSocketError(ws: WebSocket): void {
    ws.close(1011, 'Internal error');
  }
}
