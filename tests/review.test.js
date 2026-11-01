import assert from "node:assert/strict";
import { test } from "node:test";

import { summarizeRatings } from "../src/analysis.js";
import { buildReview, moveAccuracy, parseGame, parseInfoLine, uciToSan, winChance } from "../src/review.js";

// Scholar's mate, in Chess.com's PGN format with clock comments.
const PGN = `[Event "Live Chess"]
[White "Me"]
[Black "Them"]
[Result "1-0"]

1. e4 {[%clk 0:03:00]} 1... e5 {[%clk 0:03:00]} 2. Qh5 {[%clk 0:02:59]} 2... Nc6 {[%clk 0:02:58]} 3. Bc4 {[%clk 0:02:57]} 3... Nf6 {[%clk 0:02:57]} 4. Qxf7# {[%clk 0:02:55]} 1-0`;

const line = (score, ...pv) => ({ score, pv, multipv: 1, depth: 14 });
const position = (...lines) => ({ lines });

function scholarsAnalyses(overrides = {}) {
  const analyses = [
    position(line({ cp: 30 }, "e2e4")),
    position(line({ cp: -30 }, "e7e5")),
    position(line({ cp: 30 }, "d2d4")),
    position(line({ cp: 20 }, "b8c6")),
    position(line({ cp: 10 }, "f1c4")),
    position(line({ cp: 0 }, "g7g6")),
    position(line({ mate: 1 }, "h5f7")),
    position(),
  ];
  return Object.assign(analyses, overrides);
}

test("parseGame reads Chess.com's PGN, including clock comments", () => {
  const game = parseGame(PGN);
  assert.equal(game.moves.length, 7);
  assert.equal(game.moves[0].uci, "e2e4");
  assert.equal(game.moves[1].color, "black");
  assert.equal(game.moves[1].moveNumber, 1);
  assert.equal(game.moves[6].san, "Qxf7#");
  assert.match(game.startFen, /^rnbqkbnr\/pppppppp/);
});

test("parseInfoLine reads scores and skips bounds and non-results", () => {
  assert.deepEqual(
    parseInfoLine("info depth 14 seldepth 20 multipv 2 score cp -35 nodes 1000 nps 5 time 2 pv e7e5 g1f3"),
    { multipv: 2, depth: 14, score: { cp: -35 }, pv: ["e7e5", "g1f3"] },
  );
  assert.deepEqual(parseInfoLine("info depth 3 multipv 1 score mate -2 nodes 1 pv a1a2").score, { mate: -2 });
  assert.equal(parseInfoLine("info depth 9 multipv 1 score cp 20 lowerbound nodes 1 pv a1a2"), null);
  assert.equal(parseInfoLine("info string NNUE enabled"), null);
  assert.equal(parseInfoLine("bestmove e2e4"), null);
});

test("winChance is even at zero and certain with mate", () => {
  assert.equal(winChance({ cp: 0 }), 50);
  assert.ok(winChance({ cp: 300 }) > 70);
  assert.equal(winChance({ mate: 3 }), 100);
  assert.equal(winChance({ mate: -3 }), 0);
  assert.equal(winChance({ mate: 0 }), 0);
});

test("moveAccuracy is perfect with no loss and falls with bigger losses", () => {
  assert.equal(Math.round(moveAccuracy(0)), 100);
  assert.ok(moveAccuracy(20) < moveAccuracy(5));
  assert.equal(moveAccuracy(100), 0);
});

test("buildReview marks matched moves best and checkmate as winning", () => {
  const review = buildReview(parseGame(PGN), scholarsAnalyses());
  assert.equal(review.moves[0].classification, "best");
  assert.equal(review.moves[6].classification, "best");
  assert.equal(review.positions[7].evalText, "1-0");
  assert.equal(review.positions[7].whiteChance, 100);
  assert.equal(review.isComplete, true);
});

test("a move that throws away the game is a blunder, with the fix in its comment", () => {
  // Black was fine before 3...Nf6, but it allows mate in one.
  const review = buildReview(parseGame(PGN), scholarsAnalyses());
  const blunder = review.moves[5];
  assert.equal(blunder.classification, "blunder");
  assert.equal(blunder.bestSan, "g6");
  assert.equal(blunder.replySan, "Qxf7#");
  assert.match(blunder.comment, /a blunder: win chance drops from 50% to 0%/);
  assert.match(blunder.comment, /g6 was best/);
  assert.match(blunder.comment, /allows mate in 1, starting with Qxf7#/);
  assert.equal(review.black.counts.blunder, 1);
  assert.ok(review.black.accuracy < review.white.accuracy);
});

test("loss thresholds separate good moves, inaccuracies and mistakes", () => {
  const classifyAfter = (cp) =>
    buildReview(
      parseGame(PGN),
      scholarsAnalyses({
        0: position(line({ cp: 0 }, "d2d4")),
        1: position(line({ cp }, "e7e5")),
      }),
    ).moves[0].classification;
  assert.equal(classifyAfter(10), "excellent");
  assert.equal(classifyAfter(40), "good");
  assert.equal(classifyAfter(80), "inaccuracy");
  assert.equal(classifyAfter(150), "mistake");
  assert.equal(classifyAfter(500), "blunder");
});

test("an only-move is great, unless it's a simple recapture or the game was already lost", () => {
  const reviewWith = (first) =>
    buildReview(parseGame(PGN), scholarsAnalyses({ 0: position(line(first, "e2e4"), line({ cp: -300 }, "d2d4")) })).moves[0].classification;
  assert.equal(reviewWith({ cp: 100 }), "great");
  assert.equal(reviewWith({ cp: -600 }), "best");

  const recapture = `1. e4 d5 2. exd5 Qxd5 *`;
  const game = parseGame(recapture);
  const analyses = [
    position(line({ cp: 30 }, "e2e4")),
    position(line({ cp: -30 }, "d7d5")),
    position(line({ cp: 30 }, "e4d5")),
    position(line({ cp: 0 }, "d8d5"), line({ cp: -400 }, "g8f6")),
    position(line({ cp: 0 }, "b1c3")),
  ];
  assert.equal(buildReview(game, analyses).moves[3].classification, "best");
});

test("a partial review leaves unanalysed moves pending", () => {
  const analyses = scholarsAnalyses().slice(0, 3);
  const review = buildReview(parseGame(PGN), analyses);
  assert.equal(review.moves[0].classification, "best");
  assert.equal(review.moves[3].classification, null);
  assert.equal(review.positions[5], null);
  assert.equal(review.isComplete, false);
});

test("uciToSan converts moves and survives bad input", () => {
  const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  assert.equal(uciToSan(start, "g1f3"), "Nf3");
  assert.equal(uciToSan(start, "a1a8"), "a1a8");
});

test("summarizeRatings lists played formats and only a real FIDE rating", () => {
  assert.deepEqual(
    summarizeRatings({ chess_blitz: { last: { rating: 1500 }, best: { rating: 1600 } }, chess_rapid: { record: {} }, fide: 0 }),
    [{ format: "Blitz", rating: 1500, best: 1600 }],
  );
  assert.deepEqual(summarizeRatings({ fide: 2100 }), [{ format: "FIDE", rating: 2100, best: null }]);
  assert.deepEqual(summarizeRatings(null), []);
});
