// Move-by-move review: turns engine output into classifications, accuracy and comments.
// Thresholds are expected-points losses, so "win chance" below also counts draws as half.
import { Chess } from "chess.js";

export const CLASSIFICATIONS = {
  great: { label: "Great", glyph: "!" },
  best: { label: "Best", glyph: "★" },
  excellent: { label: "Excellent", glyph: "✓" },
  good: { label: "Good", glyph: "✓" },
  inaccuracy: { label: "Inaccuracy", glyph: "?!" },
  mistake: { label: "Mistake", glyph: "?" },
  blunder: { label: "Blunder", glyph: "??" },
};

const GREAT_MOVE_GAP = 15;
const GREAT_MOVE_MIN_CHANCE = 30;

export function parseGame(pgn, startFen) {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const moves = chess.history({ verbose: true });
  return {
    startFen: moves[0]?.before ?? startFen ?? chess.fen(),
    moves: moves.map((move, index) => ({
      ply: index + 1,
      moveNumber: Math.floor(index / 2) + 1,
      color: move.color === "w" ? "white" : "black",
      san: move.san,
      uci: move.lan,
      from: move.from,
      to: move.to,
      captured: move.captured ?? null,
      fenBefore: move.before,
      fenAfter: move.after,
    })),
  };
}

// Parses a UCI "info" line. Bound scores and lines without a pv aren't usable results.
export function parseInfoLine(line) {
  if (!line.startsWith("info ") || / (lowerbound|upperbound)( |$)/.test(line)) return null;
  const score = line.match(/ score (cp|mate) (-?\d+)/);
  const pv = line.match(/ pv (.+)$/);
  if (!score || !pv) return null;
  const multipv = Number(line.match(/ multipv (\d+)/)?.[1] ?? 1);
  return {
    multipv,
    depth: Number(line.match(/ depth (\d+)/)?.[1] ?? 0),
    score: { [score[1]]: Number(score[2]) },
    pv: pv[1].trim().split(/\s+/),
  };
}

// Chance of winning, 0-100, for the side the score belongs to (Lichess's fitted curve).
export function winChance(score) {
  if (score.mate !== undefined) return score.mate > 0 ? 100 : 0;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * score.cp)) - 1);
}

export function moveAccuracy(loss) {
  return Math.min(100, Math.max(0, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));
}

function gameAccuracy(accuracies) {
  if (accuracies.length === 0) return null;
  const mean = accuracies.reduce((sum, value) => sum + value, 0) / accuracies.length;
  const harmonic = accuracies.length / accuracies.reduce((sum, value) => sum + 1 / Math.max(value, 1), 0);
  return (mean + harmonic) / 2;
}

function positionScore(analysis, fen) {
  if (analysis.lines[0]) return analysis.lines[0].score;
  return new Chess(fen).isCheckmate() ? { mate: 0 } : { cp: 0 };
}

export function uciToSan(fen, uci) {
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return uci;
  }
}

