import { useState, useEffect, useRef, useCallback } from 'react';
import { verifyEvent } from 'nostr-tools';
import { getOrCreateIdentity } from '../lib/identity';
import { GameTransport, createGameEvent, type GameEvent, type GamePayload } from '../lib/transport';
import { createGame, placeMove, checkWin, type GameState, type Ruleset, type Player } from '../lib/game';
import { useChat } from './useChat';
import { audio } from '../lib/audio';
import { copyToClipboard } from '../lib/clipboard';

// Replay and verify an ordered event chain; throws on invalid sig or broken chain.
function replayChain(events: GameEvent[], rules: Ruleset): {
  game: GameState;
  lastId: string;
  turn: Player;
  winner: Player | 0;
  wins: [number, number];
} {
  let game = createGame(rules);
  let lastId = '';
  let turn: Player = 1;
  let winner: Player | 0 = 0;
  let wins: [number, number] = [0, 0];

  for (const ev of events) {
    if (!verifyEvent(ev)) throw new Error(`Bad signature: ${ev.id}`);
    const prevId = ev.tags.find(t => t[0] === 'prev')?.[1] ?? null;
    if (prevId !== lastId) throw new Error(`Chain broken at ${ev.id.slice(0, 8)}`);
    lastId = ev.id;

    const payload = JSON.parse(ev.content) as GamePayload;
    if (payload.type === 'move') {
      const next = placeMove(game, payload.x, payload.y, payload.player);
      if (next) {
        game = next;
        const w = checkWin(next, payload.x, payload.y);
        if (w) {
          winner = w;
          wins = w === 1 ? [wins[0] + 1, wins[1]] : [wins[0], wins[1] + 1];
        }
        turn = payload.player === 1 ? 2 : 1;
      }
    } else if (payload.type === 'reset') {
      game = createGame(rules);
      winner = 0;
      turn = 1;
    }
  }
  return { game, lastId, turn, winner, wins };
}

