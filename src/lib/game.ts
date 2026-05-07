export type Player = 1 | 2; // 1: Black, 2: White
export type Ruleset = 'standard' | 'renju';

export const BOARD_SIZE = 15;

export interface Move {
  x: number;
  y: number;
  player: Player;
}

export interface GameState {
  board: (Player | 0)[][];
  moves: Move[];
  ruleset: Ruleset;
}

export function createGame(ruleset: Ruleset = 'standard'): GameState {
  return {
    ruleset,
    moves: [],
    board: Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(0)),
  };
}

/** Returns new state if move is valid, null if forbidden/occupied. */
export function placeMove(state: GameState, x: number, y: number, player: Player): GameState | null {
  if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return null;
  if (state.board[y][x] !== 0) return null;

  if (state.ruleset === 'renju' && player === 1) {
    if (isForbiddenMove(state, x, y)) return null;
  }

  const newBoard = state.board.map(r => [...r]);
  newBoard[y][x] = player;
  return { ...state, board: newBoard, moves: [...state.moves, { x, y, player }] };
}

export function checkWin(state: GameState, x: number, y: number): Player | 0 {
  const player = state.board[y][x];
  if (player === 0) return 0;

  const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];

  for (const [dx, dy] of directions) {
    let count = 1;
    for (let i = 1; i < 5; i++) {
      const nx = x + dx * i, ny = y + dy * i;
      if (inBounds(nx, ny) && state.board[ny][nx] === player) count++;
      else break;
    }
    for (let i = 1; i < 5; i++) {
      const nx = x - dx * i, ny = y - dy * i;
      if (inBounds(nx, ny) && state.board[ny][nx] === player) count++;
      else break;
    }

    // Renju: black wins only with exactly 5; overline is a loss
    if (state.ruleset === 'renju' && player === 1) {
      if (count === 5) return 1;
    } else {
      if (count >= 5) return player;
    }
  }

  return 0;
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
}

function countInDirection(state: GameState, x: number, y: number, dx: number, dy: number, player: Player): number {
  let count = 0;
  let nx = x + dx, ny = y + dy;
  while (inBounds(nx, ny) && state.board[ny][nx] === player) {
    count++;
    nx += dx;
    ny += dy;
  }
  return count;
}

function isForbiddenMove(state: GameState, x: number, y: number): boolean {
  // Temporarily place the stone to evaluate
  const testBoard = state.board.map(r => [...r]);
  testBoard[y][x] = 1;
  const testState = { ...state, board: testBoard };

  if (checkOverline(testState, x, y)) return true;
  if (checkDoubleFour(testState, x, y)) return true;
  if (checkDoubleThree(testState, x, y)) return true;

  return false;
}

function checkOverline(state: GameState, x: number, y: number): boolean {
  const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (const [dx, dy] of directions) {
    const count = 1 + countInDirection(state, x, y, dx, dy, 1) + countInDirection(state, x, y, -dx, -dy, 1);
    if (count > 5) return true;
  }
  return false;
}

function checkDoubleFour(state: GameState, x: number, y: number): boolean {
  const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
  let fourCount = 0;
  for (const [dx, dy] of directions) {
    if (hasFourInDirection(state, x, y, dx, dy)) fourCount++;
  }
  return fourCount >= 2;
}

/** A "four" = 4 in a row with at least one open end that could become 5. */
function hasFourInDirection(state: GameState, x: number, y: number, dx: number, dy: number): boolean {
  const fwd = countInDirection(state, x, y, dx, dy, 1);
  const bwd = countInDirection(state, x, y, -dx, -dy, 1);
  const total = 1 + fwd + bwd;
  return total === 4;
}

function checkDoubleThree(state: GameState, x: number, y: number): boolean {
  const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
  let threeCount = 0;
  for (const [dx, dy] of directions) {
    if (hasOpenThreeInDirection(state, x, y, dx, dy)) threeCount++;
  }
  return threeCount >= 2;
}

/** An "open three" = 3 in a row with both ends open. */
function hasOpenThreeInDirection(state: GameState, x: number, y: number, dx: number, dy: number): boolean {
  const fwd = countInDirection(state, x, y, dx, dy, 1);
  const bwd = countInDirection(state, x, y, -dx, -dy, 1);
  const total = 1 + fwd + bwd;
  if (total !== 3) return false;

  // Check both ends are open
  const frontX = x + dx * (fwd + 1), frontY = y + dy * (fwd + 1);
  const backX = x - dx * (bwd + 1), backY = y - dy * (bwd + 1);
  const frontOpen = inBounds(frontX, frontY) && state.board[frontY][frontX] === 0;
  const backOpen = inBounds(backX, backY) && state.board[backY][backX] === 0;

  return frontOpen && backOpen;
}