// The score from White's side, formatted like "+1.4" or "M3".
function formatEval(score, sideToMove) {
  const sign = sideToMove === "white" ? 1 : -1;
  if (score.mate !== undefined) {
    if (score.mate === 0) return sideToMove === "white" ? "0-1" : "1-0";
    return `${score.mate * sign > 0 ? "" : "-"}M${Math.abs(score.mate)}`;
  }
  const value = (score.cp * sign) / 100;
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function classify({ playedBest, loss, isGreat }) {
  if (playedBest) return isGreat ? "great" : "best";
  if (loss < 2) return "excellent";
  if (loss < 5) return "good";
  if (loss < 10) return "inaccuracy";
  if (loss < 20) return "mistake";
  return "blunder";
}

function buildComment(move) {
  const { classification, san, bestSan, chanceBefore, chanceAfter, scoreBefore, scoreAfter, replySan } = move;
  if (classification === "great") {
    return `${san} is the only strong move here. Every alternative the engine checked is much worse.`;
  }
  if (classification === "best") return `${san} is the engine's top choice.`;
  if (classification === "excellent" || classification === "good") {
    return `${san} keeps the position about the same. The engine slightly preferred ${bestSan}.`;
  }

  const parts = [
    `${san} is ${classification === "inaccuracy" ? "an inaccuracy" : `a ${classification}`}: win chance drops from ${Math.round(chanceBefore)}% to ${Math.round(chanceAfter)}%.`,
  ];
  if (scoreBefore.mate > 0 && !(scoreAfter.mate < 0)) {
    parts.push(`It misses mate in ${scoreBefore.mate}, starting with ${bestSan}.`);
  } else {
    parts.push(`${bestSan} was best.`);
  }
  if (scoreAfter.mate > 0) {
    parts.push(`It allows mate in ${scoreAfter.mate}${replySan ? `, starting with ${replySan}` : ""}.`);
  } else if (replySan) {
    parts.push(`The strongest reply is ${replySan}.`);
  }
  return parts.join(" ");
}

// analyses[i] is the engine's view of the position before move i; analyses[moves.length]
// is the final position. Missing entries are allowed, so a partial review can be shown.
export function buildReview(game, analyses) {
  const { moves, startFen } = game;
  const fens = [startFen, ...moves.map((move) => move.fenAfter)];
  const positions = fens.map((fen, index) => {
    const analysis = analyses[index];
    if (!analysis) return null;
    const sideToMove = fen.split(" ")[1] === "w" ? "white" : "black";
    const score = positionScore(analysis, fen);
    const chance = winChance(score);
    return {
      whiteChance: sideToMove === "white" ? chance : 100 - chance,
      evalText: formatEval(score, sideToMove),
    };
  });

  const reviewed = moves.map((move, index) => {
    const before = analyses[index];
    const after = analyses[index + 1];
    if (!before || !after) return { ...move, classification: null };

    const scoreBefore = positionScore(before, move.fenBefore);
    const scoreAfter = positionScore(after, move.fenAfter);
    const chanceBefore = winChance(scoreBefore);
    const bestUci = before.lines[0]?.pv[0] ?? null;
    const playedBest = bestUci === move.uci;
    const chanceAfter = playedBest ? chanceBefore : 100 - winChance(scoreAfter);
    const loss = Math.max(0, chanceBefore - chanceAfter);

    const second = before.lines[1];
    const previous = moves[index - 1];
    const isRecapture = Boolean(previous?.captured && move.captured && previous.to === move.to);
    const isGreat =
      Boolean(second) &&
      !isRecapture &&
      chanceBefore >= GREAT_MOVE_MIN_CHANCE &&
      chanceBefore - winChance(second.score) >= GREAT_MOVE_GAP;

    const classification = classify({ playedBest, loss, isGreat });
    const replyUci = after.lines[0]?.pv[0];
    const result = {
      ...move,
      classification,
      loss,
      chanceBefore,
      chanceAfter,
      scoreBefore,
      scoreAfter,
      accuracy: moveAccuracy(loss),
      bestUci,
      bestSan: bestUci ? uciToSan(move.fenBefore, bestUci) : null,
      replySan: replyUci ? uciToSan(move.fenAfter, replyUci) : null,
    };
    return { ...result, comment: buildComment(result) };
  });

  const sideSummary = (color) => {
    const side = reviewed.filter((move) => move.color === color && move.classification);
    const counts = Object.fromEntries(Object.keys(CLASSIFICATIONS).map((key) => [key, 0]));
    for (const move of side) counts[move.classification] += 1;
    return { counts, accuracy: gameAccuracy(side.map((move) => move.accuracy)) };
  };

  return {
    moves: reviewed,
    positions,
    white: sideSummary("white"),
    black: sideSummary("black"),
    isComplete: analyses.filter(Boolean).length === fens.length,
  };
}