export function useGameRoom() {
  const [identity] = useState(() => getOrCreateIdentity());
  const [roomId, setRoomId] = useState<string | null>(null);
  const [rules, setRules] = useState<Ruleset>('standard');
  const [isConnected, setIsConnected] = useState(false);
  const [myPlayer, setMyPlayer] = useState<Player | null>(null);
  const [turn, setTurn] = useState<Player>(1);
  const [winner, setWinner] = useState<Player | 0>(0);
  const [game, setGame] = useState(() => createGame('standard'));
  const [wins, setWins] = useState<[number, number]>([0, 0]);

  const chat = useChat();

  const transportRef = useRef<GameTransport | null>(null);
  const isConnectedRef = useRef(false);
  const myPlayerRef = useRef<Player | null>(null);
  const lastEventIdRef = useRef('');
  const rulesRef = useRef<Ruleset>('standard');
  const winsRef = useRef<[number, number]>([0, 0]);
  const initializedRef = useRef(false);
  const chatRef = useRef(chat);
  chatRef.current = chat;

  useEffect(() => { isConnectedRef.current = isConnected; }, [isConnected]);
  useEffect(() => { myPlayerRef.current = myPlayer; }, [myPlayer]);
  useEffect(() => { rulesRef.current = rules; }, [rules]);
  useEffect(() => { winsRef.current = wins; }, [wins]);

  const applyEvent = useCallback((ev: GameEvent) => {
    if (!verifyEvent(ev)) {
      console.warn('[Game] Invalid sig, ignoring event', ev.id);
      return;
    }
    const prevId = ev.tags.find(t => t[0] === 'prev')?.[1] ?? null;
    if (prevId !== lastEventIdRef.current) {
      console.warn('[Game] Chain gap — ignoring event', ev.id);
      return;
    }
    lastEventIdRef.current = ev.id;

    const payload = JSON.parse(ev.content) as GamePayload;

    if (payload.type === 'move') {
      const isRemote = ev.pubkey !== identity.pk;
      if (isRemote) {
        audio.playMove(false);
        window.focus();
      }
      setGame(prev => {
        const next = placeMove(prev, payload.x, payload.y, payload.player);
        if (!next) return prev;
        const win = checkWin(next, payload.x, payload.y);
        if (win) {
          setWinner(win);
          const newWins: [number, number] = win === 1
            ? [winsRef.current[0] + 1, winsRef.current[1]]
            : [winsRef.current[0], winsRef.current[1] + 1];
          setWins(newWins);
          winsRef.current = newWins;
          const isMyWin = win === myPlayerRef.current;
          chatRef.current.addSystem(isMyWin ? '🏆 You win!' : '💀 You lost. Better luck next time!');
          if (isMyWin) audio.playWin(); else audio.playLose();
        }
        setTurn(payload.player === 1 ? 2 : 1);
        return next;
      });
    } else if (payload.type === 'chat') {
      audio.playMessage();
      chatRef.current.addUser(payload.text, ev.pubkey, ev.pubkey === identity.pk);
    } else if (payload.type === 'reset') {
      if (ev.pubkey !== identity.pk) chatRef.current.addSystem('🔄 Opponent started a new game.');
      setGame(createGame(rulesRef.current));
      setWinner(0);
      setTurn(1);
    }
  }, [identity.pk]);

  const initRoom = useCallback((rId: string, rls: Ruleset) => {
    setRoomId(rId);
    setRules(rls);
    rulesRef.current = rls;
    setGame(createGame(rls));
    setWinner(0);
    setTurn(1);
    setIsConnected(false);
    setMyPlayer(null);
    myPlayerRef.current = null;
    lastEventIdRef.current = '';

    transportRef.current?.destroy();

    transportRef.current = new GameTransport(rId, identity.pk, {
      onAssign: (color, opponentPk) => {
        setMyPlayer(color);
        myPlayerRef.current = color;
        if (opponentPk) {
          setIsConnected(true);
        }
      },
      onJoined: () => {
        setIsConnected(true);
        chatRef.current.addSystem('🟢 Opponent connected. Game started!');
      },
      onHistory: (events) => {
        try {
          const state = replayChain(events, rulesRef.current);
          lastEventIdRef.current = state.lastId;
          setGame(state.game);
          setTurn(state.turn);
          setWinner(state.winner);
          setWins(state.wins);
          winsRef.current = state.wins;
          if (events.length > 0) {
            chatRef.current.addSystem(`♻️ Replayed ${events.length} event(s) from history.`);
          }
        } catch (e) {
          chatRef.current.addSystem(`⚠️ History chain invalid: ${(e as Error).message}`);
        }
      },
      onEvent: applyEvent,
      onClose: () => {
        setIsConnected(false);
        chatRef.current.addSystem('🔴 Disconnected — reconnecting…');
      },
      onError: (err) => console.error('[Transport]', err),
    });
  }, [identity.sk, identity.pk, applyEvent]);

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
    return () => { transportRef.current?.destroy(); };
  }, []);

  const sendPayload = useCallback((payload: GamePayload) => {
    const conn = transportRef.current;
    const rId = roomId;
    if (!conn || !isConnectedRef.current || !rId) return;
    const event = createGameEvent(payload, identity.sk, rId, lastEventIdRef.current);
    lastEventIdRef.current = event.id;
    conn.sendEvent(event);
    // Also apply locally so local state updates immediately
    applyEvent(event);
  }, [identity.sk, roomId, applyEvent]);

  const startAsHost = useCallback((selectedRules: Ruleset) => {
    const rId = Math.random().toString(36).substring(2, 10);
    const params = new URLSearchParams();
    params.set('room', rId);
    params.set('rules', selectedRules);
    window.location.hash = params.toString();
    initRoom(rId, selectedRules);
    chatRef.current.addSystem(`🏠 Room ${rId} ready — share the invite link.`);
  }, [initRoom]);

  const handleMove = useCallback((x: number, y: number) => {
    if (!isConnectedRef.current || winner !== 0 || turn !== myPlayerRef.current) return;
    const next = placeMove(game, x, y, myPlayerRef.current!);
    if (!next) { chatRef.current.addSystem('⚠️ Invalid move.'); return; }
    audio.playMove(true);
    sendPayload({ type: 'move', x, y, player: myPlayerRef.current! });
  }, [winner, turn, game, sendPayload]);

  const handleSendMessage = useCallback((text: string) => {
    sendPayload({ type: 'chat', text });
  }, [sendPayload]);

  const copyInvite = useCallback(() => {
    copyToClipboard(window.location.href).then(ok => {
      chatRef.current.addSystem(ok ? '📋 Invite link copied.' : '⚠️ Failed to copy link.');
    });
  }, []);

  const requestReset = useCallback(() => {
    if (!isConnectedRef.current) return;
    sendPayload({ type: 'reset' });
    chatRef.current.addSystem('🔄 You started a new game.');
  }, [sendPayload]);

  return {
    identity, roomId, rules, isConnected,
    myPlayer, turn, winner, game, wins, chat,
    startAsHost, handleMove, handleSendMessage,
    copyInvite, requestReset,
  };
}
