import { useState, useEffect, useRef, useCallback } from 'react';
import { getOrCreateIdentity, signPayload, verifyPayload, getPayloadFromEvent } from '../lib/identity';
import { PeerConnection } from '../lib/transport';
import { createGame, placeMove, checkWin, type Ruleset, type Player } from '../lib/game';
import { useChat } from './useChat';

export function useGameRoom() {
  const [identity] = useState(() => getOrCreateIdentity());
  const [roomId, setRoomId] = useState<string | null>(null);
  const [rules, setRules] = useState<Ruleset>('standard');
  const [isConnected, setIsConnected] = useState(false);
  const [relayCount, setRelayCount] = useState(0);
  const [myPlayer, setMyPlayer] = useState<Player | null>(null);
  const [turn, setTurn] = useState<Player>(1);
  const [winner, setWinner] = useState<Player | 0>(0);
  const [game, setGame] = useState(() => createGame('standard'));
  const [wins, setWins] = useState<[number, number]>([0, 0]);

  const chat = useChat();

  // Refs for values read inside callbacks to avoid stale closures
  const peerConnRef = useRef<PeerConnection | null>(null);
  const isConnectedRef = useRef(false);
  const myPlayerRef = useRef<Player | null>(null);
  const seqRef = useRef(0);
  const lastReceivedSeqRef = useRef(-1);
  const initializedRef = useRef(false);
  // Stable refs for chat functions (avoids callback chain instability)
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
        setGame(prev => {
          const next = placeMove(prev, x, y, player);
          if (!next) return prev;
          const win = checkWin(next, x, y);
          if (win) {
            setWinner(win);
            setWins(w => win === 1 ? [w[0] + 1, w[1]] : [w[0], w[1] + 1]);
            chatRef.current.addSystem(win === myPlayerRef.current ? '🏆 You win!' : '💀 You lost. Better luck next time!');
          }
          setTurn(player === 1 ? 2 : 1);
          return next;
        });
      } else if (payload.type === 'chat') {
        chatRef.current.addUser(payload.text, event.pubkey, false);
      }
    } catch (e) {
      console.error('Failed to parse peer data', e);
    }
  }, []);

  const initRoom = useCallback((isHost: boolean, rId: string, rls: Ruleset, player: Player) => {
    setRoomId(rId);
    setRules(rls);
    setMyPlayer(player);
    myPlayerRef.current = player;
    setGame(createGame(rls));
    setWinner(0);
    setTurn(1);
    seqRef.current = 0;
    lastReceivedSeqRef.current = -1;

    peerConnRef.current?.destroy();

    const conn = new PeerConnection(isHost, rId, identity.sk, {
      onConnect: () => {
        setIsConnected(true);
        chatRef.current.addSystem('🟢 Opponent connected. Game started!');
      },
      onData: handleRemoteData,
      onClose: () => {
        setIsConnected(false);
        chatRef.current.addSystem('🔴 Opponent disconnected.');
      },
      onError: (err) => {
        console.error('Peer error:', err);
        chatRef.current.addSystem('⚠️ Connection error.');
      },
    }, setRelayCount);

    peerConnRef.current = conn;
  }, [identity.sk, handleRemoteData]);

  // Parse URL hash on load
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const rId = params.get('room');
    const rls = (params.get('rules') as Ruleset) || 'standard';
    const hostPk = params.get('pubkey');

    if (rId) {
      if (hostPk && hostPk !== identity.pk) {
        initRoom(false, rId, rls, 2);
      } else {
        initRoom(true, rId, rls, 1);
      }
    }
  }, [identity.pk, initRoom]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { peerConnRef.current?.destroy(); };
  }, []);

  const sendPayload = useCallback(async (payload: any) => {
    const conn = peerConnRef.current;
    if (!conn?.peer || conn.peer.destroyed || !isConnectedRef.current) return;
    const fullPayload = { ...payload, seq: seqRef.current++ };
    const signedEvent = await signPayload(fullPayload, identity.sk);
    conn.peer.send(JSON.stringify(signedEvent));
  }, [identity.sk]);

  const startAsHost = useCallback((selectedRules: Ruleset) => {
    const rId = Math.random().toString(36).substring(2, 10);
    initRoom(true, rId, selectedRules, 1);

    const inviteParams = new URLSearchParams();
    inviteParams.set('room', rId);
    inviteParams.set('rules', selectedRules);
    inviteParams.set('pubkey', identity.pk);
    window.location.hash = inviteParams.toString();

    setTimeout(() => {
      chatRef.current.addSystem(`🏠 Room created: ${rId}`);
      chatRef.current.addSystem('📋 Copy the invite link and share it with your opponent.');
    }, 50);
  }, [identity.pk, initRoom]);

  const handleMove = useCallback((x: number, y: number) => {
    if (!isConnectedRef.current || winner !== 0 || turn !== myPlayerRef.current) return;

    setGame(prev => {
      const next = placeMove(prev, x, y, myPlayerRef.current!);
      if (!next) {
        chatRef.current.addSystem('⚠️ Invalid move.');
        return prev;
      }
      sendPayload({ type: 'move', x, y, player: myPlayerRef.current });
      const win = checkWin(next, x, y);
      if (win) {
        setWinner(win);
        setWins(w => win === 1 ? [w[0] + 1, w[1]] : [w[0], w[1] + 1]);
        chatRef.current.addSystem(win === myPlayerRef.current ? '🏆 You win!' : '💀 You lost.');
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

  return {
    identity, roomId, rules, isConnected, relayCount,
    myPlayer, turn, winner, game, wins, chat,
    startAsHost, handleMove, handleSendMessage, copyInvite,
  };
}
