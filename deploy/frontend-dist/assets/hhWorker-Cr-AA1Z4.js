const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
const RANK_INDEX = Object.fromEntries(
  RANKS.map((r, i) => [r, i])
);
function cardsToHandCode(card1, card2) {
  const c1 = card1.trim();
  const c2 = card2.trim();
  if (c1.length < 2 || c2.length < 2) throw new Error(`Invalid cards: ${card1}, ${card2}`);
  let r1 = c1[0].toUpperCase();
  let s1 = c1[1].toLowerCase();
  let r2 = c2[0].toUpperCase();
  let s2 = c2[1].toLowerCase();
  if (!(r1 in RANK_INDEX) || !(r2 in RANK_INDEX)) {
    throw new Error(`Invalid ranks: ${card1}, ${card2}`);
  }
  if (r1 === r2) return `${r1}${r2}`;
  if (RANK_INDEX[r1] > RANK_INDEX[r2]) {
    [r1, r2, s1, s2] = [r2, r1, s2, s1];
  }
  return `${r1}${r2}${s1 === s2 ? "s" : "o"}`;
}
const STEAL_POS = /* @__PURE__ */ new Set(["CO", "BTN", "SB"]);
function moneyCall(action, amount) {
  return action === "call" && amount != null && amount > 0;
}
function computeHudFlags(hand) {
  const flags = {
    vpip: false,
    vpip_opp: false,
    pfr: false,
    pfr_opp: false,
    three_bet: false,
    three_bet_opp: false,
    fold_to_3bet: false,
    fold_to_3bet_opp: false,
    four_bet: false,
    four_bet_opp: false,
    ats: false,
    ats_opp: false,
    fold_bb_steal: false,
    fold_bb_steal_opp: false,
    limp: false,
    saw_flop: false,
    cbet: false,
    cbet_opp: false,
    fold_to_cbet: false,
    fold_to_cbet_opp: false,
    postflop_bets: 0,
    postflop_raises: 0,
    postflop_calls: 0,
    went_to_showdown: hand.went_to_showdown,
    won_at_showdown: false,
    won_when_saw_flop: false
  };
  const preflop = hand.actions.filter((a) => a.street === "preflop");
  const flop = hand.actions.filter((a) => a.street === "flop");
  const postflop = hand.actions.filter(
    (a) => ["flop", "turn", "river"].includes(a.street)
  );
  flags.saw_flop = flop.length > 0 || postflop.some((a) => a.street === "flop");
  const heroName = (hand.hero_name || "Hero").toLowerCase();
  let raisesBefore = 0;
  let limpsBefore = 0;
  let openerName = null;
  let heroActed = false;
  let heroFoldedPre = false;
  let heroOpenRaised = false;
  let faced3bet = false;
  for (const act of preflop) {
    if (act.is_hero) {
      if (heroFoldedPre) continue;
      if (!heroActed) {
        heroActed = true;
        const pos = (hand.hero_position || "").toUpperCase();
        flags.vpip_opp = true;
        flags.pfr_opp = true;
        if (act.action === "raise") {
          flags.vpip = true;
          flags.pfr = true;
          if (raisesBefore === 0) heroOpenRaised = true;
          else if (raisesBefore === 1) flags.three_bet = true;
          else if (raisesBefore >= 2) flags.four_bet = true;
        } else if (moneyCall(act.action, act.amount)) {
          flags.vpip = true;
          if (raisesBefore === 0) flags.limp = true;
        } else if (act.action === "fold") {
          heroFoldedPre = true;
        }
        if (raisesBefore === 1) flags.three_bet_opp = true;
        if (raisesBefore >= 2) flags.four_bet_opp = true;
        if (raisesBefore === 0 && limpsBefore === 0 && STEAL_POS.has(pos)) {
          flags.ats_opp = true;
          if (act.action === "raise") flags.ats = true;
        }
        if (pos === "BB" && raisesBefore === 1 && limpsBefore === 0 && openerName) {
          const openPos = (hand.villain_position || "").toUpperCase();
          if (STEAL_POS.has(openPos)) {
            flags.fold_bb_steal_opp = true;
            if (act.action === "fold") flags.fold_bb_steal = true;
          }
        }
      } else {
        if (heroOpenRaised && faced3bet) {
          flags.fold_to_3bet_opp = true;
          flags.four_bet_opp = true;
          if (act.action === "fold") {
            flags.fold_to_3bet = true;
            heroFoldedPre = true;
          } else if (act.action === "raise") {
            flags.four_bet = true;
          }
        } else if (act.action === "fold") {
          heroFoldedPre = true;
        }
      }
      continue;
    }
    if (act.action === "raise") {
      raisesBefore += 1;
      if (raisesBefore === 1) openerName = act.player_name;
      if (heroOpenRaised && !faced3bet) faced3bet = true;
    } else if (moneyCall(act.action, act.amount) && raisesBefore === 0) {
      limpsBefore += 1;
    }
  }
  if (heroOpenRaised && faced3bet) {
    flags.fold_to_3bet_opp = true;
    flags.four_bet_opp = true;
  }
  if (!heroActed && preflop.length) {
    flags.vpip_opp = true;
    flags.pfr_opp = true;
  }
  let lastPfAggressor = null;
  for (const act of preflop) {
    if (act.action === "raise") lastPfAggressor = act.player_name;
  }
  if (lastPfAggressor && lastPfAggressor.toLowerCase() === heroName && flags.saw_flop && !heroFoldedPre) {
    let priorAgg = false;
    for (const act of flop) {
      if (act.is_hero) {
        if (!priorAgg) {
          flags.cbet_opp = true;
          if (act.action === "raise") flags.cbet = true;
        }
        break;
      }
      if (act.action === "raise") priorAgg = true;
    }
  }
  if (lastPfAggressor && lastPfAggressor.toLowerCase() !== heroName && flags.saw_flop && !heroFoldedPre) {
    const pfa = lastPfAggressor.toLowerCase();
    let seenAgg = false;
    for (const act of flop) {
      const actor = (act.player_name || "").toLowerCase();
      if (!seenAgg) {
        if (act.action === "raise") {
          if (actor === pfa) {
            seenAgg = true;
            flags.fold_to_cbet_opp = true;
          } else break;
        }
        continue;
      }
      if (act.is_hero) {
        if (act.action === "fold") flags.fold_to_cbet = true;
        break;
      }
    }
  }
  for (const act of postflop) {
    if (!act.is_hero) continue;
    if (act.action === "raise") {
      const prior = postflop.filter(
        (a) => a.street === act.street && a.action_order < act.action_order && a.action === "raise"
      );
      if (prior.length) flags.postflop_raises += 1;
      else flags.postflop_bets += 1;
    } else if (moneyCall(act.action, act.amount)) {
      flags.postflop_calls += 1;
    }
  }
  const net = hand.hero_net ?? 0;
  if (flags.saw_flop && net > 0) flags.won_when_saw_flop = true;
  if (flags.went_to_showdown && (hand.hero_net_wsd ?? 0) > 0) {
    flags.won_at_showdown = true;
  } else if (flags.went_to_showdown && net > 0) {
    flags.won_at_showdown = true;
  }
  return flags;
}
function mergeFlagsIntoHand(hand) {
  const f = computeHudFlags(hand);
  return {
    ...hand,
    vpip: f.vpip,
    pfr: f.pfr,
    three_bet: f.three_bet,
    three_bet_opp: f.three_bet_opp,
    flags: f
  };
}
const HAND_SPLIT_RE = /(?=PokerStars Hand #)|(?=Poker Hand #)|(?=PokerStars Zoom Hand #)/gi;
const HEADER_RE = /^(?:PokerStars(?: Zoom)? Hand|Poker Hand) #([^\s:]+):\s*.*?\((\$?[\d.]+)\/(\$?[\d.]+).*?\)\s*-\s*(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})/i;
const TABLE_RE = /^Table '([^']+)'\s+(\d+)-max\s+Seat #(\d+) is the button/i;
const SEAT_RE = /^Seat (\d+):\s+(.+?)\s+\(\$?([\d.]+) in chips\)/i;
const DEALT_RE = /^Dealt to (.+?)(?:\s+\[([2-9TJQKA][shdc])\s+([2-9TJQKA][shdc])\])?\s*$/i;
const ACTION_RE = /^(.+?):\s+(folds|checks|calls|bets|raises|posts)\b(?:\s+(?:small blind|big blind|the ante))?(?:\s+\$?([\d.]+))?(?:\s+to\s+\$?([\d.]+))?/i;
const STREET_RE = /^\*\*\*\s+(?:(FIRST|SECOND)\s+)?(HOLE CARDS|FLOP|TURN|RIVER|SHOWDOWN|SUMMARY)\s+\*\*\*/i;
function streetFromMarker(prefix, label) {
  const lab = (label || "").toUpperCase();
  const pref = (prefix || "").toUpperCase();
  if (pref === "SECOND") return "summary";
  if (lab === "HOLE CARDS") return "preflop";
  if (lab === "FLOP") return "flop";
  if (lab === "TURN") return "turn";
  if (lab === "RIVER") return "river";
  return "summary";
}
const SIX_MAX = ["BTN", "SB", "BB", "UTG", "MP", "CO"];
function money(value) {
  if (value == null) return null;
  return Number(value.replace("$", ""));
}
function normalizeVerb(verb, hasTo) {
  const v = verb.toLowerCase();
  if (v === "folds") return "fold";
  if (v === "checks" || v === "calls") return "call";
  if (v === "bets" || v === "raises") return "raise";
  if (v === "posts") return null;
  if (hasTo) return "raise";
  return null;
}
function assignPositions(seatOrder, button) {
  if (!seatOrder.length) return {};
  const seats = [...seatOrder].sort((a, b) => a - b);
  let btn = button;
  if (!seats.includes(btn)) btn = seats[0];
  const idx = seats.indexOf(btn);
  const rotated = seats.slice(idx).concat(seats.slice(0, idx));
  const n = rotated.length;
  let labels;
  if (n === 2) labels = ["SB", "BB"];
  else if (n === 3) labels = ["BTN", "SB", "BB"];
  else if (n === 4) labels = ["BTN", "SB", "BB", "CO"];
  else if (n === 5) labels = ["BTN", "SB", "BB", "UTG", "CO"];
  else if (n <= 6) labels = SIX_MAX.slice(0, n);
  else {
    const extra = ["UTG+1", "UTG+2", "MP", "HJ", "CO"];
    labels = ["BTN", "SB", "BB", "UTG", ...extra.slice(0, n - 4)];
  }
  const out = {};
  rotated.forEach((seat, i) => {
    out[seat] = labels[i];
  });
  return out;
}
function detectSpot(actionsBefore, heroAction) {
  let raises = 0;
  let limps = 0;
  let callsAfterRaise = 0;
  for (const act of actionsBefore) {
    if (act === "raise") {
      raises += 1;
      callsAfterRaise = 0;
    } else if (act === "call") {
      if (raises === 0) limps += 1;
      else callsAfterRaise += 1;
    }
  }
  if (raises === 0) {
    if (limps > 0 && heroAction === "raise") return "iso";
    if (heroAction === "call" || heroAction === "check") return "limp";
    return "rfi";
  }
  if (raises === 1) {
    if (callsAfterRaise >= 1 && heroAction === "raise") return "squeeze";
    if (callsAfterRaise >= 1 && heroAction === "call") return "multiway";
    return "vs_open";
  }
  if (raises === 2) return "vs_3bet";
  return "vs_4bet";
}
function computeHeroNet(block, heroName = "Hero", bigBlind = null) {
  if (!block.trim()) return [null, null];
  const hero = heroName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let invested = 0;
  let streetIn = 0;
  let collected = 0;
  let returned = 0;
  let sawMoney = false;
  const postRe = new RegExp(`^${hero}: posts .+?\\$?([\\d.]+)`, "i");
  const callRe = new RegExp(`^${hero}: calls \\$?([\\d.]+)`, "i");
  const betRe = new RegExp(`^${hero}: bets \\$?([\\d.]+)`, "i");
  const raiseRe = new RegExp(`^${hero}: raises \\$?([\\d.]+) to \\$?([\\d.]+)`, "i");
  const returnedRe = new RegExp(`^Uncalled bet \\(\\$?([\\d.]+)\\) returned to ${hero}\\b`, "i");
  const collectedRe = new RegExp(`^${hero} collected \\$?([\\d.]+)`, "i");
  const summaryWonRe = new RegExp(
    `^Seat \\d+:\\s+${hero}\\b.+(?:won|collected) \\(\\$?([\\d.]+)\\)`,
    "i"
  );
  for (const raw of block.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const sm = STREET_RE.exec(line);
    if (sm) {
      const mapped = streetFromMarker(sm[1], sm[2]);
      if (mapped === "flop" || mapped === "turn" || mapped === "river" || mapped === "summary") {
        streetIn = 0;
      }
      continue;
    }
    let m = postRe.exec(line);
    if (m) {
      const amt = Number(m[1]);
      invested += amt;
      streetIn += amt;
      sawMoney = true;
      continue;
    }
    m = callRe.exec(line);
    if (m) {
      const amt = Number(m[1]);
      invested += amt;
      streetIn += amt;
      sawMoney = true;
      continue;
    }
    m = betRe.exec(line);
    if (m) {
      const amt = Number(m[1]);
      invested += amt;
      streetIn += amt;
      sawMoney = true;
      continue;
    }
    m = raiseRe.exec(line);
    if (m) {
      const toAmt = Number(m[2]);
      const delta = Math.max(0, toAmt - streetIn);
      invested += delta;
      streetIn = toAmt;
      sawMoney = true;
      continue;
    }
    m = returnedRe.exec(line);
    if (m) {
      returned += Number(m[1]);
      sawMoney = true;
      continue;
    }
    m = collectedRe.exec(line);
    if (m) {
      collected += Number(m[1]);
      sawMoney = true;
      continue;
    }
    if (collected === 0) {
      m = summaryWonRe.exec(line);
      if (m) {
        collected += Number(m[1]);
        sawMoney = true;
      }
    }
  }
  if (!sawMoney && invested === 0 && collected === 0) {
    return [0, bigBlind ? 0 : null];
  }
  const net = Math.round((collected + returned - invested) * 1e4) / 1e4;
  const netBb = bigBlind && bigBlind > 0 ? Math.round(net / bigBlind * 1e4) / 1e4 : null;
  return [net, netBb];
}
function playersWhoRevealed(block) {
  const names = /* @__PURE__ */ new Set();
  const revealAction = /^([^:\n]+?):\s*shows?\s*\[([2-9TJQKA][shdc](?:\s+[2-9TJQKA][shdc])?)\]/gim;
  const revealSummary = /^Seat\s+\d+:\s*(.+?)\s+(?:\([^)]*\)\s+)?(?:showed|mucked)\s*\[([2-9TJQKA][shdc](?:\s+[2-9TJQKA][shdc])?)\]/gim;
  for (const re of [revealAction, revealSummary]) {
    let m;
    const r = new RegExp(re.source, re.flags);
    while (m = r.exec(block)) {
      let name = m[1].trim().replace(/\s+\([^)]*\)\s*$/, "").trim().toLowerCase();
      if (name && !name.includes("***")) names.add(name);
    }
  }
  return names;
}
function detectWentToShowdown(block, heroName) {
  const revealed = playersWhoRevealed(block);
  const heroKey = heroName.trim().toLowerCase();
  if (!revealed.has(heroKey)) return false;
  for (const n of revealed) if (n !== heroKey) return true;
  return false;
}
function parseOne(block) {
  const lines = block.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const header = HEADER_RE.exec(lines[0]);
  if (!header) return null;
  const hid = header[1].trim();
  const sb = money(header[2]);
  const bb = money(header[3]);
  const playedAt = header[4].replace(/\//g, "-").replace(" ", "T") + "Z";
  let tableName = null;
  let tableMax = null;
  let button = 1;
  const seats = /* @__PURE__ */ new Map();
  let heroName = "Hero";
  let heroCards = null;
  let street = "preflop";
  const actions = [];
  let actionOrder = 0;
  const preflopVol = [];
  for (const line of lines.slice(1)) {
    const streetM = STREET_RE.exec(line);
    if (streetM) {
      street = streetFromMarker(streetM[1], streetM[2]);
      continue;
    }
    if (street === "summary") continue;
    const tableM = TABLE_RE.exec(line);
    if (tableM) {
      tableName = tableM[1];
      tableMax = Number(tableM[2]) || null;
      button = Number(tableM[3]);
      continue;
    }
    const seatM = SEAT_RE.exec(line);
    if (seatM) {
      if (/\bsitting out\b/i.test(line)) continue;
      seats.set(Number(seatM[1]), {
        name: seatM[2].trim(),
        stack: Number(seatM[3])
      });
      continue;
    }
    const dealtM = DEALT_RE.exec(line);
    if (dealtM) {
      const name = dealtM[1].trim();
      if (dealtM[2] && dealtM[3]) {
        heroName = name;
        heroCards = [dealtM[2], dealtM[3]];
      }
      continue;
    }
    const actM = ACTION_RE.exec(line);
    if (actM && ["preflop", "flop", "turn", "river"].includes(street)) {
      const name = actM[1].trim();
      const verb = actM[2];
      const amount = money(actM[4] || actM[3]);
      const norm = normalizeVerb(verb, Boolean(actM[4]));
      if (!norm) continue;
      actionOrder += 1;
      actions.push({
        street,
        action_order: actionOrder,
        player_name: name,
        is_hero: name.toLowerCase() === heroName.toLowerCase(),
        action: norm,
        amount
      });
      if (street === "preflop") {
        const pfAct = verb.toLowerCase() === "checks" ? "check" : norm;
        preflopVol.push([name, pfAct]);
      }
    }
  }
  const posMap = assignPositions([...seats.keys()], button);
  const nameToSeat = /* @__PURE__ */ new Map();
  for (const [seat, info] of seats) nameToSeat.set(info.name, seat);
  const heroSeat = nameToSeat.get(heroName);
  const heroPosition = heroSeat != null ? posMap[heroSeat] ?? null : null;
  let stackBb = null;
  if (heroSeat != null && bb) stackBb = seats.get(heroSeat).stack / bb;
  let heroHand = null;
  let heroHandCode = null;
  if (heroCards) {
    heroHand = `${heroCards[0]}${heroCards[1]}`.slice(0, 4);
    try {
      heroHandCode = cardsToHandCode(heroCards[0], heroCards[1]);
    } catch {
      heroHandCode = null;
    }
  }
  let heroPreflopAction = null;
  let detectedSpot = null;
  let villainPosition = null;
  const before = [];
  const beforePlayers = [];
  for (const [player, act] of preflopVol) {
    if (player.toLowerCase() === heroName.toLowerCase()) {
      heroPreflopAction = act === "check" ? "call" : act;
      detectedSpot = detectSpot(before, act);
      villainPosition = null;
      for (let i = 0; i < before.length; i++) {
        if (before[i] === "raise") {
          const seat = nameToSeat.get(beforePlayers[i]);
          villainPosition = seat != null ? posMap[seat] ?? null : null;
        }
      }
      if ((detectedSpot === "limp" || detectedSpot === "iso") && !villainPosition) {
        for (let i = before.length - 1; i >= 0; i--) {
          if (before[i] !== "call") continue;
          const seat = nameToSeat.get(beforePlayers[i]);
          villainPosition = seat != null ? posMap[seat] ?? null : null;
          break;
        }
      }
      before.push(act);
      beforePlayers.push(player);
      continue;
    }
    before.push(act);
    beforePlayers.push(player);
  }
  const [heroNet, heroNetBb] = computeHeroNet(block, heroName, bb);
  const went = detectWentToShowdown(block, heroName);
  const zeroBb = heroNetBb != null ? 0 : null;
  const seatList = [...seats.entries()].sort((a, b) => a[0] - b[0]).map(([seat, info]) => ({ seat, name: info.name, stack: info.stack }));
  return mergeFlagsIntoHand({
    external_hand_id: hid.slice(0, 64),
    raw_text: block.trim(),
    played_at: playedAt,
    table_name: tableName,
    table_max: tableMax ?? (seatList.length || null),
    button_seat: button,
    small_blind: sb,
    big_blind: bb,
    hero_name: heroName,
    hero_position: heroPosition,
    hero_hand: heroHand,
    hero_hand_code: heroHandCode,
    detected_spot: detectedSpot,
    villain_position: villainPosition,
    stack_bb: stackBb,
    hero_preflop_action: heroPreflopAction,
    hero_net: heroNet,
    hero_net_bb: heroNetBb,
    went_to_showdown: went,
    hero_net_wsd: went ? heroNet : 0,
    hero_net_wsd_bb: went ? heroNetBb : zeroBb,
    hero_net_wwsd: went ? 0 : heroNet,
    hero_net_wwsd_bb: went ? zeroBb : heroNetBb,
    seats: seatList,
    actions,
    vpip: false,
    pfr: false,
    three_bet: false,
    three_bet_opp: false
  });
}
function splitHandBlocks(text) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) return [];
  const parts = normalized.split(HAND_SPLIT_RE).map((p) => p.trim()).filter(Boolean);
  return parts;
}
function estimateHandCount(text) {
  const m = text.match(HAND_SPLIT_RE);
  return m ? m.length : text.includes("Hand #") ? 1 : 0;
}
function parseHandHistory(text) {
  const blocks = splitHandBlocks(text);
  const out = [];
  for (const block of blocks) {
    try {
      const hand = parseOne(block);
      if (hand) out.push(hand);
    } catch {
    }
  }
  return out;
}
const IDB_NAME = "pokerledger-local-v5";
const STORE_HANDS = "hands";
const STORE_META = "meta";
function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (db.objectStoreNames.contains(STORE_HANDS)) {
        db.deleteObjectStore(STORE_HANDS);
      }
      if (db.objectStoreNames.contains(STORE_META)) {
        db.deleteObjectStore(STORE_META);
      }
      const store = db.createObjectStore(STORE_HANDS, { keyPath: "key" });
      store.createIndex("by_strategy", "strategy_id", { unique: false });
      store.createIndex("by_external", "external_hand_id", { unique: false });
      db.createObjectStore(STORE_META, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}
