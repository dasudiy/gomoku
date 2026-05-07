import React, { useState } from 'react';
import type { Player } from '../lib/game';
import { BOARD_SIZE } from '../lib/game';

interface BoardProps {
  board: (Player | 0)[][];
  onMove: (x: number, y: number) => void;
  disabled: boolean;
  lastMove?: { x: number; y: number } | null;
  myPlayer: Player | null;
}

// Distance between grid lines in px
const CELL = 40;
const PADDING = 28; // space for coordinate labels + half-cell margin
const BOARD_PX = PADDING * 2 + CELL * (BOARD_SIZE - 1);
const PIECE_R = 17;

// Star points for standard 15x15 board
const STAR_POINTS = [
  { x: 3, y: 3 }, { x: 11, y: 3 },
  { x: 7, y: 7 }, // tengen (center)
  { x: 3, y: 11 }, { x: 11, y: 11 },
];

const COL_LABELS = 'ABCDEFGHJKLMNOP'.split(''); // skip I (Go/Gomoku convention)

const Board: React.FC<BoardProps> = ({ board, onMove, disabled, lastMove, myPlayer }) => {
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);

  const px = (i: number) => PADDING + i * CELL;

  const handleClick = (x: number, y: number) => {
    if (!disabled && board[y][x] === 0) onMove(x, y);
  };

  return (
    <div className="board-wrapper">
      <svg
        width={BOARD_PX}
        height={BOARD_PX}
        style={{ display: 'block' }}
        onMouseLeave={() => setHover(null)}
      >
        {/* Board background */}
        <defs>
          <radialGradient id="boardGrad" cx="40%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#e8b86d" />
            <stop offset="100%" stopColor="#c8903a" />
          </radialGradient>
          <filter id="pieceShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="1.5" dy="2" stdDeviation="2" floodOpacity="0.45" />
          </filter>
          <radialGradient id="blackGrad" cx="35%" cy="30%" r="65%">
            <stop offset="0%" stopColor="#6a6a6a" />
            <stop offset="45%" stopColor="#1a1a1a" />
            <stop offset="100%" stopColor="#000" />
          </radialGradient>
          <radialGradient id="whiteGrad" cx="35%" cy="30%" r="65%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="55%" stopColor="#ebebeb" />
            <stop offset="100%" stopColor="#c8c8c8" />
          </radialGradient>
        </defs>

        <rect x={0} y={0} width={BOARD_PX} height={BOARD_PX} fill="url(#boardGrad)" rx={6} />

        {/* Grid lines */}
        {Array.from({ length: BOARD_SIZE }, (_, i) => (
          <g key={i}>
            <line x1={px(0)} y1={px(i)} x2={px(BOARD_SIZE - 1)} y2={px(i)}
              stroke="rgba(0,0,0,0.55)" strokeWidth={i === 0 || i === BOARD_SIZE - 1 ? 1.5 : 0.8} />
            <line x1={px(i)} y1={px(0)} x2={px(i)} y2={px(BOARD_SIZE - 1)}
              stroke="rgba(0,0,0,0.55)" strokeWidth={i === 0 || i === BOARD_SIZE - 1 ? 1.5 : 0.8} />
          </g>
        ))}

        {/* Star points */}
        {STAR_POINTS.map(({ x, y }) => (
          <circle key={`star-${x}-${y}`} cx={px(x)} cy={px(y)} r={3.5} fill="rgba(0,0,0,0.65)" />
        ))}

        {/* Coordinate labels */}
        {Array.from({ length: BOARD_SIZE }, (_, i) => (
          <g key={`label-${i}`}>
            <text x={px(i)} y={PADDING - 10} textAnchor="middle" fontSize={10}
              fill="rgba(0,0,0,0.5)" fontFamily="Inter, sans-serif" fontWeight="600">
              {COL_LABELS[i]}
            </text>
            <text x={PADDING - 12} y={px(i)} textAnchor="middle" dominantBaseline="middle"
              fontSize={10} fill="rgba(0,0,0,0.5)" fontFamily="Inter, sans-serif" fontWeight="600">
              {BOARD_SIZE - i}
            </text>
          </g>
        ))}

        {/* Hover ghost piece */}
        {hover && !disabled && board[hover.y][hover.x] === 0 && (
          <circle
            cx={px(hover.x)} cy={px(hover.y)} r={PIECE_R}
            fill={myPlayer === 1 ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.3)'}
            stroke={myPlayer === 1 ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.5)'}
            strokeWidth={1.5}
            style={{ pointerEvents: 'none' }}
          />
        )}

        {/* Pieces */}
        {board.map((row, y) =>
          row.map((cell, x) => {
            if (cell === 0) return null;
            const isLast = lastMove?.x === x && lastMove?.y === y;
            return (
              <g key={`piece-${x}-${y}`} style={{ animation: 'pieceIn 0.18s ease-out' }}>
                <circle
                  cx={px(x)} cy={px(y)} r={PIECE_R}
                  fill={cell === 1 ? 'url(#blackGrad)' : 'url(#whiteGrad)'}
                  filter="url(#pieceShadow)"
                />
                {/* Last move marker */}
                {isLast && (
                  <circle cx={px(x)} cy={px(y)} r={5}
                    fill={cell === 1 ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.4)'}
                  />
                )}
              </g>
            );
          })
        )}

        {/* Clickable hit areas on every intersection */}
        {Array.from({ length: BOARD_SIZE }, (_, y) =>
          Array.from({ length: BOARD_SIZE }, (_, x) => (
            <rect
              key={`hit-${x}-${y}`}
              x={px(x) - CELL / 2} y={px(y) - CELL / 2}
              width={CELL} height={CELL}
              fill="transparent"
              style={{ cursor: disabled || board[y][x] !== 0 ? 'default' : 'pointer' }}
              onClick={() => handleClick(x, y)}
              onMouseEnter={() => setHover({ x, y })}
            />
          ))
        )}
      </svg>
    </div>
  );
};

export default Board;
