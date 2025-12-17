import type { OpenFrontRuntime } from "./openfrontLoader";
import type { EconomyTotals, PlayerSummary } from "./types";

export function summarizePlayers(
  openfront: OpenFrontRuntime,
  game: any,
  maxTilesBySmallID: ReadonlyMap<number, number>,
  economyTotalsByClientId: ReadonlyMap<string, EconomyTotals>,
  goldEarnedReplayByClientId: ReadonlyMap<string, bigint>,
): PlayerSummary[] {
  const unitTypes = Object.values(openfront.Game.UnitType) as any[];
  return (game.allPlayers?.() ?? []).map((p: any) => {
    const unitsOwned: Partial<Record<string, number>> = {};
    for (const t of unitTypes) {
      const count = p.unitsOwned(t);
      if (count > 0) {
        unitsOwned[String(t)] = count;
      }
    }
    return {
      smallID: p.smallID(),
      clientID: p.clientID(),
      type: String(p.type()),
      name: p.name(),
      displayName: p.displayName(),
      isAlive: p.isAlive(),
      isDisconnected: p.isDisconnected(),
      tilesOwned: p.numTilesOwned(),
      tilesOwnedMax: maxTilesBySmallID.get(p.smallID()) ?? p.numTilesOwned(),
      troops: p.troops(),
      gold: (Number(p.gold()) / 1000).toFixed(1),
      goldEarnedTotal: (() => {
        const cid = p.clientID();
        if (!cid) return null;
        const totals = economyTotalsByClientId.get(cid);
        return totals ? (Number(totals.earnedTotal) / 1000).toFixed(1) : null;
      })(),
      goldSpentTotal: (() => {
        const cid = p.clientID();
        if (!cid) return null;
        const totals = economyTotalsByClientId.get(cid);
        return totals ? (Number(totals.spentTotal) / 1000).toFixed(1) : null;
      })(),
      goldLostConquestTotal: (() => {
        const cid = p.clientID();
        if (!cid) return null;
        const totals = economyTotalsByClientId.get(cid);
        return totals ? (Number(totals.lostConquest) / 1000).toFixed(1) : null;
      })(),
      goldEarnedTradeTotal: (() => {
        const cid = p.clientID();
        if (!cid) return null;
        const totals = economyTotalsByClientId.get(cid);
        return totals ? (Number(totals.earnedTrade) / 1000).toFixed(1) : null;
      })(),
      goldEarnedTrainTotal: (() => {
        const cid = p.clientID();
        if (!cid) return null;
        const totals = economyTotalsByClientId.get(cid);
        return totals ? (Number(totals.earnedTrain) / 1000).toFixed(1) : null;
      })(),
      goldEarnedConquerTotal: (() => {
        const cid = p.clientID();
        if (!cid) return null;
        const totals = economyTotalsByClientId.get(cid);
        return totals ? (Number(totals.earnedConquer) / 1000).toFixed(1) : null;
      })(),
      goldEarnedOtherTotal: (() => {
        const cid = p.clientID();
        if (!cid) return null;
        const totals = economyTotalsByClientId.get(cid);
        return totals ? (Number(totals.earnedOther) / 1000).toFixed(1) : null;
      })(),
      goldEarnedReplayTotal: (() => {
        const cid = p.clientID();
        if (!cid) return null;
        const earned = goldEarnedReplayByClientId.get(cid);
        return earned !== undefined ? (Number(earned) / 1000).toFixed(1) : null;
      })(),
      unitsOwned,
    };
  });
}
