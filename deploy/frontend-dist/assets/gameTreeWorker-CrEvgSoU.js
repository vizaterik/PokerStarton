const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
Object.fromEntries(RANKS.map((r, i) => [r, i]));
String("").trim().replace(/^["']|["']$/g, "").replace(/\/$/, "");
const SEATS_6 = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];
const STANDARD_OPEN_BB = 2.5;
const STANDARD_SB_OPEN_BB = 3;
const THREE_BET_MULT = 3.5;
const FOUR_BET_MULT = 2.2;
function standardOpenSize(seat) {
  return seat === "SB" ? STANDARD_SB_OPEN_BB : STANDARD_OPEN_BB;
}
function actorsAlongPath(path) {
  const out = [];
  for (let i = 1; i < path.length; i += 1) {
    const parent = path[i - 1];
    const child = path[i];
    out.push({
      player: parent.activePlayer,
      action: child.actionTaken,
      sizingBB: child.sizingBB
    });
  }
  return out;
}
function deriveContext(path) {
  const folded = [];
  let raiseCount = 0;
  let lastAggressor = null;
  let lastRaiseSize = null;
  let limpCount = 0;
  let callersAfterRaise = 0;
  for (const step of actorsAlongPath(path)) {
    if (step.action === "FOLD") {
      folded.push(step.player);
      continue;
    }
    if (step.action === "RAISE") {
      raiseCount += 1;
      lastAggressor = step.player;
      lastRaiseSize = step.sizingBB ?? null;
      limpCount = 0;
      callersAfterRaise = 0;
      continue;
    }
    if (step.action === "CALL") {
      if (raiseCount === 0) limpCount += 1;
      else callersAfterRaise += 1;
    }
  }
  let potType = "unopened";
  if (raiseCount > 0) potType = "facing_raise";
  else if (limpCount > 0) potType = "facing_limp";
  return {
    potType,
    raiseCount,
    lastRaiseSize,
    lastAggressor,
    folded,
    limpCount,
    callersAfterRaise
  };
}
const OPENERS = ["UTG", "HJ", "CO", "BTN", "SB"];
const threeBet = (open) => Math.round(open * THREE_BET_MULT * 10) / 10;
const fourBet = (tb) => Math.round(tb * FOUR_BET_MULT * 10) / 10;
function respondersAfter(opener) {
  const order = SEATS_6;
  const oi = order.indexOf(opener);
  if (oi < 0) return [];
  return order.slice(oi + 1);
}
function openSize(opener) {
  return standardOpenSize(opener);
}
function toChartPos(seat) {
  if (seat === "HJ" || seat === "MP") return "MP";
  if (seat === "UTG" || seat === "CO" || seat === "BTN" || seat === "SB" || seat === "BB") {
    return seat;
  }
  return "MP";
}
function srpLine(opener, caller) {
  const size = openSize(opener);
  return {
    id: `srp_${opener}_${caller}`,
    label: `Raise ${opener}vs${caller}`,
    kind: "srp",
    opener,
    villain: caller,
    actions: [
      { seat: opener, action: "RAISE", sizingBB: size },
      { seat: caller, action: "CALL" }
    ]
  };
}
function threeBetLine(opener, threeBettor) {
  const size = openSize(opener);
  const tb = threeBet(size);
  return {
    id: `3bp_${opener}_${threeBettor}`,
    label: `3-bet ${threeBettor}vs${opener}`,
    kind: "3bp",
    opener,
    villain: threeBettor,
    actions: [
      { seat: opener, action: "RAISE", sizingBB: size },
      { seat: threeBettor, action: "RAISE", sizingBB: tb },
      { seat: opener, action: "CALL" }
    ]
  };
}
function fourBetLine(opener, threeBettor) {
  const size = openSize(opener);
  const tb = threeBet(size);
  const fb = fourBet(tb);
  return {
    id: `4bp_${opener}_${threeBettor}`,
    label: `4-bet ${opener}vs${threeBettor}`,
    kind: "4bp",
    opener,
    villain: threeBettor,
    actions: [
      { seat: opener, action: "RAISE", sizingBB: size },
      { seat: threeBettor, action: "RAISE", sizingBB: tb },
      { seat: opener, action: "RAISE", sizingBB: fb },
      { seat: threeBettor, action: "CALL" }
    ]
  };
}
function srp(opener, caller) {
  return srpLine(opener, caller);
}
function threeBetPot(opener, threeBettor) {
  return threeBetLine(opener, threeBettor);
}
function fourBetPot(opener, threeBettor) {
  return fourBetLine(opener, threeBettor);
}
function allHuActionBranches() {
  const lines = [];
  for (const opener of OPENERS) {
    for (const responder of respondersAfter(opener)) {
      lines.push(srp(opener, responder));
      lines.push(threeBetPot(opener, responder));
      lines.push(fourBetPot(opener, responder));
    }
  }
  return lines;
}
allHuActionBranches();
function mixToCell(mix) {
  const r = mix.RAISE ?? 0;
  const c = mix.CALL ?? 0;
  const f = mix.FOLD ?? 0;
  const sum = r + c + f;
  if (sum <= 0) return { raise_freq: 0, call_freq: 0, fold_freq: 1 };
  return {
    raise_freq: r / sum,
    call_freq: c / sum,
    fold_freq: f / sum
  };
}
function rangesToMatrix(ranges) {
  const out = {};
  for (const [hand, mix] of Object.entries(ranges)) {
    out[hand] = mixToCell(mix);
  }
  return out;
}
function isPainted(matrix) {
  return Object.values(matrix).some((c) => c.raise_freq > 0.02 || c.call_freq > 0.02);
}
function spotKeyForContext(ctx) {
  if (ctx.raiseCount === 0 && ctx.limpCount === 0) return "rfi";
  if (ctx.raiseCount === 0 && ctx.limpCount > 0) return "iso";
  if (ctx.raiseCount === 1) {
    return ctx.callersAfterRaise >= 1 ? "squeeze" : "vs_open";
  }
  if (ctx.raiseCount === 2) return "vs_3bet";
  if (ctx.raiseCount >= 3) return "vs_4bet";
  return null;
}
function collectJobs(root) {
  const best = /* @__PURE__ */ new Map();
  function visit(node, path) {
    const nextPath = [...path, node];
    if (node.street === "preflop" && !node.awaitingFlop) {
      const ctx = deriveContext(nextPath);
      const spotKey = spotKeyForContext(ctx);
      if (spotKey) {
        const matrix = rangesToMatrix(node.ranges);
        if (isPainted(matrix)) {
          const hero = toChartPos(node.activePlayer);
          const villain = spotKey !== "rfi" && spotKey !== "iso" && ctx.lastAggressor ? toChartPos(ctx.lastAggressor) : null;
          const key = `${spotKey}|${hero}|${villain ?? ""}`;
          const play = Object.values(matrix).reduce(
            (n, c) => n + c.raise_freq + c.call_freq,
            0
          );
          const prev = best.get(key);
          const prevPlay = prev ? Object.values(prev.matrix).reduce(
            (n, c) => n + c.raise_freq + c.call_freq,
            0
          ) : -1;
          if (play >= prevPlay) {
            best.set(key, { spotKey, hero, villain, matrix });
          }
        }
      }
    }
    for (const ch of node.children) visit(ch, nextPath);
  }
  visit(root, []);
  return [...best.values()];
}
function jobsFingerprint(jobs) {
  return jobs.map((j) => {
    const play = Object.entries(j.matrix).filter(([, c]) => c.raise_freq > 0 || c.call_freq > 0).map(
      ([h, c]) => `${h}:${c.raise_freq.toFixed(2)}/${c.call_freq.toFixed(2)}`
    ).sort().join(",");
    return `${j.spotKey}|${j.hero}|${j.villain ?? ""}|${play}`;
  }).sort().join(";");
}
self.onmessage = (ev) => {
  const msg = ev.data;
  try {
    if (msg.type === "init") {
      self.postMessage({ type: "ready" });
      return;
    }
    if (msg.type === "jobsFp") {
      const jobs = collectJobs(msg.doc.root);
      const fingerprint = jobsFingerprint(jobs) || "empty";
      const out = {
        type: "jobsFp",
        requestId: msg.requestId,
        fingerprint,
        jobCount: jobs.length,
        jobs
      };
      self.postMessage(out);
    }
  } catch (err) {
    const out = {
      type: "error",
      requestId: msg.type === "jobsFp" ? msg.requestId : 0,
      message: err instanceof Error ? err.message : "gameTree worker error"
    };
    self.postMessage(out);
  }
};
