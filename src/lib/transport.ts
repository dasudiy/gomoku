import { SimplePool, finalizeEvent, getPublicKey, type Filter } from 'nostr-tools';
import Peer from 'simple-peer';

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://offchain.pub',
  'wss://relay.snort.social'
];

export const KIND_SDP = 29001;
export const KIND_ICE = 29002;

export interface SignalingMessage {
  type: 'offer' | 'answer' | 'candidate';
  data: any;
}

export class NostrSignaler {
  private pool = new SimplePool();
  private relays: string[];
  private roomId: string;
  private sk: Uint8Array;
  private pk: string;
  private onRelayChange?: (count: number) => void;
  private connectedRelays = new Set<string>();
  private seenEventIds = new Set<string>();

  /** Resolves once at least one relay is connected. */
  readonly ready: Promise<void>;

  constructor(roomId: string, sk: Uint8Array, relays = DEFAULT_RELAYS) {
    this.roomId = roomId;
    this.relays = relays;
    this.sk = sk;
    this.pk = getPublicKey(sk);

    this.ready = new Promise<void>((resolve) => {
      let resolved = false;
      this.relays.forEach(url => {
        this.pool.ensureRelay(url).then(() => {
          console.log(`[Signaler] Relay connected: ${url}`);
          this.connectedRelays.add(url);
          this.onRelayChange?.(this.connectedRelays.size);
          if (!resolved) { resolved = true; resolve(); }
        }).catch(err => {
          console.warn(`[Signaler] Relay failed: ${url}`, err.message || err);
        });
      });
    });
  }

  subscribe(onSignal: (msg: SignalingMessage) => void, onRelayChange?: (count: number) => void) {
    this.onRelayChange = onRelayChange;

    const filter: Filter = {
      kinds: [KIND_SDP, KIND_ICE],
      '#t': [this.roomId],
      since: Math.floor(Date.now() / 1000) - 300,
    };

    console.log(`[Signaler] Subscribing to room ${this.roomId}`);

    this.pool.subscribeMany(this.relays, filter, {
      onevent: (event) => {
        if (event.pubkey === this.pk) return;
        if (this.seenEventIds.has(event.id)) return;
        this.seenEventIds.add(event.id);

        try {
          const data = JSON.parse(event.content);
          const type = event.kind === KIND_SDP ? data.type : 'candidate';
          console.log(`[Signaler] RECV ${type} from ${event.pubkey.substring(0, 8)}`);
          if (event.kind === KIND_SDP) {
            onSignal({ type: data.type, data: data.sdp });
          } else {
            onSignal({ type: 'candidate', data });
          }
        } catch (e) {
          console.error('[Signaler] Parse error', e);
        }
      },
    });
  }

  async sendSignal(msg: SignalingMessage) {
    await this.ready; // ensure at least one relay is connected

    const isSDPType = msg.type === 'offer' || msg.type === 'answer';
    const eventTemplate = {
      kind: isSDPType ? KIND_SDP : KIND_ICE,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['t', this.roomId]],
      content: isSDPType
        ? JSON.stringify({ type: msg.type, sdp: msg.data })
        : JSON.stringify(msg.data),
    };

    const event = finalizeEvent(eventTemplate, this.sk);
    console.log(`[Signaler] SEND ${msg.type}`);

    const pubs = this.pool.publish(this.relays, event);
    pubs.forEach((pub, i) => {
      pub.then(() => console.log(`[Signaler] OK ${msg.type} → ${this.relays[i]}`))
         .catch(err => console.warn(`[Signaler] FAIL ${msg.type} → ${this.relays[i]}`, err.message || err));
    });
  }

  destroy() {
    this.pool.close(this.relays);
  }
}

export interface PeerCallbacks {
  onConnect: () => void;
  onData: (data: any) => void;
  onClose: () => void;
  onError: (err: Error) => void;
}

export class PeerConnection {
  public peer!: Peer.Instance;
  private signaler: NostrSignaler;
  private retryTimer?: ReturnType<typeof setInterval>;
  private destroyed = false;
  /** Resolves when peer is created and signaling is active. */
  readonly ready: Promise<void>;

  constructor(
    isInitiator: boolean,
    roomId: string,
    sk: Uint8Array,
    callbacks: PeerCallbacks,
    onRelayChange?: (count: number) => void,
    relays?: string[],
  ) {
    this.signaler = new NostrSignaler(roomId, sk, relays);

    // Track which signal types we've already processed to ignore duplicates
    let receivedOffer = false;
    let receivedAnswer = false;

    // Step 1: subscribe immediately (pool handles late-connecting relays internally)
    this.signaler.subscribe((msg) => {
      if (this.destroyed || !this.peer || this.peer.destroyed) return;

      // Only accept the first offer/answer; candidates are always accepted
      if (msg.type === 'offer') {
        if (receivedOffer) return;
        receivedOffer = true;
      } else if (msg.type === 'answer') {
        if (receivedAnswer) return;
        receivedAnswer = true;
      }

      console.log(`[WebRTC] Applying signal: ${msg.type}`);
      try {
        this.peer.signal(msg.data);
      } catch (err) {
        console.error(`[WebRTC] Signal error:`, err);
      }
    }, onRelayChange);

    // Step 2: wait for relays, THEN create peer (so subscription is active before offer is generated)
    this.ready = this.signaler.ready.then(() => {
      if (this.destroyed) return;

      this.peer = new Peer({
        initiator: isInitiator,
        trickle: true,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' },
          ],
        },
      });

      let localOffer: any = null;

      this.peer.on('signal', (data) => {
        if (this.destroyed) return;
        console.log(`[WebRTC] Signal generated: ${data.type || 'candidate'}`);
        if (data.type === 'offer') {
          localOffer = data;
          this.signaler.sendSignal({ type: 'offer', data });
        } else if (data.type === 'answer') {
          this.signaler.sendSignal({ type: 'answer', data });
        } else if ((data as any).candidate) {
          this.signaler.sendSignal({ type: 'candidate', data });
        }
      });

      this.peer.on('connect', () => {
        console.log('[WebRTC] Connected!');
        if (this.retryTimer) clearInterval(this.retryTimer);
        callbacks.onConnect();
      });

      this.peer.on('data', callbacks.onData);
      this.peer.on('close', callbacks.onClose);
      this.peer.on('error', callbacks.onError);

      // Host: re-publish offer every 15s until connected
      if (isInitiator) {
        this.retryTimer = setInterval(() => {
          if (this.destroyed || this.peer.connected) {
            clearInterval(this.retryTimer);
            return;
          }
          if (localOffer) {
            console.log('[WebRTC] Re-publishing offer...');
            this.signaler.sendSignal({ type: 'offer', data: localOffer });
          }
        }, 15000);
      }
    });
  }

  destroy() {
    this.destroyed = true;
    if (this.retryTimer) clearInterval(this.retryTimer);
    this.peer?.destroy();
    this.signaler.destroy();
  }
}
