// Turns raw Chess.com game objects into per-game summaries and an overview of the set.

const DRAW_RESULTS = new Set([
  "agreed",
  "repetition",
  "stalemate",
  "insufficient",
  "50move",
  "timevsinsufficient",
]);

const RESULT_LABELS = {
  win: "Win",
  checkmated: "Checkmate",
  resigned: "Resignation",
  timeout: "Time",
  abandoned: "Abandonment",
  lose: "Lost",
  agreed: "Agreement",
  repetition: "Repetition",
  stalemate: "Stalemate",
  insufficient: "Insufficient material",
  "50move": "50-move rule",
  timevsinsufficient: "Time vs. insufficient material",
};

const SHORT_GAME_MOVES = 25;

export function playerColor(game, username) {
  const name = username.toLowerCase();
  const matches = (side) =>
    side.username?.toLowerCase() === name || side["@id"]?.toLowerCase().endsWith(`/player/${name}`);
  if (matches(game.white)) return "white";
  if (matches(game.black)) return "black";
  return null;
}

// "…/openings/Sicilian-Defense-Canal-Attack...10.h3" -> "Sicilian Defense Canal Attack"
export function openingName(ecoUrl) {
  if (!ecoUrl) return null;
  const slug = ecoUrl.split("/").pop().split("?")[0];
  const name = slug.replace(/-?\d*\.{1,3}.*$/, "").replace(/-/g, " ").trim();
  return name || null;
}

// Groups variations together: "Sicilian Defense Canal Attack" -> "Sicilian Defense"
export function openingFamily(name) {
  if (!name) return null;
  const match = name.match(/^.*?\b(?:Opening|Defense|Game|Gambit|Attack|System)\b/);
  return match ? match[0] : name;
}

function gameOutcome(result) {
  if (result === "win") return "win";
  return DRAW_RESULTS.has(result) ? "draw" : "loss";
}

function moveCount(game) {
  const fullMove = Number(game.fen?.split(" ")[5]);
  return Number.isFinite(fullMove) && fullMove > 0 ? fullMove : null;
}

export function summarizeGame(game, username) {
  const color = playerColor(game, username);
  const opponentColor = color === "white" ? "black" : "white";
  const player = game[color];
  const opponent = game[opponentColor];
  const outcome = gameOutcome(player.result);
  const opening = openingName(game.eco);
  return {
    url: game.url,
    pgn: game.pgn,
    startFen: game.initial_setup,
    endTime: game.end_time,
    color,
    outcome,
    // A win's reason is how the opponent lost; a draw or loss's reason is on the player's side.
    reason: RESULT_LABELS[outcome === "win" ? opponent.result : player.result] ?? "Other",
    rawResult: player.result,
    rating: player.rating,
    opponent: { username: opponent.username, rating: opponent.rating },
    timeClass: game.time_class,
    rules: game.rules,
    rated: Boolean(game.rated),
    opening,
    family: openingFamily(opening),
    moves: moveCount(game),
    accuracy: game.accuracies?.[color] ?? null,
    opponentAccuracy: game.accuracies?.[opponentColor] ?? null,
  };
}

// Current and peak Elo per format, from the player's stats. FIDE is 0 when none is listed.
export function summarizeRatings(stats) {
  if (!stats) return [];
  const formats = [
    ["Rapid", stats.chess_rapid],
    ["Blitz", stats.chess_blitz],
    ["Bullet", stats.chess_bullet],
    ["Daily", stats.chess_daily],
  ];
  const ratings = formats
    .filter(([, format]) => format?.last?.rating)
    .map(([format, data]) => ({ format, rating: data.last.rating, best: data.best?.rating ?? null }));
  return stats.fide ? [...ratings, { format: "FIDE", rating: stats.fide, best: null }] : ratings;
}

const plural = (count, noun, pluralNoun = `${noun}s`) => `${count} ${count === 1 ? noun : pluralNoun}`;
const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const points = (outcome) => ({ win: 1, draw: 0.5, loss: 0 })[outcome];
const totalPoints = (games) => games.reduce((sum, game) => sum + points(game.outcome), 0);
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

function currentStreak(games) {
  const [latest] = games;
  let length = 0;
  while (length < games.length && games[length].outcome === latest.outcome) length += 1;
  return { outcome: latest.outcome, length };
}

// First-to-last rating per format. Games are newest first, and unrated games don't count.
function ratingChanges(games) {
  const groups = new Map();
  for (const game of games) {
    if (!game.rated) continue;
    const key = game.rules === "chess" ? game.timeClass : `${game.rules} ${game.timeClass}`;
    groups.set(key, [...(groups.get(key) ?? []), game]);
  }
  return [...groups]
    .filter(([, group]) => group.length >= 2)
    .map(([format, group]) => ({
      format,
      from: group.at(-1).rating,
      to: group[0].rating,
      change: group[0].rating - group.at(-1).rating,
    }));
}

