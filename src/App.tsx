import { useState, useEffect } from 'react';
import './App.css';
import { useGameRoom } from './hooks/useGameRoom';
import type { Ruleset } from './lib/game';
import Board from './components/Board';
import Chat from './components/Chat';
import GameInfo from './components/GameInfo';

function App() {
  const {
    identity, roomId, rules, isConnected, isGameStarted,
    myPlayer, turn, winner, game, wins, chat,
    serverUrl, setServerUrl,
    startAsHost, handleMove, handleSendMessage,
    copyInvite, requestReset,
  } = useGameRoom();

  const [selectedRules, setSelectedRules] = useState<Ruleset>('standard');

  // Flash document title when it's my turn and the window isn't focused
  useEffect(() => {
    const isMyTurn = isGameStarted && winner === 0 && myPlayer !== null && turn === myPlayer;
    if (!isMyTurn) { document.title = 'Gomoku'; return; }
    if (document.hasFocus()) return;
    const labels = ['▶ Your Turn! — Gomoku', 'Gomoku'];
    let idx = 0;
    const timer = setInterval(() => { document.title = labels[idx++ % 2]; }, 700);
    const onFocus = () => { document.title = 'Gomoku'; };
    window.addEventListener('focus', onFocus, { once: true });
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); document.title = 'Gomoku'; };
  }, [turn, myPlayer, isGameStarted, winner]);

  const lastMove = game.moves.length > 0
    ? { x: game.moves[game.moves.length - 1].x, y: game.moves[game.moves.length - 1].y }
    : null;

  return (
    <div className="app-root">
      {/* Header */}
      <header className="app-header">
        <div className="header-title">
          <span className="header-icon">⬤</span>
          <h1>Gomoku</h1>
          <span className="header-sub">Cloudflare · Nostr</span>
        </div>
        <div className="header-status">
          <a
            className="header-github"
            href="https://github.com/dasudiy/gomoku"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub repository"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
            </svg>
          </a>
          {roomId && winner !== 0 ? (
            <span className="status-winner">
              {winner === myPlayer ? '🏆 You Win!' : '💀 Opponent Wins'}
            </span>
          ) : roomId && isGameStarted ? (
            <span className={`status-turn ${turn === myPlayer ? 'my-turn' : 'their-turn'}`}>
              {turn === myPlayer ? '▶ Your Turn' : '⏳ Opponent\'s Turn'}
            </span>
          ) : roomId ? (
            <span className="status-waiting">⏳ Waiting for opponent…</span>
          ) : null}
        </div>
      </header>

      {/* Main 3-column layout */}
      <main className="app-main">
        {/* Left: Game Info */}
        <aside className="panel left-panel">
          <GameInfo
            identity={identity}
            myPlayer={myPlayer}
            turn={turn}
            winner={winner}
            isConnected={isConnected}
            isGameStarted={isGameStarted}
            rules={rules}
            wins={wins}
            roomId={roomId}
            onCopyInvite={copyInvite}
            onHostGame={!roomId ? startAsHost : undefined}
            selectedRules={!roomId ? selectedRules : undefined}
            onSelectRules={!roomId ? setSelectedRules : undefined}
            serverUrl={!roomId ? serverUrl : undefined}
            onServerUrlChange={!roomId ? setServerUrl : undefined}
          />
        </aside>

        {/* Center: Board */}
        <section className="board-area">
          {roomId ? (
            <div className="board-centering">
              <Board
                board={game.board}
                onMove={handleMove}
                disabled={!isGameStarted || turn !== myPlayer || winner !== 0}
                lastMove={lastMove}
                myPlayer={myPlayer}
              />
              {winner !== 0 && (
                <div className="game-over-overlay">
                  <div className="game-over-modal">
                    <h2>{winner === myPlayer ? '🎉 You Win!' : '💀 You Lose'}</h2>
                    <p>{winner === myPlayer ? 'Congratulations on your victory!' : 'Better luck next time.'}</p>
                    <button className="btn-primary" onClick={requestReset}>
                      🔄 Next Game
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="waiting-illustration">
              <div className="waiting-board-preview" />
              <p className="waiting-hint">Host a game to begin</p>
            </div>
          )}
        </section>

        {/* Right: Chat — available to all room participants including observers */}
        <aside className="panel right-panel">
          <Chat
            messages={chat.messages}
            onSendMessage={handleSendMessage}
            bottomRef={chat.bottomRef}
            disabled={!roomId}
          />
        </aside>
      </main>
    </div>
  );
}

export default App;
