import { useState } from 'react';
import './App.css';
import { useGameRoom } from './hooks/useGameRoom';
import type { Ruleset } from './lib/game';
import Board from './components/Board';
import Chat from './components/Chat';
import GameInfo from './components/GameInfo';
import ManualExchange from './components/ManualExchange';

function App() {
  const {
    identity, roomId, rules, isConnected, isRelayMode, relayCount,
    myPlayer, turn, winner, game, wins, chat,
    mySignal, showManualExchange,
    startAsHost, handleMove, handleSendMessage,
    copyInvite, requestReset, applyManualSignal,
  } = useGameRoom();

  const [selectedRules, setSelectedRules] = useState<Ruleset>('standard');
  const [showManualPanel, setShowManualPanel] = useState(false);

  const lastMove = game.moves.length > 0
    ? { x: game.moves[game.moves.length - 1].x, y: game.moves[game.moves.length - 1].y }
    : null;

  const showExchange = showManualExchange || showManualPanel;

  return (
    <div className="app-root">
      {/* Header */}
      <header className="app-header">
        <div className="header-title">
          <span className="header-icon">⬤</span>
          <h1>Gomoku</h1>
          <span className="header-sub">P2P · Nostr · WebRTC</span>
        </div>
        <div className="header-status">
          {roomId && winner !== 0 ? (
            <span className="status-winner">
              {winner === myPlayer ? '🏆 You Win!' : '💀 Opponent Wins'}
            </span>
          ) : roomId && isConnected ? (
            <span className={`status-turn ${turn === myPlayer ? 'my-turn' : 'their-turn'}`}>
              {turn === myPlayer ? '▶ Your Turn' : '⏳ Opponent\'s Turn'}
            </span>
          ) : roomId ? (
            <span className="status-waiting">⏳ Waiting for opponent…</span>
          ) : null}
          {/* Manual exchange button when in a room but not connected */}
          {roomId && !isConnected && mySignal && (
            <button
              className="btn-manual-trigger"
              onClick={() => setShowManualPanel(v => !v)}
              title="Manual connection exchange"
            >
              🔌 Manual
            </button>
          )}
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
            isRelayMode={isRelayMode}
            relayCount={relayCount}
            rules={rules}
            wins={wins}
            roomId={roomId}
            inviteReady={!!mySignal}
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
                disabled={!isConnected || turn !== myPlayer || winner !== 0}
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

        {/* Right: Chat */}
        <aside className="panel right-panel">
          <Chat
            messages={chat.messages}
            onSendMessage={handleSendMessage}
            bottomRef={chat.bottomRef}
            disabled={!isConnected}
          />
        </aside>
      </main>

      {/* Manual Exchange overlay */}
      {showExchange && (
        <ManualExchange
          mySignal={mySignal}
          isHost={myPlayer === 1}
          onApply={applyManualSignal}
          onDismiss={() => { setShowManualPanel(false); }}
        />
      )}
    </div>
  );
}

export default App;
