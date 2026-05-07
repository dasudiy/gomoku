import { 
  generateSecretKey, 
  getPublicKey, 
  finalizeEvent, 
  verifyEvent,
  utils,
  type EventTemplate,
  type Event
} from 'nostr-tools';

const { bytesToHex, hexToBytes } = utils;

const KEY_STORAGE_KEY = 'gomoku_nostr_sk';

export function getStoredSecretKey(): Uint8Array | null {
  const hex = localStorage.getItem(KEY_STORAGE_KEY);
  if (!hex) return null;
  try {
    return hexToBytes(hex);
  } catch (e) {
    return null;
  }
}

export function generateAndStoreKey(): Uint8Array {
  const sk = generateSecretKey();
  localStorage.setItem(KEY_STORAGE_KEY, bytesToHex(sk));
  return sk;
}

export function getOrCreateIdentity() {
  let sk = getStoredSecretKey();
  if (!sk) {
    sk = generateAndStoreKey();
  }
  const pk = getPublicKey(sk);
  return { sk, pk };
}

/**
 * Signs a payload. In a real Nostr app, we'd use NIP-07 if available.
 * For this P2P game, we sign a "pseudo-event" to reuse Nostr's signature logic.
 */
export async function signPayload(payload: any, sk: Uint8Array): Promise<Event> {
  const template: EventTemplate = {
    kind: 29003, // Custom kind for game data
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify(payload),
  };

  // If window.nostr is available, we could use it here.
  // But for now, we use the local key.
  return finalizeEvent(template, sk);
}

export function verifyPayload(event: Event): boolean {
  return verifyEvent(event);
}

export function getPayloadFromEvent(event: Event): any {
  try {
    return JSON.parse(event.content);
  } catch (e) {
    return null;
  }
}
