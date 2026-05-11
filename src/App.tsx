import { useState } from 'react';
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
    startAsHost, handleMove, handleSendMessage,
    copyInvite, requestReset,
  } = useGameRoom();

  const [selectedRules, setSelectedRules] = useState<Ruleset>('standard');

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