let dbPromise = null;
function openLocalDb() {
  if (!dbPromise) dbPromise = openIdb();
  return dbPromise;
}
function handKey(strategyId, externalId) {
  return `${strategyId}::${externalId}`;
}
function trimTrainerActions(actions) {
  const preflop = [];
  let lastHeroIdx = -1;
  for (const a of actions) {
    if ((a.street || "").toLowerCase() !== "preflop") break;
    preflop.push(a);
    if (a.is_hero && ["raise", "call", "fold"].includes((a.action || "").toLowerCase())) {
      lastHeroIdx = preflop.length - 1;
    }
  }
  if (lastHeroIdx < 0) return preflop;
  return preflop.slice(0, lastHeroIdx + 1);
}
function toRow(strategyId, sessionId, h) {
  return {
    key: handKey(strategyId, h.external_hand_id),
    external_hand_id: h.external_hand_id,
    session_id: sessionId,
    strategy_id: strategyId,
    hero_name: h.hero_name,
    hero_position: h.hero_position,
    hero_hand: h.hero_hand,
    hero_hand_code: h.hero_hand_code,
    detected_spot: h.detected_spot,
    villain_position: h.villain_position,
    hero_preflop_action: h.hero_preflop_action,
    stack_bb: h.stack_bb,
    hero_net: h.hero_net,
    hero_net_bb: h.hero_net_bb,
    went_to_showdown: h.went_to_showdown,
    hero_net_wsd: h.hero_net_wsd,
    hero_net_wsd_bb: h.hero_net_wsd_bb,
    hero_net_wwsd: h.hero_net_wwsd,
    hero_net_wwsd_bb: h.hero_net_wwsd_bb,
    table_name: h.table_name,
    table_max: h.table_max ?? null,
    button_seat: h.button_seat ?? null,
    small_blind: h.small_blind,
    big_blind: h.big_blind,
    seats: Array.isArray(h.seats) ? h.seats : [],
    actions: trimTrainerActions(h.actions),
    preflop_actions: trimTrainerActions(h.actions),
    raw_text: h.raw_text,
    vpip: h.vpip ? 1 : 0,
    pfr: h.pfr ? 1 : 0,
    three_bet: h.three_bet ? 1 : 0,
    three_bet_opp: h.three_bet_opp ? 1 : 0,
    played_at: h.played_at,
    flags: h.flags ?? null
  };
}
async function clearStrategyHands(strategyId) {
  const db = await openLocalDb();
  const rows = await listHandsForStrategy(strategyId);
  if (!rows.length) return 0;
  await new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_HANDS], "readwrite");
    const store = tx.objectStore(STORE_HANDS);
    for (const r of rows) store.delete(r.key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("clear failed"));
  });
  return rows.length;
}
async function insertHandBatch(strategyId, sessionId, hands) {
  const db = await openLocalDb();
  let inserted = 0;
  let duplicates = 0;
  for (const h of hands) {
    const row = toRow(strategyId, sessionId, h);
    const existed = await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_HANDS], "readwrite");
      const store = tx.objectStore(STORE_HANDS);
      const getReq = store.get(row.key);
      getReq.onsuccess = () => {
        if (getReq.result) {
          resolve(true);
          return;
        }
        store.put(row);
        resolve(false);
      };
      getReq.onerror = () => reject(getReq.error ?? new Error("get failed"));
      tx.onerror = () => reject(tx.error ?? new Error("tx failed"));
    });
    if (existed) duplicates += 1;
    else inserted += 1;
  }
  return { inserted, duplicates };
}
async function listHandsForStrategy(strategyId) {
  const db = await openLocalDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_HANDS], "readonly");
    const idx = tx.objectStore(STORE_HANDS).index("by_strategy");
    const req = idx.getAll(strategyId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error ?? new Error("list hands failed"));
  });
}
async function flushLocalDb() {
}
const ctx = self;
function post(msg) {
  ctx.postMessage(msg);
}
function yieldTick() {
  return new Promise((r) => setTimeout(r, 0));
}
async function runImport(requestId, strategyId, files) {
  await openLocalDb();
  await clearStrategyHands(strategyId);
  const sessionId = `local-${Date.now().toString(36)}`;
  let totalEstimate = 0;
  for (const f of files) totalEstimate += Math.max(1, estimateHandCount(f.text));
  if (totalEstimate < 1) totalEstimate = 1;
  let done = 0;
  let insertedTotal = 0;
  let dupTotal = 0;
  let parsedTotal = 0;
  const emit = (phase, message, pct) => {
    post({
      type: "progress",
      requestId,
      progress: {
        done,
        total: totalEstimate,
        phase,
        message,
        pct: Math.min(99, Math.max(1, Math.round(pct)))
      }
    });
  };
  emit("parse", "Читаем файлы…", 2);
  for (let fi = 0; fi < files.length; fi++) {
    const file = files[fi];
    const blocks = splitHandBlocks(file.text);
    const chunkSize = 80;
    for (let i = 0; i < blocks.length; i += chunkSize) {
      const slice = blocks.slice(i, i + chunkSize);
      const text = slice.join("\n\n");
      const hands = parseHandHistory(text);
      parsedTotal += hands.length;
      const { inserted, duplicates } = await insertHandBatch(strategyId, sessionId, hands);
      insertedTotal += inserted;
      dupTotal += duplicates;
      done += slice.length;
      const pct = 5 + done / totalEstimate * 70;
      emit(
        "parse",
        `Парсинг ${file.name} · ${Math.min(done, totalEstimate).toLocaleString("ru-RU")} / ${totalEstimate.toLocaleString("ru-RU")}`,
        pct
      );
      await yieldTick();
    }
  }
  await flushLocalDb();
  emit("hud", "Собираем HUD и график…", 88);
  post({
    type: "done",
    requestId,
    result: {
      strategyId,
      handsInserted: insertedTotal,
      duplicatesSkipped: dupTotal,
      handsParsed: parsedTotal,
      hands: parsedTotal,
      sessionId
    }
  });
}
ctx.onmessage = (ev) => {
  const msg = ev.data;
  if (msg.type === "init") {
    void openLocalDb().then(() => post({ type: "ready" })).catch(
      (err) => post({
        type: "error",
        requestId: 0,
        message: err instanceof Error ? err.message : "Local DB failed"
      })
    );
    return;
  }
  if (msg.type === "import") {
    void runImport(msg.requestId, msg.strategyId, msg.files).catch((err) => {
      post({
        type: "error",
        requestId: msg.requestId,
        message: err instanceof Error ? err.message : "Import failed"
      });
    });
  }
};
