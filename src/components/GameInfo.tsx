import React from 'react';
import type { Player, Ruleset } from '../lib/game';

interface GameInfoProps {
  identity: { pk: string };
  myPlayer: Player | null;
  turn: Player;
  winner: Player | 0;
  isConnected: boolean;
  isGameStarted: boolean;
  rules: Ruleset;
  wins: [number, number]; // [black, white]
  roomId: string | null;
  onCopyInvite: () => void;
  // Lobby
  onHostGame?: (rules: Ruleset) => void;
  selectedRules?: Ruleset;
  onSelectRules?: (r: Ruleset) => void;
  serverUrl?: string;
  onServerUrlChange?: (url: string) => void;
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

function connDotClass(isConnected: boolean, isGameStarted: boolean): string {
  if (isGameStarted) return 'green';
  if (isConnected) return 'yellow';
  return 'red';
}

function connLabel(isConnected: boolean, isGameStarted: boolean, isHost: boolean, myPlayer: Player | null): string {
  if (isGameStarted) return myPlayer ? 'In game' : 'Observing';
  if (isConnected) return isHost ? 'Waiting for opponent…' : 'Waiting for host…';
  return 'Connecting…';
}

const GameInfo: React.FC<GameInfoProps> = ({
  identity, myPlayer, turn, winner, isConnected, isGameStarted,
  rules, wins, roomId, onCopyInvite, onHostGame, selectedRules, onSelectRules,
  serverUrl, onServerUrlChange,
}) => {
  const isHost = myPlayer === 1;
  const dotClass = connDotClass(isConnected, isGameStarted);

  // Truncate invite URL for display
  const inviteDisplay = React.useMemo(() => {
    const url = window.location.href;
    const hashIdx = url.indexOf('#');
    if (hashIdx < 0) return url;
    const base = url.substring(0, hashIdx);
    const hash = url.substring(hashIdx);
    return hash.length > 40 ? `${base}#${hash.substring(1, 30)}…` : url;
  }, [roomId]);

  return (
    <div className="info-panel">
      {!roomId && onHostGame && selectedRules !== undefined && onSelectRules ? (
        // ── Lobby mode ──
        <>
          <section className="info-section">
            <h3 className="info-label">Your Identity</h3>
            <div className="identity-box">
              <div className={`player-stone ${myPlayer === 1 ? 'black' : myPlayer === 2 ? 'white' : 'none'}`} />
              <span className="identity-pk">{identity.pk.substring(0, 16)}…</span>
            </div>
          </section>
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
            {onServerUrlChange && serverUrl !== undefined && (
              <>
                <label className="rule-label">Server URL</label>
                <input
                  className="rule-select"
                  type="text"
                  value={serverUrl}
                  onChange={e => onServerUrlChange(e.target.value)}
                  spellCheck={false}
                />
              </>
            )}
            <button className="btn-primary" onClick={() => onHostGame(selectedRules)}>
              ⚔️ Host Game
            </button>
          </section>
        </>
      ) : (
        // ── In-game mode ──
        <>
          {/* Compact info grid (collapses on mobile) */}
          <section className="info-section info-compact">
            <div className="compact-grid">
              {/* Identity */}
              <div className="compact-item">
                <span className="compact-label">ID</span>
                <div className="identity-box">
                  <div className={`player-stone small ${myPlayer === 1 ? 'black' : myPlayer === 2 ? 'white' : 'none'}`} />
                  <span className="identity-pk">{identity.pk.substring(0, 10)}…</span>
                </div>
              </div>
              {/* Connection */}
              <div className="compact-item">
                <span className="compact-label">Status</span>
                <div className="conn-indicator">
                  <span className={`conn-dot ${dotClass}`} />
                  <span className="conn-text">{connLabel(isConnected, isGameStarted, isHost, myPlayer)}</span>
                </div>
              </div>
              {/* Rules */}
              <div className="compact-item">
                <span className="compact-label">Rules</span>
                <span className="rules-badge">{rules === 'renju' ? 'Renju' : 'Standard'}</span>
              </div>
              {/* Role */}
              <div className="compact-item">
                <span className="compact-label">Role</span>
                <span className={`role-badge ${myPlayer ? 'player' : 'observer'}`}>
                  {myPlayer === 1 ? '⚫ Black' : myPlayer === 2 ? '⚪ White' : '👁️ Observer'}
                </span>
              </div>
              {/* Room */}
              <div className="compact-item">
                <span className="compact-label">Room</span>
                <span className="room-id">{roomId}</span>
              </div>
            </div>
          </section>

          {/* Players + Score — always visible */}
          <section className="info-section">
            <div className="players-score-row">
              <PlayerBadge player={1} label={`Black${myPlayer === 1 ? ' (You)' : ''}`}
                isActive={!winner && turn === 1} isWinner={winner === 1} />
              <div className="score-inline">
                <span className="score-num">{wins[0]}</span>
                <span className="score-sep">–</span>
                <span className="score-num">{wins[1]}</span>
              </div>
              <PlayerBadge player={2} label={`White${myPlayer === 2 ? ' (You)' : ''}`}
                isActive={!winner && turn === 2} isWinner={winner === 2} />
            </div>
          </section>

          {/* Invite link (host only, not connected) */}
          {!isConnected && isHost && (
            <section className="info-section">
              <h3 className="info-label">Invite</h3>
              <p className="invite-hint">Share this link with your opponent:</p>
              <div className="invite-url">{inviteDisplay}</div>
              <button className="btn-primary" onClick={onCopyInvite}>
                📋 Copy Invite Link
              </button>
            </section>
          )}
        </>
      )}
    </div>
  );
};

export default GameInfo;
