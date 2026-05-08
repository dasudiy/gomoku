import { SimplePool, finalizeEvent, getPublicKey, type Filter } from 'nostr-tools';
import Peer from 'simple-peer';
import pako from 'pako';

// China-accessible relays first
export const DEFAULT_RELAYS = [
  'wss://relay.nostrzh.org',
  'wss://nostr.wine',
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://offchain.pub',
];

// China-accessible STUN servers first, Google as fallback
const STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.miwifi.com:3478' },
  { urls: 'stun:stun.chat.bilibili.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// Sign up free at https://dashboard.metered.ca/signup?tool=turnserver
// Set your API key here or via VITE_METERED_API_KEY env var
const METERED_API_KEY = import.meta.env.VITE_METERED_API_KEY || '';
const METERED_APP = import.meta.env.VITE_METERED_APP || 'openrelayproject';

/** Fetch TURN credentials from Metered, fallback to STUN-only */
async function getIceServers(): Promise<RTCIceServer[]> {
  if (!METERED_API_KEY) {
    console.warn('[ICE] No TURN API key configured — STUN only (may fail behind symmetric NAT)');
    return STUN_SERVERS;
  }
  try {
    const res = await fetch(
      `https://${METERED_APP}.metered.live/api/v1/turn/credentials?apiKey=${METERED_API_KEY}`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const servers: RTCIceServer[] = await res.json();
    console.log(`[ICE] Got ${servers.length} TURN servers from Metered`);
    return [...STUN_SERVERS, ...servers];
  } catch (e) {
    console.warn('[ICE] Failed to fetch TURN credentials, STUN-only fallback:', e);
    return STUN_SERVERS;
  }
}

const KIND_SIGNAL = 4242;
const ICE_GATHER_TIMEOUT_MS = 5000;
const ICE_FALLBACK_TIMEOUT_MS = 20_000;

export interface PeerCallbacks {
  onConnect: () => void;
  onData: (data: any) => void;
  onClose: () => void;
  onError: (err: Error) => void;
}

/** Compress signal array → URL-safe base64 string */
export function compressSignals(signals: any[]): string {
  const bytes = pako.deflate(JSON.stringify(signals));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** Decompress URL-safe base64 → signal array */
export function decompressSignals(encoded: string): any[] {
  const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return JSON.parse(pako.inflate(bytes, { to: 'string' }));
}

export class PeerConnection {
  public peer!: Peer.Instance;
  public relayMode = false;
  private pool = new SimplePool();
  private relays: string[];
  private roomId: string;
  private sk: Uint8Array;
  private pk: string;
  private destroyed = false;
  private retryTimer?: ReturnType<typeof setInterval>;
  private fallbackTimer?: ReturnType<typeof setTimeout>;
  private connectedRelays = new Set<string>();
  private seenIds = new Set<string>();
  private gotRemoteOffer = false;
  private gotRemoteAnswer = false;
  private localSignalBuffer: any[] = [];
  private dataCb!: PeerCallbacks;

  readonly ready: Promise<void>;
  /** Resolves with compressed local signals (offer for host, answer for client) */
  readonly localSignalReady: Promise<string>;
  private resolveLocalSignal!: (s: string) => void;

  constructor(
    isInitiator: boolean,
    roomId: string,
    sk: Uint8Array,
    callbacks: PeerCallbacks,
    onRelayChange?: (count: number) => void,
    relays = DEFAULT_RELAYS,
    /** Pre-extracted signals from invite URL (client only) */
    initialSignals?: any[],
  ) {
    this.relays = relays;
    this.roomId = roomId;
    this.sk = sk;
    this.pk = getPublicKey(sk);
    this.localSignalReady = new Promise(r => { this.resolveLocalSignal = r; });
    this.ready = this.init(isInitiator, callbacks, onRelayChange, initialSignals);
  }

  /** Unified send — WebRTC when connected, relay as fallback */
  send(data: string): void {
    if (this.destroyed) return;
    if (this.relayMode) {
      this.publishDataViaRelay(data);
    } else {
      this.peer.send(data);
    }
  }

  private async init(
    isInitiator: boolean,
    cb: PeerCallbacks,
    onRelayChange?: (count: number) => void,
    initialSignals?: any[],
  ) {
    this.dataCb = cb;

    // ── Step 1: Fetch TURN servers then create peer ──
    const iceServers = await getIceServers();
    this.peer = new Peer({
      initiator: isInitiator,
      trickle: true,
      config: { iceServers },
    });

    // Buffer all local signals, flush when gathering complete
    let gatheringDone = false;
    const flush = () => {
      if (gatheringDone || this.destroyed) return;
      gatheringDone = true;
      const candidates = this.localSignalBuffer.filter(s => s.candidate).length;
      console.log(`[WebRTC] Gathering done. ${this.localSignalBuffer.length} signals, ${candidates} candidates`);
      if (this.localSignalBuffer.length > 0) {
        const compressed = compressSignals(this.localSignalBuffer);
        console.log(`[Signal] Compressed to ${compressed.length} chars`);
        this.resolveLocalSignal(compressed);
        // Also publish via relay
        this.publishViaRelay(this.localSignalBuffer);
      }
    };

    // Hook into RTCPeerConnection for gathering state
    // @ts-ignore — simple-peer internal
    const pc: RTCPeerConnection | undefined = this.peer._pc;
    if (pc) {
      pc.onicegatheringstatechange = () => {
        console.log(`[ICE] Gathering: ${pc.iceGatheringState}`);
        if (pc.iceGatheringState === 'complete') flush();
      };
      pc.oniceconnectionstatechange = () => {
        console.log(`[ICE] Connection: ${pc.iceConnectionState}`);
      };
    }
    setTimeout(flush, ICE_GATHER_TIMEOUT_MS); // safety timeout

    this.peer.on('signal', (data: any) => {
      if (this.destroyed) return;
      this.localSignalBuffer.push(data);
      if (data.type) console.log(`[WebRTC] Local signal: ${data.type}`);
      else if (data.candidate) console.log(`[WebRTC] Local candidate`);
    });

    this.peer.on('connect', () => {
      console.log('[WebRTC] ✓ Connected!');
      if (this.retryTimer) clearInterval(this.retryTimer);
      if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
      cb.onConnect();
    });
    this.peer.on('data', cb.onData);
    this.peer.on('close', () => { if (!this.relayMode) cb.onClose(); });
    this.peer.on('error', (err) => {
      console.error('[WebRTC]', err);
      // If not connected yet, let the fallback timer handle it
      if (!this.relayMode && this.peer?.connected) cb.onError(err);
    });

    // ── Fallback: switch to relay if WebRTC fails within timeout ──
    // Only if we've seen remote signals (opponent exists but ICE failed)
    this.fallbackTimer = setTimeout(() => {
      this.fallbackTimer = undefined;
      if (!this.destroyed && !this.peer?.connected && (this.gotRemoteOffer || this.gotRemoteAnswer)) {
        this.switchToRelay();
      }
    }, ICE_FALLBACK_TIMEOUT_MS);

    // ── Step 2: Apply initial signals from URL immediately ──
    if (initialSignals?.length) {
      console.log(`[WebRTC] Applying ${initialSignals.length} signals from URL`);
      this.applyRemoteSignals(initialSignals);
    }

    // ── Step 3: Subscribe to relays in background ──
    // Single subscription handles both signal and data events
    const filter: Filter = {
      kinds: [KIND_SIGNAL],
      '#t': [this.roomId],
      since: Math.floor(Date.now() / 1000) - 300,
    };
    console.log(`[Signal] Subscribe room=${this.roomId}`);
    this.pool.subscribeMany(this.relays, filter, {
      onevent: (event) => {
        if (event.pubkey === this.pk) return;
        if (this.seenIds.has(event.id)) return;
        this.seenIds.add(event.id);
        try {
          const parsed = JSON.parse(event.content);
          if (Array.isArray(parsed)) {
            // WebRTC signaling data
            console.log(`[Signal] RECV ${parsed.length} signal(s) via relay`);
            this.applyRemoteSignals(parsed);
          } else if (parsed._d !== undefined) {
            // Relay data fallback — always deliver (seq dedup handles safety)
            this.dataCb.onData(parsed._d);
          }
        } catch (e) { console.error('[Signal] Parse error', e); }
      },
    });

    this.relays.forEach(url => {
      this.pool.ensureRelay(url).then(() => {
        console.log(`[Relay] ✓ ${url}`);
        this.connectedRelays.add(url);
        onRelayChange?.(this.connectedRelays.size);
      }).catch(() => console.warn(`[Relay] ✗ ${url}`));
    });

    // Host: re-publish every 20s until connected
    if (isInitiator) {
      this.retryTimer = setInterval(() => {
        if (this.destroyed || this.peer?.connected || this.relayMode) { clearInterval(this.retryTimer); return; }
        if (this.localSignalBuffer.length > 0) {
          console.log('[Signal] Re-publishing via relay...');
          this.publishViaRelay(this.localSignalBuffer);
        }
      }, 20_000);
    }
  }

  /** Switch from WebRTC to relay-based data transport */
  private switchToRelay() {
    if (this.relayMode || this.destroyed) return;
    this.relayMode = true;
    console.log('[Relay] ⚡ WebRTC failed — switching to relay data mode');
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    if (this.retryTimer) clearInterval(this.retryTimer);
    // Clean up WebRTC peer (close/error events are suppressed by relayMode flag)
    try { this.peer?.destroy(); } catch { /* ignore */ }
    this.dataCb.onConnect();
  }

  private applyRemoteSignals(signals: any[]) {
    for (const sig of signals) {
      if (!this.peer || this.peer.destroyed) return;
      if (sig.type === 'offer' && this.gotRemoteOffer) continue;
      if (sig.type === 'answer' && this.gotRemoteAnswer) continue;
      if (sig.type === 'offer') this.gotRemoteOffer = true;
      if (sig.type === 'answer') this.gotRemoteAnswer = true;
      console.log(`[WebRTC] Apply ${sig.type || 'candidate'}`);
      try { this.peer.signal(sig); } catch (e) { console.error('[WebRTC] Signal error:', e); }
    }
    // If initial fallback timer already expired, start a new one now that opponent exists
    if (!this.fallbackTimer && !this.relayMode && !this.destroyed && !this.peer?.connected) {
      this.fallbackTimer = setTimeout(() => {
        if (!this.destroyed && !this.peer?.connected) this.switchToRelay();
      }, ICE_FALLBACK_TIMEOUT_MS);
    }
  }

  /** Apply manually pasted compressed signals (host pastes answer, or vice versa) */
  applyManualSignal(encoded: string): void {
    const signals = decompressSignals(encoded); // throws on invalid input
    console.log(`[Manual] Applying ${signals.length} signals`);
    this.applyRemoteSignals(signals);
  }

  private publishViaRelay(signals: any[]) {
    const event = finalizeEvent({
      kind: KIND_SIGNAL,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['t', this.roomId]],
      content: JSON.stringify(signals),
    }, this.sk);
    this.pool.publish(this.relays, event).forEach((pub, i) => {
      pub.then(() => console.log(`[Signal] OK → ${this.relays[i]}`))
        .catch((err: any) => console.warn(`[Signal] FAIL → ${this.relays[i]}`, err?.message));
    });
  }

  /** Publish game data via relay (fallback transport) */
  private publishDataViaRelay(data: string) {
    const event = finalizeEvent({
      kind: KIND_SIGNAL,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['t', this.roomId]],
      content: JSON.stringify({ _d: data }),
    }, this.sk);
    // Fire-and-forget, no logging for game data to reduce noise
    this.pool.publish(this.relays, event);
  }

  destroy() {
    this.destroyed = true;
    if (this.retryTimer) clearInterval(this.retryTimer);
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    this.peer?.destroy();
    this.pool.close(this.relays);
  }
}
