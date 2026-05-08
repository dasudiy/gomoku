import { useState, useEffect, useRef, useCallback } from 'react';
import { getOrCreateIdentity, signPayload, verifyPayload, getPayloadFromEvent } from '../lib/identity';
import { PeerConnection, decompressSignals } from '../lib/transport';
import { createGame, placeMove, checkWin, type Ruleset, type Player } from '../lib/game';
import { useChat } from './useChat';
import { audio } from '../lib/audio';

export function useGameRoom() {
  const [identity] = useState(() => getOrCreateIdentity());
  const [roomId, setRoomId] = useState<string | null>(null);
  const [rules, setRules] = useState<Ruleset>('standard');
  const [isConnected, setIsConnected] = useState(false);
  const [isRelayMode, setIsRelayMode] = useState(false);
  const [relayCount, setRelayCount] = useState(0);
  const [myPlayer, setMyPlayer] = useState<Player | null>(null);
  const [turn, setTurn] = useState<Player>(1);
  const [winner, setWinner] = useState<Player | 0>(0);
  const [game, setGame] = useState(() => createGame('standard'));
  const [wins, setWins] = useState<[number, number]>([0, 0]);

  // Manual exchange state
  const [mySignal, setMySignal] = useState<string | null>(null);      // compressed offer/answer to share
  const [showManualExchange, setShowManualExchange] = useState(false);  // show the manual dialog

  const chat = useChat();

  const peerConnRef = useRef<PeerConnection | null>(null);
  const isConnectedRef = useRef(false);
  const myPlayerRef = useRef<Player | null>(null);
  const seqRef = useRef(0);
  const lastReceivedSeqRef = useRef(-1);
  const initializedRef = useRef(false);
  const manualTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const chatRef = useRef(chat);
  chatRef.current = chat;

  useEffect(() => { isConnectedRef.current = isConnected; }, [isConnected]);
  useEffect(() => { myPlayerRef.current = myPlayer; }, [myPlayer]);

  const handleRemoteData = useCallback((data: any) => {
    try {
      const event = JSON.parse(data.toString());
      if (!verifyPayload(event)) return;
      const payload = getPayloadFromEvent(event);
      if (payload.seq <= lastReceivedSeqRef.current) return;
      lastReceivedSeqRef.current = payload.seq;

      if (payload.type === 'move') {
        const { x, y, player } = payload;
        audio.playMove(false);
        window.focus();
        setGame(prev => {
          const next = placeMove(prev, x, y, player);
          if (!next) return prev;
          const win = checkWin(next, x, y);
          if (win) {
            setWinner(win);
            setWins(w => win === 1 ? [w[0] + 1, w[1]] : [w[0], w[1] + 1]);
            const isMyWin = win === myPlayerRef.current;
            chatRef.current.addSystem(isMyWin ? '🏆 You win!' : '💀 You lost. Better luck next time!');
            if (isMyWin) audio.playWin(); else audio.playLose();
          }
          setTurn(player === 1 ? 2 : 1);
          return next;
        });
      } else if (payload.type === 'chat') {
        audio.playMessage();
        chatRef.current.addUser(payload.text, event.pubkey, false);
      } else if (payload.type === 'reset') {
        chatRef.current.addSystem('🔄 Opponent started a new game.');
        setGame(createGame(rules));
        setWinner(0);
        setTurn(1);
      }
    } catch (e) {
      console.error('Failed to parse peer data', e);
    }
  }, [rules]);

  const setupPeerEvents = useCallback((conn: PeerConnection) => {
    // Get our local signal (offer or answer) for manual exchange
    conn.localSignalReady.then(compressed => {
      setMySignal(compressed);
    });

    // 15s fallback: show manual exchange dialog if not connected
    manualTimeoutRef.current = setTimeout(() => {
      if (!isConnectedRef.current) {
        setShowManualExchange(true);
        chatRef.current.addSystem('⚠️ Auto-connect timed out. Use the manual exchange panel.');
      }
    }, 15000);
  }, []);

  const initRoom = useCallback((
    isHost: boolean,
    rId: string,
    rls: Ruleset,
    player: Player,
    initialSignals?: any[],
  ) => {
    setRoomId(rId);
    setRules(rls);
    setMyPlayer(player);
    myPlayerRef.current = player;
    setGame(createGame(rls));
    setWinner(0);
    setTurn(1);
    seqRef.current = 0;
    lastReceivedSeqRef.current = -1;
    setIsConnected(false);
    setIsRelayMode(false);
    setMySignal(null);
    setShowManualExchange(false);
    if (manualTimeoutRef.current) clearTimeout(manualTimeoutRef.current);

    peerConnRef.current?.destroy();

    const conn = new PeerConnection(isHost, rId, identity.sk, {
      onConnect: () => {
        setIsConnected(true);
        setShowManualExchange(false);
        if (manualTimeoutRef.current) clearTimeout(manualTimeoutRef.current);
        const viaRelay = conn.relayMode;
        setIsRelayMode(viaRelay);
        if (viaRelay) {
          chatRef.current.addSystem('🔄 WebRTC failed — connected via relay (higher latency).');
        } else {
          chatRef.current.addSystem('🟢 Opponent connected. Game started!');
        }
      },
      onData: handleRemoteData,
      onClose: () => {
        setIsConnected(false);
        chatRef.current.addSystem('🔴 Opponent disconnected.');
      },
      onError: (err) => {
        console.error('Peer error:', err);
        chatRef.current.addSystem('⚠️ Connection error — will fallback to relay.');
      },
    }, setRelayCount, undefined, initialSignals);

    peerConnRef.current = conn;
    setupPeerEvents(conn);
  }, [identity.sk, handleRemoteData, setupPeerEvents]);

  // Parse URL hash on load
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const rId = params.get('room');
    const rls = (params.get('rules') as Ruleset) || 'standard';
    const hostPk = params.get('pubkey');
    const offerEncoded = params.get('offer');

    if (!rId) return;

    if (hostPk && hostPk !== identity.pk) {
      // Guest: decompress offer from URL if present
      let initialSignals: any[] | undefined;
      if (offerEncoded) {
        try {
          initialSignals = decompressSignals(offerEncoded);
          chatRef.current.addSystem('📡 Offer found in invite link — connecting...');
        } catch {
          chatRef.current.addSystem('⚠️ Could not parse offer from invite link.');
        }
      }
      initRoom(false, rId, rls, 2, initialSignals);
    } else {
      // Host re-joined (page refresh) — recreate connection
      initRoom(true, rId, rls, 1);
    }
  }, [identity.pk, initRoom]);

  useEffect(() => {
    return () => {
      peerConnRef.current?.destroy();
      if (manualTimeoutRef.current) clearTimeout(manualTimeoutRef.current);
    };
  }, []);

  const sendPayload = useCallback(async (payload: any) => {
    const conn = peerConnRef.current;
    if (!conn || !isConnectedRef.current) return;
    const fullPayload = { ...payload, seq: seqRef.current++ };
    const signedEvent = await signPayload(fullPayload, identity.sk);
    conn.send(JSON.stringify(signedEvent));
  }, [identity.sk]);

  const startAsHost = useCallback((selectedRules: Ruleset) => {
    const rId = Math.random().toString(36).substring(2, 10);
    initRoom(true, rId, selectedRules, 1);

    // Build invite URL after offer is ready (includes compressed offer)
    peerConnRef.current?.localSignalReady.then(offerEncoded => {
      const params = new URLSearchParams();
      params.set('room', rId);
      params.set('rules', selectedRules);
      params.set('pubkey', identity.pk);
      params.set('offer', offerEncoded);
      window.location.hash = params.toString();
      chatRef.current.addSystem(`🏠 Room ${rId} ready — offer embedded in invite link.`);
      chatRef.current.addSystem('📋 Copy and share the invite link from the left panel.');
    });
  }, [identity.pk, initRoom]);

  const handleMove = useCallback((x: number, y: number) => {
    if (!isConnectedRef.current || winner !== 0 || turn !== myPlayerRef.current) return;
    setGame(prev => {
      const next = placeMove(prev, x, y, myPlayerRef.current!);
      if (!next) { chatRef.current.addSystem('⚠️ Invalid move.'); return prev; }
      audio.playMove(true);
      sendPayload({ type: 'move', x, y, player: myPlayerRef.current });
      const win = checkWin(next, x, y);
      if (win) {
        setWinner(win);
        setWins(w => win === 1 ? [w[0] + 1, w[1]] : [w[0], w[1] + 1]);
        const isMyWin = win === myPlayerRef.current;
        chatRef.current.addSystem(isMyWin ? '🏆 You win!' : '💀 You lost.');
        if (isMyWin) audio.playWin(); else audio.playLose();
      }
      setTurn(myPlayerRef.current === 1 ? 2 : 1);
      return next;
    });
  }, [winner, turn, sendPayload]);

  const handleSendMessage = useCallback((text: string) => {
    sendPayload({ type: 'chat', text });
    chatRef.current.addUser(text, identity.pk, true);
  }, [sendPayload, identity.pk]);

  const copyInvite = useCallback(() => {
    navigator.clipboard.writeText(window.location.href);
    chatRef.current.addSystem('📋 Invite link copied to clipboard.');
  }, []);

  const requestReset = useCallback(() => {
    if (!isConnectedRef.current) return;
    sendPayload({ type: 'reset' });
    chatRef.current.addSystem('🔄 You started a new game.');
    setGame(createGame(rules));
    setWinner(0);
    setTurn(1);
  }, [sendPayload, rules]);

  /** Host: apply the answer pasted by user */
  const applyManualSignal = useCallback((encoded: string) => {
    try {
      peerConnRef.current?.applyManualSignal(encoded);
      chatRef.current.addSystem('🔌 Manual signal applied — waiting for connection...');
      setShowManualExchange(false);
    } catch {
      chatRef.current.addSystem('❌ Invalid signal data. Please try again.');
    }
  }, []);

  return {
    identity, roomId, rules, isConnected, isRelayMode, relayCount,
    myPlayer, turn, winner, game, wins, chat,
    mySignal, showManualExchange,
    startAsHost, handleMove, handleSendMessage,
    copyInvite, requestReset, applyManualSignal,
  };
}