function mostPlayedFamily(games) {
  const counts = new Map();
  for (const { family } of games) {
    if (family) counts.set(family, (counts.get(family) ?? 0) + 1);
  }
  let top = null;
  for (const [name, count] of counts) {
    if (!top || count > top.count) top = { name, count };
  }
  if (!top || top.count < 2) return null;
  const inFamily = games.filter((game) => game.family === top.name);
  return { ...top, points: totalPoints(inFamily) };
}

function accuracySummary(games) {
  const analysed = games.filter((game) => game.accuracy !== null);
  if (analysed.length === 0) return null;
  const opponents = analysed.filter((game) => game.opponentAccuracy !== null);
  return {
    count: analysed.length,
    player: average(analysed.map((game) => game.accuracy)),
    opponent: opponents.length ? average(opponents.map((game) => game.opponentAccuracy)) : null,
  };
}

function buildTakeaways(games, stats) {
  const { record, byColor, accuracy, changes, bestWin, worstLoss, topOpening, streak, timeouts, shortLosses } = stats;
  const takeaways = [];

  if (streak.length >= 2) {
    const kind = { win: "winning", draw: "drawing", loss: "losing" }[streak.outcome];
    takeaways.push(`Currently on a ${streak.length}-game ${kind} streak.`);
  }
  for (const { format, from, to, change } of changes) {
    const direction = change === 0 ? "held steady at" : change > 0 ? `gained ${change} points, reaching` : `lost ${-change} points, falling to`;
    const start = change === 0 ? "" : ` from ${from}`;
    takeaways.push(`${capitalize(format)} rating ${direction} ${to}${start}.`);
  }
  if (accuracy) {
    const versus = accuracy.opponent === null ? "" : ` against ${accuracy.opponent.toFixed(1)}% for opponents`;
    takeaways.push(
      `Averaged ${accuracy.player.toFixed(1)}% accuracy${versus}, based on the ${plural(accuracy.count, "game")} with Game Review data.`,
    );
  }
  if (byColor.white.games && byColor.black.games) {
    takeaways.push(
      `Scored ${byColor.white.points}/${byColor.white.games} with White and ${byColor.black.points}/${byColor.black.games} with Black.`,
    );
  }
  if (bestWin) {
    takeaways.push(`Best win: ${bestWin.opponent.username} (${bestWin.opponent.rating}) in ${bestWin.timeClass}.`);
  }
  if (worstLoss) {
    takeaways.push(`Lowest-rated loss: ${worstLoss.opponent.username} (${worstLoss.opponent.rating}) in ${worstLoss.timeClass}.`);
  }
  if (timeouts > 0) {
    const share = record.loss === 1 ? "The only loss" : `${timeouts} of ${record.loss} losses`;
    takeaways.push(`${share} came on time, so the clock is worth watching.`);
  }
  if (shortLosses > 0) {
    takeaways.push(`${plural(shortLosses, "loss", "losses")} ended within ${SHORT_GAME_MOVES} moves, which can point to opening trouble.`);
  }
  if (topOpening) {
    takeaways.push(`Most played: ${topOpening.name}, scoring ${topOpening.points}/${topOpening.count}.`);
  }
  return takeaways;
}

export function buildOverview(games) {
  if (games.length === 0) return null;

  const record = { win: 0, draw: 0, loss: 0 };
  for (const game of games) record[game.outcome] += 1;

  const colorStats = (color) => {
    const group = games.filter((game) => game.color === color);
    return { games: group.length, points: totalPoints(group) };
  };
  const wins = games.filter((game) => game.outcome === "win");
  const losses = games.filter((game) => game.outcome === "loss");
  const moves = games.map((game) => game.moves).filter((count) => count !== null);

  const scorePct = Math.round((totalPoints(games) / games.length) * 100);
  const stats = {
    record,
    byColor: { white: colorStats("white"), black: colorStats("black") },
    accuracy: accuracySummary(games),
    changes: ratingChanges(games),
    bestWin: wins.length ? wins.reduce((best, game) => (game.opponent.rating > best.opponent.rating ? game : best)) : null,
    worstLoss: losses.length ? losses.reduce((low, game) => (game.opponent.rating < low.opponent.rating ? game : low)) : null,
    topOpening: mostPlayedFamily(games),
    streak: currentStreak(games),
    timeouts: losses.filter((game) => game.rawResult === "timeout").length,
    shortLosses: losses.filter((game) => game.moves !== null && game.moves <= SHORT_GAME_MOVES).length,
  };

  return {
    ...stats,
    gameCount: games.length,
    scorePct,
    averageMoves: moves.length ? Math.round(average(moves)) : null,
    takeaways: buildTakeaways(games, stats),
  };
}
