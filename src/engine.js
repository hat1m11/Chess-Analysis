// Runs Stockfish in a Web Worker, one position at a time, and speaks UCI to it.
import { parseInfoLine } from "./review.js";

const WORKER_URL = "/vendor/stockfish/bin/stockfish-19-lite-single.js";
const SEARCH = "go depth 14 movetime 1500";
const LINES = 2;

export class Engine {
  constructor() {
    this.queue = Promise.resolve();
    this.listener = null;
    this.failure = null;
    this.worker = new Worker(WORKER_URL);
    this.worker.onmessage = ({ data }) => this.listener?.(String(data));
    this.worker.onerror = (event) => {
      event.preventDefault?.();
      this.failure = new Error("The chess engine failed to load.");
      this.rejectCurrent?.(this.failure);
    };
    this.ready = this.handshake();
  }

  waitFor(prefix, onLine) {
    return new Promise((resolve, reject) => {
      if (this.failure) {
        reject(this.failure);
        return;
      }
      this.rejectCurrent = reject;
      this.listener = (line) => {
        onLine?.(line);
        if (line.startsWith(prefix)) {
          this.listener = null;
          resolve(line);
        }
      };
    });
  }

  async handshake() {
    const uciOk = this.waitFor("uciok");
    this.worker.postMessage("uci");
    await uciOk;
    this.worker.postMessage(`setoption name MultiPV value ${LINES}`);
    this.worker.postMessage("setoption name Hash value 32");
    const readyOk = this.waitFor("readyok");
    this.worker.postMessage("isready");
    await readyOk;
  }

  // Requests run in order. A stopped search still resolves, with whatever it had found.
  analyse(fen) {
    const run = async () => {
      await this.ready;
      const lines = [];
      const done = this.waitFor("bestmove", (line) => {
        const info = parseInfoLine(line);
        if (info) lines[info.multipv - 1] = info;
      });
      this.worker.postMessage(`position fen ${fen}`);
      this.worker.postMessage(SEARCH);
      await done;
      return { lines: lines.filter(Boolean) };
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  stop() {
    this.worker.postMessage("stop");
  }
}
