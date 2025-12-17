import type { EconomyReport, EconomyTotals } from "./types";
import { asBigInt, bigintToNumberSafe, minBigInt } from "./utils";

type GoldStats = { work: bigint; war: bigint; trade: bigint; steal: bigint; train: bigint };

function readGoldStatsForClient(allPlayersStats: any, clientID: string): GoldStats {
  const ps = allPlayersStats?.[clientID];
  const gold = ps?.gold;
  if (!Array.isArray(gold)) {
    return { work: 0n, war: 0n, trade: 0n, steal: 0n, train: 0n };
  }
  return {
    work: asBigInt(gold[0]) ?? 0n,
    war: asBigInt(gold[1]) ?? 0n,
    trade: asBigInt(gold[2]) ?? 0n,
    steal: asBigInt(gold[3]) ?? 0n,
    train: asBigInt(gold[4]) ?? 0n,
  };
}

function topEconomyClientIds(
  totalsByClientId: ReadonlyMap<string, EconomyTotals>,
  metric: keyof EconomyTotals,
  n: number,
): string[] {
  return [...totalsByClientId.entries()]
    .sort((a, b) => {
      const av = a[1][metric];
      const bv = b[1][metric];
      if (av === bv) return a[0].localeCompare(b[0]);
      return av > bv ? -1 : 1;
    })
    .slice(0, n)
    .map(([cid]) => cid);
}

export type EconomyTracker = {
  totalsByClientId: ReadonlyMap<string, EconomyTotals>;
  init: (game: any) => void;
  afterTick: (game: any, turnNumber: number, conquestEvents: any[], isLast: boolean) => void;
  buildReport: () => EconomyReport;
};

