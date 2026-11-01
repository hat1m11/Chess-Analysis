import assert from "node:assert/strict";
import { test } from "node:test";

import { buildOverview, openingFamily, openingName, summarizeGame } from "../src/analysis.js";
import { fetchPlayer, fetchRecentGames, parseUsername } from "../src/chesscom.js";

let nextId = 1;

function makeGame({ color = "white", result = "win", opponentResult, rating = 1500, opponentRating = 1500, ...rest } = {}) {
  const defaultOpponentResult = result === "win" ? "resigned" : ["agreed", "stalemate", "repetition"].includes(result) ? result : "win";
  const me = { username: "Me", rating, result, "@id": "https://api.chess.com/pub/player/me" };
  const them = { username: "Them", rating: opponentRating, result: opponentResult ?? defaultOpponentResult, "@id": "https://api.chess.com/pub/player/them" };
  return {
    url: "https://www.chess.com/game/live/1",
    end_time: nextId++,
    rated: true,
    rules: "chess",
    time_class: "blitz",
    fen: "8/8/8/8/8/8/8/8 b - - 0 40",
    white: color === "white" ? me : them,
    black: color === "black" ? me : them,
    ...rest,
  };
}

const summarize = (games) => games.map((game) => summarizeGame(game, "me"));

test("openingName handles both URL shapes and missing values", () => {
  assert.equal(openingName("https://www.chess.com/openings/Sicilian-Defense-Canal-Attack...10.h3-Bh5"), "Sicilian Defense Canal Attack");
  assert.equal(openingName("https://www.chess.com/openings/Kings-Pawn-Opening-1...e5"), "Kings Pawn Opening");
  assert.equal(openingName("https://www.chess.com/openings/Italian-Game-4.d3"), "Italian Game");
  assert.equal(openingName("https://www.chess.com/openings/Caro-Kann-Defense"), "Caro Kann Defense");
  assert.equal(openingName(undefined), null);
  assert.equal(openingFamily("Sicilian Defense Canal Attack"), "Sicilian Defense");
});

test("summarizeGame sees the game from the player's side, ignoring name case", () => {
  const game = summarizeGame(
    makeGame({ color: "black", result: "timeout", rating: 1490, opponentRating: 1600, accuracies: { white: 80, black: 70 } }),
    "ME",
  );
  assert.equal(game.color, "black");
  assert.equal(game.outcome, "loss");
  assert.equal(game.reason, "Time");
  assert.equal(game.opponent.rating, 1600);
  assert.equal(game.accuracy, 70);
  assert.equal(game.opponentAccuracy, 80);
  assert.equal(game.moves, 40);
});

test("summarizeGame reports how a win happened and classifies draws", () => {
  assert.equal(summarize([makeGame({ opponentResult: "checkmated" })])[0].reason, "Checkmate");
  const [draw] = summarize([makeGame({ result: "repetition" })]);
  assert.equal(draw.outcome, "draw");
  assert.equal(draw.reason, "Repetition");
});

test("buildOverview totals results, rating change and accuracy", () => {
  // Newest first, as fetchRecentGames returns them.
  const overview = buildOverview(
    summarize([
      makeGame({ result: "win", rating: 1530, opponentRating: 1700, accuracies: { white: 90, black: 80 } }),
      makeGame({ color: "black", result: "win", rating: 1520, opponentRating: 1400 }),
      makeGame({ result: "agreed", rating: 1510 }),
      makeGame({ color: "black", result: "timeout", rating: 1505, opponentRating: 1300, fen: "8/8/8/8/8/8/8/8 b - - 0 20" }),
      makeGame({ result: "checkmated", rating: 1500, accuracies: { white: 60, black: 70 } }),
    ]),
  );
  assert.deepEqual(overview.record, { win: 2, draw: 1, loss: 2 });
  assert.equal(overview.scorePct, 50);
  assert.equal(overview.streak.length, 2);
  assert.deepEqual(overview.changes, [{ format: "blitz", from: 1500, to: 1530, change: 30 }]);
  assert.equal(overview.accuracy.count, 2);
  assert.equal(overview.accuracy.player, 75);
  assert.equal(overview.bestWin.opponent.rating, 1700);
  assert.equal(overview.worstLoss.opponent.rating, 1300);
  assert.equal(overview.timeouts, 1);
  assert.equal(overview.shortLosses, 1);
  assert.deepEqual(overview.byColor.white, { games: 3, points: 1.5 });
  assert.ok(overview.takeaways.includes("1 of 2 losses came on time, so the clock is worth watching."));
  assert.ok(overview.takeaways.includes("1 loss ended within 25 moves, which can point to opening trouble."));
});

test("buildOverview copes with no games, one game and missing optional data", () => {
  assert.equal(buildOverview([]), null);
  const overview = buildOverview(summarize([makeGame({ fen: undefined, rated: false })]));
  assert.equal(overview.scorePct, 100);
  assert.equal(overview.accuracy, null);
  assert.equal(overview.averageMoves, null);
  assert.deepEqual(overview.changes, []);
});

test("ratings aren't compared across formats", () => {
  const overview = buildOverview(
    summarize([
      makeGame({ rating: 1500 }),
      makeGame({ rating: 2000, time_class: "rapid" }),
      makeGame({ rating: 1450 }),
    ]),
  );
  assert.deepEqual(overview.changes, [{ format: "blitz", from: 1450, to: 1500, change: 50 }]);
});

test("parseUsername accepts names and profile links", () => {
  assert.equal(parseUsername("  Hikaru "), "hikaru");
  assert.equal(parseUsername("@Hikaru"), "hikaru");
  assert.equal(parseUsername("https://www.chess.com/member/Hikaru?tab=games"), "hikaru");
});

const jsonResponse = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

test("fetchRecentGames walks back through archives until it has enough, newest first", async () => {
  const archive = (month) => `https://api.chess.com/pub/player/me/games/2026/${month}`;
  const responses = {
    "https://api.chess.com/pub/player/me/games/archives": { archives: [archive("08"), archive("09"), archive("10")] },
    [archive("10")]: { games: [makeGame({ end_time: 500 }), makeGame({ end_time: 600 })] },
    [archive("09")]: { games: [makeGame({ end_time: 300 }), makeGame({ end_time: 400 })] },
  };
  const requested = [];
  const games = await fetchRecentGames("me", 3, async (url) => {
    requested.push(url);
    return jsonResponse(responses[url]);
  });
  assert.deepEqual(games.map((game) => game.end_time), [600, 500, 400]);
  assert.ok(!requested.includes(archive("08")));
});

test("fetchPlayer explains missing players and rate limits", async () => {
  await assert.rejects(fetchPlayer("ghost", async () => jsonResponse({}, 404)), /No Chess\.com player is named "ghost"/);
  await assert.rejects(fetchPlayer("me", async () => jsonResponse({}, 429)), /rate limiting/);
  await assert.rejects(
    fetchPlayer("me", async () => {
      throw new TypeError("network down");
    }),
    /Couldn't reach Chess\.com/,
  );
});
