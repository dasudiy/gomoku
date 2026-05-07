import React from 'react';
import type { Player, Ruleset } from '../lib/game';

interface GameInfoProps {
  identity: { pk: string };
  myPlayer: Player | null;
  turn: Player;
  winner: Player | 0;
  isConnected: boolean;
  relayCount: number;
  rules: Ruleset;
  wins: [number, number]; // [black, white]
  roomId: string | null;
  onCopyInvite: () => void;
  // Lobby
  onHostGame?: (rules: Ruleset) => void;
  selectedRules?: Ruleset;
  onSelectRules?: (r: Ruleset) => void;
}

const PlayerBadge: React.FC<{ player: Player; label: string; isActive: boolean; isWinner: boolean }> = (
  { player, label, isActive, isWinner }
) => (
  <div className={`player-badge ${isActive ? 'active' : ''} ${isWinner ? 'winner' : ''}`}>
    <div className={`player-stone ${player === 1 ? 'black' : 'white'}`} />
    <span className="player-label">{label}</span>
    {isWinner && <span className="badge-crown">👑</span>}
    {isActive && !isWinner && <span className="badge-turn">▶</span>}
  </div>
);

const GameInfo: React.FC<GameInfoProps> = ({
  identity, myPlayer, turn, winner, isConnected, relayCount,
  rules, wins, roomId, onCopyInvite, onHostGame, selectedRules, onSelectRules,
}) => {
  return (
    <div className="info-panel">
      {/* Identity */}
      <section className="info-section">
        <h3 className="info-label">Your Identity</h3>
        <div className="identity-box">
          <div className={`player-stone ${myPlayer === 1 ? 'black' : myPlayer === 2 ? 'white' : 'none'}`} />
          <span className="identity-pk">{identity.pk.substring(0, 16)}…</span>
        </div>
        <div className="relay-row">
          <span className={`relay-dot ${relayCount > 0 ? 'green' : 'red'}`} />
          <span className="relay-text">{relayCount} relay{relayCount !== 1 ? 's' : ''} connected</span>
        </div>
      </section>

      {!roomId && onHostGame && selectedRules !== undefined && onSelectRules ? (
        // Lobby mode
        <section className="info-section lobby-section">
          <h3 className="info-label">New Game</h3>
          <label className="rule-label">Ruleset</label>
          <select
            className="rule-select"
            value={selectedRules}
            onChange={e => onSelectRules(e.target.value as Ruleset)}
          >
            <option value="standard">Standard (无禁手)</option>
            <option value="renju">Renju (有禁手, simplified)</option>
          </select>
          <button className="btn-primary" onClick={() => onHostGame(selectedRules)}>
            ⚔️ Host Game
          </button>
        </section>
      ) : (
        <>
          {/* Connection / Invite */}
          <section className="info-section">
            <h3 className="info-label">Connection</h3>
            <div className={`conn-status ${isConnected ? 'connected' : 'waiting'}`}>
              <span className="conn-dot" />
              {isConnected ? 'Connected' : myPlayer === 1 ? 'Waiting for opponent…' : 'Connecting…'}
            </div>
            {!isConnected && myPlayer === 1 && (
              <div className="invite-section">
                <p className="invite-hint">Share this link with your opponent:</p>
                <div className="invite-url">{window.location.href}</div>
                <button className="btn-primary" onClick={onCopyInvite}>📋 Copy Invite Link</button>
              </div>
            )}
          </section>


          {/* Rules */}
          <section className="info-section">
            <h3 className="info-label">Rules</h3>
            <span className="rules-badge">{rules === 'renju' ? 'Renju (有禁手)' : 'Standard (无禁手)'}</span>
          </section>

          {/* Players */}
          <section className="info-section">
            <h3 className="info-label">Players</h3>
            <PlayerBadge player={1} label={`Black${myPlayer === 1 ? ' (You)' : ''}`}
              isActive={!winner && turn === 1} isWinner={winner === 1} />
            <PlayerBadge player={2} label={`White${myPlayer === 2 ? ' (You)' : ''}`}
              isActive={!winner && turn === 2} isWinner={winner === 2} />
          </section>

          {/* Score */}
          <section className="info-section">
            <h3 className="info-label">Score</h3>
            <div className="score-row">
              <div className="score-block">
                <div className="player-stone black" />
                <span className="score-num">{wins[0]}</span>
              </div>
              <span className="score-sep">–</span>
              <div className="score-block">
                <div className="player-stone white" />
                <span className="score-num">{wins[1]}</span>
              </div>
            </div>
          </section>

          {/* Room ID */}
          <section className="info-section">
            <h3 className="info-label">Room</h3>
            <span className="room-id">{roomId}</span>
          </section>
        </>
      )}
    </div>
  );
};

export default GameInfo;
