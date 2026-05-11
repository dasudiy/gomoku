# Gomoku — Online Board Game

A Gomoku (五子棋) game built with **React**, **Cloudflare Workers**, and **Nostr** cryptography. Games are relayed through a Cloudflare Durable Object, with every move cryptographically signed and chained — meaning the full game history is verifiable and players can reconnect after a disconnect without losing state.

## Features

- **Cloudflare Workers backend** — Durable Object per room, WebSocket Hibernation, SQLite event store. Free tier supports ~20K game sessions/day with near-zero idle cost.
- **Chain-linked moves** — Each move is a [Nostr](https://github.com/nostr-protocol/nostr)-style signed event containing `prevId` (the SHA-256 ID of the previous event). The server and client both verify the chain; forging or reordering past moves is cryptographically impossible.
- **Reconnect / history replay** — On reconnect the server streams all stored events. The client re-verifies the chain and rebuilds board state, so refreshing the page continues the game seamlessly.
- **Persistent identity** — A secp256k1 keypair is generated on first visit and stored in `localStorage`. Moves are signed with your private key; the opponent's client verifies them.
- **Game rules**: Standard (无禁手) and Renju (有禁手 — forbidden moves for Black: overline, double-four, double-three).
- **Real-time chat** — Signed chat messages over the same WebSocket.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite |
| Backend | Cloudflare Workers + Durable Objects (SQLite) |
| Crypto / signing | `nostr-tools` (secp256k1 / Schnorr) |
| Styling | Vanilla CSS |

## Project Structure

```
src/           — React frontend
  lib/
    transport.ts   — GameTransport (WebSocket client, auto-reconnect)
    identity.ts    — Keypair generation + Nostr event signing
    game.ts        — Board logic, rule enforcement
  hooks/
    useGameRoom.ts — Room state, chain replay, move dispatch
  components/      — Board, Chat, GameInfo

worker/        — Cloudflare Worker (deploy separately)
  src/index.ts   — GameRoom Durable Object + WebSocket handler
  wrangler.toml  — DO binding, SQLite migration
```

## Getting Started

### Prerequisites

- Node.js v20+
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier is sufficient)

### 1. Deploy the Worker

```bash
cd worker
npm install
npx wrangler login
npx wrangler deploy
```

Note the deployed URL, e.g. `https://gomoku-server.<your-account>.workers.dev`.

### 2. Run the frontend

```bash
# in the repo root
npm install

# point the frontend at your worker
echo "VITE_WORKER_URL=wss://gomoku-server.<your-account>.workers.dev" > .env.local

npm run dev
```

For local end-to-end development, start the worker locally first:

```bash
# terminal 1
cd worker && npx wrangler dev

# terminal 2 (uses wss://localhost:8787 by default when VITE_WORKER_URL is unset)
npm run dev
```

### Production Build

```bash
npm run build   # outputs to dist/
```

## How to Play

1. **Host** — Choose a ruleset, click **Host Game**. A room URL is generated instantly.
2. **Invite** — Copy the link from the sidebar and send it to your opponent.
3. **Join** — The opponent opens the link; both players are assigned colors automatically.
4. **Reconnect** — Either player can refresh the page at any time. The full verified game history is replayed from the server.

## Move Chain Protocol

Each game event is a Nostr event (kind `29003`) with:

```
tags:    [["prev", "<id of previous event>"], ["room", "<roomId>"]]
content: JSON payload  { type: "move" | "chat" | "reset", ... }
id:      SHA-256 of the canonical serialization (covers tags + content)
sig:     Schnorr signature over id with the player's private key
```

The first event uses `prev = ""`. The server rejects any event whose `prev` doesn't match the last stored event's `id`, preventing replay attacks and out-of-order injection.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `VITE_WORKER_URL` | `wss://localhost:8787` | WebSocket URL of the deployed Worker |

## License

GPL-3.0 — see [LICENSE](LICENSE).
