import { useState, useEffect, useRef, useCallback } from 'react';
import { verifyEvent } from 'nostr-tools';
import { getOrCreateIdentity } from '../lib/identity';
import {
  GameTransport, createChainEvent, WORKER_URL,
  type GameEvent, type ChainPayload, type RoomMessage,
} from '../lib/transport';
import { createGame, placeMove, checkWin, type GameState, type Ruleset, type Player } from '../lib/game';
import { useChat } from './useChat';
import { audio } from '../lib/audio';
import { copyToClipboard } from '../lib/clipboard';

// ── Chain replay ──────────────────────────────────────────────────────────────

type ChainState = {
  game: GameState;
  lastId: string;
  blackPk: string;
  whitePk: string;
  rules: Ruleset;
  turn: Player;
  winner: Player | 0;
  wins: [number, number];
};

/** Replay and verify an ordered event chain. Throws on bad sig or broken chain. */
function replayChain(events: GameEvent[], fallbackRules: Ruleset): ChainState {
  let game = createGame(fallbackRules);
  let lastId = '';
  let blackPk = '';
  let whitePk = '';
  let rules = fallbackRules;
  let turn: Player = 1;
  let winner: Player | 0 = 0;
  let wins: [number, number] = [0, 0];

  for (const ev of events) {
    if (!verifyEvent(ev)) throw new Error(`Bad sig: ${ev.id.slice(0, 8)}`);
    const prevId = ev.tags.find(t => t[0] === 'prev')?.[1] ?? null;
    if (prevId !== lastId) throw new Error(`Chain broken at ${ev.id.slice(0, 8)}`);
    lastId = ev.id;

    const payload = JSON.parse(ev.content) as ChainPayload;

    if (payload.type === 'genesis') {
      blackPk = ev.pubkey;
      rules = payload.rules;
      game = createGame(rules);
      turn = 1;
      winner = 0;
    } else if (payload.type === 'accept') {
      whitePk = payload.opponentPk;
    } else if (payload.type === 'move') {
      if (!blackPk || !whitePk) continue;
      const expectedPk = turn === 1 ? blackPk : whitePk;
      if (ev.pubkey !== expectedPk) continue;
      const next = placeMove(game, payload.x, payload.y, turn);
      if (!next) continue;
      game = next;
      const w = checkWin(next, payload.x, payload.y);
      if (w) {
        winner = w;
        wins = w === 1 ? [wins[0] + 1, wins[1]] : [wins[0], wins[1] + 1];
      }
      turn = turn === 1 ? 2 : 1;
    } else if (payload.type === 'reset') {
      if (ev.pubkey !== blackPk && ev.pubkey !== whitePk) continue;
      game = createGame(rules);
      winner = 0;
      turn = 1;
    }
  }

  return { game, lastId, blackPk, whitePk, rules, turn, winner, wins };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useGameRoom() {
  const [identity] = useState(() => getOrCreateIdentity());
  const [serverUrl, setServerUrlState] = useState(WORKER_URL);
  const serverUrlRef = useRef(WORKER_URL);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [rules, setRules] = useState<Ruleset>('standard');
  const [myPlayer, setMyPlayer] = useState<Player | null>(null);
  const [isConnected, setIsConnected] = useState(false);   // WS open
  const [isGameStarted, setIsGameStarted] = useState(false); // both players in chain
  const [turn, setTurn] = useState<Player>(1);
  const [winner, setWinner] = useState<Player | 0>(0);
  const [game, setGame] = useState<GameState>(() => createGame('standard'));
  const [wins, setWins] = useState<[number, number]>([0, 0]);

  const chat = useChat();
  const chatRef = useRef(chat);
  chatRef.current = chat;

  const transportRef = useRef<GameTransport | null>(null);
  // Mutable refs (avoid stale closures in callbacks)
  const chainEventsRef = useRef<GameEvent[]>([]);
  const seenIdsRef = useRef(new Set<string>());
  const lastEventIdRef = useRef('');
  const blackPkRef = useRef('');
  const whitePkRef = useRef('');
  const myPlayerRef = useRef<Player | null>(null);
  const rulesRef = useRef<Ruleset>('standard');
  const turnRef = useRef<Player>(1);
  const winsRef = useRef<[number, number]>([0, 0]);
  const winnerRef = useRef<Player | 0>(0);
  const isGameStartedRef = useRef(false);
  const roomIdRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
  // Host-only: rules to publish as genesis once WS opens
  const pendingGenesisRulesRef = useRef<Ruleset | null>(null);
  // Retry sending history_request until we get genesis
  const historyRetryRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => { myPlayerRef.current = myPlayer; }, [myPlayer]);
  useEffect(() => { rulesRef.current = rules; }, [rules]);
  useEffect(() => { winnerRef.current = winner; }, [winner]);

  // ── Apply a single chain event to live state ────────────────────────────────

  const applyChainEvent = useCallback((ev: GameEvent) => {
    if (seenIdsRef.current.has(ev.id)) return;
    if (!verifyEvent(ev)) { console.warn('[Chain] Bad sig', ev.id.slice(0, 8)); return; }

    const prevId = ev.tags.find(t => t[0] === 'prev')?.[1] ?? null;
    if (prevId !== lastEventIdRef.current) {
      console.warn('[Chain] Gap: expected', lastEventIdRef.current.slice(0, 8), 'got', prevId?.slice(0, 8));
      return;
    }

    const payload = JSON.parse(ev.content) as ChainPayload;

    // Validate before accepting into chain
    if (payload.type === 'genesis' && blackPkRef.current) {
      console.warn('[Chain] Duplicate genesis'); return;
    }
    if (payload.type === 'accept' && ev.pubkey !== blackPkRef.current) {
      console.warn('[Chain] Accept from non-host'); return;
    }
    if (payload.type === 'move') {
      if (!blackPkRef.current || !whitePkRef.current) return;
      const expectedPk = turnRef.current === 1 ? blackPkRef.current : whitePkRef.current;
      if (ev.pubkey !== expectedPk) { console.warn('[Chain] Wrong player'); return; }
    }
    if (payload.type === 'reset') {
      if (ev.pubkey !== blackPkRef.current && ev.pubkey !== whitePkRef.current) return;
    }

    // Accept into chain
    seenIdsRef.current.add(ev.id);
    chainEventsRef.current = [...chainEventsRef.current, ev];
    lastEventIdRef.current = ev.id;

    // Apply state changes
    if (payload.type === 'genesis') {
      blackPkRef.current = ev.pubkey;
      const r = payload.rules;
      rulesRef.current = r;
      setRules(r);
      setGame(createGame(r));
      turnRef.current = 1;
      setTurn(1);
      winnerRef.current = 0;
      setWinner(0);
      if (ev.pubkey === identity.pk) {
        myPlayerRef.current = 1;
        setMyPlayer(1);
      }
      // Stop history retries — we now have genesis
      if (historyRetryRef.current) { clearInterval(historyRetryRef.current); historyRetryRef.current = undefined; }

    } else if (payload.type === 'accept') {
      whitePkRef.current = payload.opponentPk;
      if (payload.opponentPk === identity.pk) {
        myPlayerRef.current = 2;
        setMyPlayer(2);
      }
      isGameStartedRef.current = true;
      setIsGameStarted(true);
      audio.playJoin();
      chatRef.current.addSystem('🟢 Game started!');

    } else if (payload.type === 'move') {
      const isRemote = ev.pubkey !== identity.pk;
      if (isRemote) { audio.playMove(false); }
      const currentTurn = turnRef.current;
      setGame(prev => {
        const next = placeMove(prev, payload.x, payload.y, currentTurn);
        if (!next) return prev;
        const w = checkWin(next, payload.x, payload.y);
        if (w) {
          winnerRef.current = w;
          setWinner(w);
          const newWins: [number, number] = w === 1
            ? [winsRef.current[0] + 1, winsRef.current[1]]
            : [winsRef.current[0], winsRef.current[1] + 1];
          winsRef.current = newWins;
          setWins(newWins);
          const isMyWin = w === myPlayerRef.current;
          chatRef.current.addSystem(isMyWin ? '🏆 You win!' : '💀 You lost. Better luck next time!');
          if (isMyWin) audio.playWin(); else audio.playLose();
        }
        return next;
      });
      const nextTurn: Player = turnRef.current === 1 ? 2 : 1;
      turnRef.current = nextTurn;
      setTurn(nextTurn);

    } else if (payload.type === 'reset') {
      if (ev.pubkey !== identity.pk) chatRef.current.addSystem('🔄 Opponent started a new game.');
      setGame(createGame(rulesRef.current));
      winnerRef.current = 0;
      setWinner(0);
      turnRef.current = 1;
      setTurn(1);
    }
  }, [identity.pk]);

  // ── Process history_response: replay chain, derive full state ───────────────

  const applyHistoryResponse = useCallback((events: GameEvent[]) => {
    if (blackPkRef.current) return; // already have genesis, ignore duplicate responses
    if (events.length === 0) return;
    try {
      const state = replayChain(events, rulesRef.current);
      // Bulk-apply chain state
      chainEventsRef.current = [...events];
      seenIdsRef.current = new Set(events.map(e => e.id));
      lastEventIdRef.current = state.lastId;
      blackPkRef.current = state.blackPk;
      whitePkRef.current = state.whitePk;
      rulesRef.current = state.rules;
      turnRef.current = state.turn;
      winsRef.current = state.wins;
      winnerRef.current = state.winner;

      setRules(state.rules);
      setGame(state.game);
      setTurn(state.turn);
      setWinner(state.winner);
      setWins(state.wins);

      if (state.blackPk === identity.pk) {
        myPlayerRef.current = 1;
        setMyPlayer(1);
      } else if (state.whitePk === identity.pk) {
        myPlayerRef.current = 2;
        setMyPlayer(2);
      } else {
        myPlayerRef.current = null;
        setMyPlayer(null);
      }

      if (state.blackPk && state.whitePk) {
        isGameStartedRef.current = true;
        setIsGameStarted(true);
      }

      chatRef.current.addSystem(`♻️ Replayed ${events.length} event(s).`);

      // Stop retrying
      if (historyRetryRef.current) { clearInterval(historyRetryRef.current); historyRetryRef.current = undefined; }

      // If I'm a guest and game hasn't started yet, send join_request
      if (state.blackPk && !state.whitePk && state.blackPk !== identity.pk) {
        transportRef.current?.send({ type: 'join_request', pubkey: identity.pk });
      }
    } catch (e) {
      chatRef.current.addSystem(`⚠️ History chain invalid: ${(e as Error).message}`);
    }
  }, [identity.pk]);

  // ── Handle all messages from the relay ──────────────────────────────────────

  const handleMessage = useCallback((msg: RoomMessage) => {
    switch (msg.type) {
      case 'chain_event':
        applyChainEvent(msg.event);
        break;

      case 'join_request':
        // Auto-accept first guest if we're the host and game hasn't started
        if (identity.pk === blackPkRef.current && !whitePkRef.current && roomIdRef.current) {
          const acceptEvent = createChainEvent(
            { type: 'accept', opponentPk: msg.pubkey },
            identity.sk,
            roomIdRef.current,
            lastEventIdRef.current,
          );
          transportRef.current?.send({ type: 'chain_event', event: acceptEvent });
          applyChainEvent(acceptEvent);
        }
        break;

      case 'history_request':
        if (chainEventsRef.current.length > 0) {
          transportRef.current?.send({ type: 'history_response', events: chainEventsRef.current });
        }
        break;

      case 'history_response':
        applyHistoryResponse(msg.events);
        break;

      case 'chat':
        audio.playMessage();
        chatRef.current.addUser(msg.text, msg.pubkey, msg.pubkey === identity.pk);
        break;
    }
  }, [identity.pk, identity.sk, applyChainEvent, applyHistoryResponse]);

  // ── Initialize a room connection ─────────────────────────────────────────────

  const initRoom = useCallback((rId: string, rls: Ruleset) => {
    setRoomId(rId);
    roomIdRef.current = rId;
    setRules(rls);
    rulesRef.current = rls;
    setGame(createGame(rls));
    setTurn(1); turnRef.current = 1;
    setWinner(0); winnerRef.current = 0;
    setMyPlayer(null); myPlayerRef.current = null;
    setIsConnected(false);
    setIsGameStarted(false); isGameStartedRef.current = false;
    setWins([0, 0]); winsRef.current = [0, 0];
    chainEventsRef.current = [];
    seenIdsRef.current = new Set();
    lastEventIdRef.current = '';
    blackPkRef.current = '';
    whitePkRef.current = '';
    if (historyRetryRef.current) { clearInterval(historyRetryRef.current); historyRetryRef.current = undefined; }

    transportRef.current?.destroy();
    transportRef.current = new GameTransport(rId, {
      onOpen: () => {
        setIsConnected(true);

        // Host: publish genesis on first connect
        if (pendingGenesisRulesRef.current !== null && roomIdRef.current) {
          const genesisEvent = createChainEvent(
            { type: 'genesis', rules: pendingGenesisRulesRef.current },
            identity.sk,
            roomIdRef.current,
            '',
          );
          transportRef.current?.send({ type: 'chain_event', event: genesisEvent });
          applyChainEvent(genesisEvent);
          pendingGenesisRulesRef.current = null;
        }

        // Request history from whoever is already in the room
        transportRef.current?.send({ type: 'history_request' });

        // Retry every 5s until we receive genesis (handles host-offline-at-join case)
        historyRetryRef.current = setInterval(() => {
          if (blackPkRef.current) {
            clearInterval(historyRetryRef.current);
            historyRetryRef.current = undefined;
            return;
          }
          transportRef.current?.send({ type: 'history_request' });
        }, 5000);
      },
      onMessage: handleMessage,
      onClose: () => {
        setIsConnected(false);
        chatRef.current.addSystem('🔴 Disconnected — reconnecting…');
      },
      onError: (err) => console.error('[Transport]', err),
    }, serverUrlRef.current);
  }, [identity.sk, handleMessage, applyChainEvent]);

  // Parse URL hash on load
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const rId = params.get('room');
    const rls = (params.get('rules') as Ruleset) || 'standard';
    if (!rId) return;
    initRoom(rId, rls);
  }, [initRoom]);

  useEffect(() => {
    return () => {
      transportRef.current?.destroy();
      if (historyRetryRef.current) clearInterval(historyRetryRef.current);
    };
  }, []);

  // ── Actions ──────────────────────────────────────────────────────────────────

  const startAsHost = useCallback((selectedRules: Ruleset) => {
    const rId = Math.random().toString(36).substring(2, 10);
    pendingGenesisRulesRef.current = selectedRules;
    const params = new URLSearchParams();
    params.set('room', rId);
    params.set('rules', selectedRules);
    window.location.hash = params.toString();
    initRoom(rId, selectedRules);
    chatRef.current.addSystem('🏠 Room ready — share the invite link.');
  }, [initRoom]);

  const handleMove = useCallback((x: number, y: number) => {
    if (!isGameStartedRef.current || winnerRef.current !== 0 || turnRef.current !== myPlayerRef.current) return;
    if (!placeMove(game, x, y, myPlayerRef.current!)) { chatRef.current.addSystem('⚠️ Invalid move.'); return; }
    audio.playMove(true);
    const ev = createChainEvent({ type: 'move', x, y }, identity.sk, roomIdRef.current!, lastEventIdRef.current);
    transportRef.current?.send({ type: 'chain_event', event: ev });
    applyChainEvent(ev);
  }, [game, identity.sk, applyChainEvent]);

  const handleSendMessage = useCallback((text: string) => {
    if (!roomIdRef.current) return;
    transportRef.current?.send({ type: 'chat', text, pubkey: identity.pk });
    chatRef.current.addUser(text, identity.pk, true);
  }, [identity.pk]);

  const copyInvite = useCallback(() => {
    copyToClipboard(window.location.href).then(ok => {
      chatRef.current.addSystem(ok ? '📋 Invite link copied.' : '⚠️ Failed to copy link.');
    });
  }, []);

  const requestReset = useCallback(() => {
    if (!isGameStartedRef.current || !myPlayerRef.current) return;
    const ev = createChainEvent({ type: 'reset' }, identity.sk, roomIdRef.current!, lastEventIdRef.current);
    transportRef.current?.send({ type: 'chain_event', event: ev });
    applyChainEvent(ev);
    chatRef.current.addSystem('🔄 You started a new game.');
  }, [identity.sk, applyChainEvent]);

  const setServerUrl = useCallback((url: string) => {
    const trimmed = url.replace(/\/+$/, '');
    serverUrlRef.current = trimmed;
    setServerUrlState(trimmed);
  }, []);

  return {
    identity, roomId, rules, isConnected, isGameStarted,
    myPlayer, turn, winner, game, wins, chat,
    serverUrl, setServerUrl,
    startAsHost, handleMove, handleSendMessage,
    copyInvite, requestReset,
  };
}