export function createEconomyTracker(opts: { sampleEveryTurns: number; topN: number }): EconomyTracker {
  const totalsByClientId = new Map<string, EconomyTotals>();
  const turns: number[] = [];
  const players: { clientID: string; displayName: string }[] = [];
  const seriesByClientId: Record<string, EconomyPlayerSeries> = {};
  const goldSourcesByClientId: Record<string, GoldSourceBreakdown> = {};
  const goldSourceSeriesByClientId: Record<string, GoldSourceSeries> = {};

  const playerByClientId = new Map<string, any>();
  const prevGoldByClientId = new Map<string, bigint>();
  const prevGoldStatsByClientId = new Map<string, GoldStats>();
  const clientIdByPlayerId = new Map<string, string>();
  const prevGoldSourcesByClientId = new Map<string, GoldSourceBreakdown>();
  const troopSourcesByClientId: Record<string, TroopSourceBreakdown> = {};
  const troopSourceSeriesByClientId: Record<string, TroopSourceSeries> = {};
  const prevTroopSourcesByClientId = new Map<string, TroopSourceBreakdown>();

  function ensurePlayer(p: any) {
    const cid = p.clientID();
    if (!cid) return;
    if (seriesByClientId[cid]) return;

    players.push({ clientID: cid, displayName: p.displayName() });
    seriesByClientId[cid] = {
      earnedTrade: [],
      earnedTrain: [],
      earnedConquer: [],
      earnedOther: [],
      spentTotal: [],
      spentOther: [],
      lostConquest: [],
      sentGoldDonations: [],
      receivedGoldDonations: [],
      sentTroopDonations: [],
      receivedTroopDonations: [],
      tilesOwned: [],
    };
    totalsByClientId.set(cid, {
      earnedTotal: 0n,
      earnedTrade: 0n,
      earnedTrain: 0n,
      earnedConquer: 0n,
      earnedOther: 0n,
      spentTotal: 0n,
      spentOther: 0n,
      lostConquest: 0n,
      sentGoldDonations: 0n,
      receivedGoldDonations: 0n,
      sentTroopDonations: 0n,
      receivedTroopDonations: 0n,
    });
    goldSourcesByClientId[cid] = {};
    goldSourceSeriesByClientId[cid] = {};
    troopSourcesByClientId[cid] = {};
    troopSourceSeriesByClientId[cid] = {};

    // Hook the addGold method to track callers
    const originalAddGold = p.addGold;
    p.addGold = function(toAdd: bigint, tile?: any) {
      // Find the first non-tracker function in the stack trace
      const stack = new Error().stack || '';
      const stackLines = stack.split('\n').slice(1); // Skip the first line (Error itself)

      let callerFunction = 'unknown';
      for (const line of stackLines) {
        // Skip lines that are part of our tracking code
        if (line.includes('economyTracker') || line.includes('at addGold')) {
          continue;
        }

        // Extract function name from stack trace
        const match = line.match(/at\s+([^\s(]+(?:\.[^\s(]+)?)\s*\(/);
        if (match) {
          callerFunction = match[1];
          break; // Use the first valid function found
        }
      }

      // Track the gold source cumulatively
      if (!goldSourcesByClientId[cid][callerFunction]) {
        goldSourcesByClientId[cid][callerFunction] = 0n;
      }
      goldSourcesByClientId[cid][callerFunction] += toAdd;

      // Call original method
      return originalAddGold.call(this, toAdd, tile);
    };

    // Hook addTroops for donation tracking
    const originalAddTroops = p.addTroops;
    p.addTroops = function(toAdd: number) {
      // Analyze stack trace to determine troop source
      const stack = new Error().stack || '';
      let callerFunction = 'unknown';

      // Split stack into lines and find the most relevant caller
      const stackLines = stack.split('\n').slice(1); // Skip the first line (Error itself)

      for (const line of stackLines) {
        // Skip lines that are part of our tracking code
        if (line.includes('economyTracker') || line.includes('at addTroops')) {
          continue;
        }

        // Look for function names in the stack
        const match = line.match(/at\s+([^\s(]+(?:\.[^\s(]+)?)\s*\(/);
        if (match) {
          const functionName = match[1];

          // Categorize based on known patterns
          if (functionName.includes('donateTroops')) {
            callerFunction = 'receivedTroopDonation';
            break;
          } else if (functionName.includes('PlayerExecution')) {
            callerFunction = 'workers';
            break;
          }
          // Add more patterns as needed
        }
      }

      // Track troop changes (for donations)
      if (callerFunction === 'receivedTroopDonation') {
        // This is a received troop donation
        if (!troopSourcesByClientId[cid]['receivedTroopDonation']) {
          troopSourcesByClientId[cid]['receivedTroopDonation'] = 0n;
        }
        troopSourcesByClientId[cid]['receivedTroopDonation'] += BigInt(Math.round(toAdd));
      }

      // Call original method
      return originalAddTroops.call(this, toAdd);
    };

    // Hook donateGold for sent donation tracking
    if (p.donateGold) {
      const originalDonateGold = p.donateGold;
      p.donateGold = function(recipient: any, gold: bigint) {
        // Track sent gold donation
        if (!goldSourcesByClientId[cid]['sentGoldDonation']) {
          goldSourcesByClientId[cid]['sentGoldDonation'] = 0n;
        }
        goldSourcesByClientId[cid]['sentGoldDonation'] += gold;

        // Call original method
        return originalDonateGold.call(this, recipient, gold);
      };
    }

    // Hook donateTroops for sent donation tracking
    if (p.donateTroops) {
      const originalDonateTroops = p.donateTroops;
      p.donateTroops = function(recipient: any, troops: number) {
        // Track sent troop donation
        if (!troopSourcesByClientId[cid]['sentTroopDonation']) {
          troopSourcesByClientId[cid]['sentTroopDonation'] = 0n;
        }
        troopSourcesByClientId[cid]['sentTroopDonation'] += BigInt(Math.round(troops));

        // Call original method
        return originalDonateTroops.call(this, recipient, troops);
      };
    }

    playerByClientId.set(cid, p);
    prevGoldByClientId.set(cid, p.gold());
    prevGoldStatsByClientId.set(cid, { work: 0n, war: 0n, trade: 0n, steal: 0n, train: 0n });
    prevGoldSourcesByClientId.set(cid, {});
    prevTroopSourcesByClientId.set(cid, {});
  }

  return {
    totalsByClientId,
    init: (game: Game) => {
      for (const p of game.allPlayers()) {
        if (!p.isPlayer()) continue;
        ensurePlayer(p);
        const cid = p.clientID();
        if (cid) {
          clientIdByPlayerId.set(String(p.id()), cid);
        }
      }

      const initialStats = game.stats().stats();
      for (const { clientID: cid } of players) {
        // Initialize with zeros to track stats accumulation during replay
        prevGoldStatsByClientId.set(cid, { work: 0n, war: 0n, trade: 0n, steal: 0n, train: 0n });
      }
    },
    afterTick: (game: Game, turnNumber: number, conquestEvents: ConquestUpdate[], isLast: boolean) => {
      const conquestLossByClientIdThisTick = new Map<string, bigint>();
      for (const cu of conquestEvents ?? []) {
        const conqueredId = String((cu as any).conqueredId ?? "");
        const gold = asBigInt((cu as any).gold) ?? 0n;
        if (!conqueredId || gold <= 0n) continue;
        const cid = clientIdByPlayerId.get(conqueredId);
        if (!cid) continue;
        conquestLossByClientIdThisTick.set(cid, (conquestLossByClientIdThisTick.get(cid) ?? 0n) + gold);
      }

      // Calculate gold source changes for this turn

      const allStats = game.stats().stats();
      for (const { clientID: cid } of players) {
        const p = playerByClientId.get(cid) ?? game.playerByClientID(cid);
        if (!p) continue;
        playerByClientId.set(cid, p);

        const goldNow = p.gold();
        const goldPrev = prevGoldByClientId.get(cid) ?? goldNow;
        const deltaBalance = goldNow - goldPrev;

        const currGoldStats = readGoldStatsForClient(allStats, cid);
        const prevGoldStats = prevGoldStatsByClientId.get(cid) ?? currGoldStats;


        const dWork = currGoldStats.work > prevGoldStats.work ? (currGoldStats.work - prevGoldStats.work) : 0n;
        const dWar = currGoldStats.war > prevGoldStats.war ? (currGoldStats.war - prevGoldStats.war) : 0n;
        const dTrade = currGoldStats.trade > prevGoldStats.trade ? (currGoldStats.trade - prevGoldStats.trade) : 0n;
        const dSteal = currGoldStats.steal > prevGoldStats.steal ? (currGoldStats.steal - prevGoldStats.steal) : 0n;
        // Try stats diff first, fall back to gold source diff
        let dTrain = currGoldStats.train - prevGoldStats.train;
        if (dTrain <= 0n) {
          // Fallback to gold source tracking
          const prevSources = prevGoldSourcesByClientId.get(cid) || {};
          const currSources = goldSourcesByClientId[cid] || {};
          dTrain = (currSources.trains || 0n) - (prevSources.trains || 0n);
        }

        const deltaKnownEarned = dWork + dWar + dTrade + dSteal + dTrain;
        const residual = deltaBalance - deltaKnownEarned;
        const deltaEarnedOther = residual > 0n ? residual : 0n;
        const deltaOutflow = residual < 0n ? -residual : 0n;

        const conquestLoss = conquestLossByClientIdThisTick.get(cid) ?? 0n;
        const deltaLostConquest = minBigInt(deltaOutflow, conquestLoss);
        const deltaSpentOther = deltaOutflow - deltaLostConquest;

        // Calculate donation diffs
        const prevGoldSources = prevGoldSourcesByClientId.get(cid) || {};
        const currGoldSources = goldSourcesByClientId[cid] || {};
        const prevTroopSources = prevTroopSourcesByClientId.get(cid) || {};
        const currTroopSources = troopSourcesByClientId[cid] || {};

        const dSentGoldDonations = (currGoldSources.sentGoldDonation || 0n) - (prevGoldSources.sentGoldDonation || 0n);
        const dReceivedGoldDonations = (currGoldSources.receivedGoldDonation || 0n) - (prevGoldSources.receivedGoldDonation || 0n);
        const dSentTroopDonations = (currTroopSources.sentTroopDonation || 0n) - (prevTroopSources.sentTroopDonation || 0n);
        const dReceivedTroopDonations = (currTroopSources.receivedTroopDonation || 0n) - (prevTroopSources.receivedTroopDonation || 0n);

        const totals = totalsByClientId.get(cid);
        if (totals) {
          totals.earnedTrade += dTrade;
          totals.earnedTrain += dTrain;
          totals.earnedConquer += dWar;
          totals.earnedOther += deltaEarnedOther;
          totals.earnedTotal += deltaKnownEarned + deltaEarnedOther;
          totals.spentTotal += deltaOutflow;
          totals.spentOther += deltaSpentOther;
          totals.lostConquest += deltaLostConquest;
          totals.sentGoldDonations += dSentGoldDonations;
          totals.receivedGoldDonations += dReceivedGoldDonations;
          totals.sentTroopDonations += dSentTroopDonations;
          totals.receivedTroopDonations += dReceivedTroopDonations;
        }

        prevGoldByClientId.set(cid, goldNow);
        prevGoldStatsByClientId.set(cid, currGoldStats);

        // Update previous gold sources
        prevGoldSourcesByClientId.set(cid, { ...goldSourcesByClientId[cid] });
        prevTroopSourcesByClientId.set(cid, { ...troopSourcesByClientId[cid] });
      }

      const shouldSample = turnNumber % opts.sampleEveryTurns === 0 || isLast;
      if (shouldSample) {
        turns.push(turnNumber);
        for (const { clientID: cid } of players) {
          const p = playerByClientId.get(cid);
          if (!p) continue;

          const totals = totalsByClientId.get(cid);
          const series = seriesByClientId[cid];
          const sourceSeries = goldSourceSeriesByClientId[cid];
          if (!totals || !series) continue;
          series.earnedTrade.push(bigintToNumberSafe(totals.earnedTrade) / 1000);
          series.earnedTrain.push(bigintToNumberSafe(totals.earnedTrain) / 1000);
          series.earnedConquer.push(bigintToNumberSafe(totals.earnedConquer) / 1000);
          series.earnedOther.push(bigintToNumberSafe(totals.earnedOther) / 1000);
          series.spentTotal.push(bigintToNumberSafe(totals.spentTotal) / 1000);
          series.spentOther.push(bigintToNumberSafe(totals.spentOther) / 1000);
          series.lostConquest.push(bigintToNumberSafe(totals.lostConquest) / 1000);
          series.sentGoldDonations.push(bigintToNumberSafe(totals.sentGoldDonations) / 1000);
          series.receivedGoldDonations.push(bigintToNumberSafe(totals.receivedGoldDonations) / 1000);
          series.sentTroopDonations.push(bigintToNumberSafe(totals.sentTroopDonations));
          series.receivedTroopDonations.push(bigintToNumberSafe(totals.receivedTroopDonations));
          series.tilesOwned.push(p.numTilesOwned());

          // Sample gold sources - ensure all series have entries for this sample point
          const sources = goldSourcesByClientId[cid];

          // First, ensure all existing series have an entry for this sample point
          for (const callerFunction of Object.keys(sourceSeries)) {
            const currentValue = sources[callerFunction] || 0n;
            // Divide gold-related values by 1000 for display
            const isGoldValue = callerFunction.includes('Gold') || ['workers', 'trains', 'trade', 'conquest', 'unknown'].includes(callerFunction);
            const displayValue = isGoldValue ? bigintToNumberSafe(currentValue) / 1000 : bigintToNumberSafe(currentValue);
            sourceSeries[callerFunction].push(displayValue);
          }

          // Then add any new functions that appeared this turn
          for (const callerFunction of Object.keys(sources)) {
            if (!sourceSeries[callerFunction]) {
              // New function - create series with 0s for all previous sample points
              const isGoldValue = callerFunction.includes('Gold') || ['workers', 'trains', 'trade', 'conquest', 'unknown'].includes(callerFunction);
              const fillValue = isGoldValue ? 0 : 0; // Both are 0, but keeping logic for clarity
              sourceSeries[callerFunction] = new Array(turns.length - 1).fill(fillValue);
              const currentValue = bigintToNumberSafe(sources[callerFunction]);
              const displayValue = isGoldValue ? currentValue / 1000 : currentValue;
              sourceSeries[callerFunction].push(displayValue);
            }
          }

          // Handle troop source series
          const troopSeries = troopSourceSeriesByClientId[cid];
          const troopSources = troopSourcesByClientId[cid];

          // First, ensure all existing troop series have an entry for this sample point
          for (const callerFunction of Object.keys(troopSeries)) {
            const currentValue = troopSources[callerFunction] || 0n;
            troopSeries[callerFunction].push(bigintToNumberSafe(currentValue));
          }

          // Then add any new troop functions that appeared this turn
          for (const callerFunction of Object.keys(troopSources)) {
            if (!troopSeries[callerFunction]) {
              // New function - create series with 0s for all previous sample points
              troopSeries[callerFunction] = new Array(turns.length - 1).fill(0);
              troopSeries[callerFunction].push(bigintToNumberSafe(troopSources[callerFunction]));
            }
          }
        }
      }
    },
    buildReport: () => {
      // Convert BigInts to numbers for JSON serialization
      const goldSourcesByClientIdSerializable: Record<string, Record<string, number>> = {};
      for (const [clientId, sources] of Object.entries(goldSourcesByClientId)) {
        goldSourcesByClientIdSerializable[clientId] = {};
        for (const [func, amount] of Object.entries(sources)) {
          // Divide gold-related values by 1000 for display
          const isGoldValue = func.includes('Gold') || ['workers', 'trains', 'trade', 'conquest', 'unknown'].includes(func);
          const displayValue = isGoldValue ? bigintToNumberSafe(amount) / 1000 : bigintToNumberSafe(amount);
          goldSourcesByClientIdSerializable[clientId][func] = displayValue;
        }
      }

      // Serialize troop sources
      const troopSourcesByClientIdSerializable: Record<string, Record<string, number>> = {};
      for (const [clientId, sources] of Object.entries(troopSourcesByClientId)) {
        troopSourcesByClientIdSerializable[clientId] = {};
        for (const [func, amount] of Object.entries(sources)) {
          troopSourcesByClientIdSerializable[clientId][func] = bigintToNumberSafe(amount);
        }
      }

      return {
        sampleEveryTurns: opts.sampleEveryTurns,
        turns,
        players,
        seriesByClientId,
        goldSourcesByClientId: goldSourcesByClientIdSerializable,
        goldSourceSeriesByClientId,
        troopSourcesByClientId: troopSourcesByClientIdSerializable,
        troopSourceSeriesByClientId,
        top: {
          earnedTrade: topEconomyClientIds(totalsByClientId, "earnedTrade", opts.topN),
          earnedTrain: topEconomyClientIds(totalsByClientId, "earnedTrain", opts.topN),
          earnedConquer: topEconomyClientIds(totalsByClientId, "earnedConquer", opts.topN),
          earnedOther: topEconomyClientIds(totalsByClientId, "earnedOther", opts.topN),
          spentTotal: topEconomyClientIds(totalsByClientId, "spentTotal", opts.topN),
          sentGoldDonations: topEconomyClientIds(totalsByClientId, "sentGoldDonations", opts.topN),
          receivedGoldDonations: topEconomyClientIds(totalsByClientId, "receivedGoldDonations", opts.topN),
          sentTroopDonations: topEconomyClientIds(totalsByClientId, "sentTroopDonations", opts.topN),
          receivedTroopDonations: topEconomyClientIds(totalsByClientId, "receivedTroopDonations", opts.topN),
        },
      };
    },
  };
}
