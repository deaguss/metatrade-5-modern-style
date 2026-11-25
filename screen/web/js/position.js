// The long and short position tools' numbers: distances, risk : reward, and the lots that risk the
// chosen amount, worked out with the symbol's own contract specification from MT5.
import { pipSize } from './util.js';

// spec: {digits, point, tickSize, tickValue, volMin, volStep, volMax} from MT5 (tickValue is the
// money one lot makes or loses per tick, in the account currency). Without it the quantity is in
// units of the symbol (risk money / stop distance).
export function positionStats({ side, entry, stop, target, spec, symbol, accountSize, risk, riskMode, price }) {
  const stopDist = Math.abs(entry - stop);
  const targetDist = Math.abs(target - entry);
  const digits = spec ? spec.digits : 5;
  const point = spec ? spec.point : Math.pow(10, -digits);
  const pip = pipSize(symbol || '', digits, point) || point;
  const riskMoney = riskMode === 'money' ? Number(risk) || 0 : ((Number(accountSize) || 0) * (Number(risk) || 0)) / 100;

  const out = {
    stopDist,
    targetDist,
    stopPct: entry ? (stopDist / entry) * 100 : 0,
    targetPct: entry ? (targetDist / entry) * 100 : 0,
    stopPips: pip ? stopDist / pip : 0,
    targetPips: pip ? targetDist / pip : 0,
    rr: stopDist > 0 ? targetDist / stopDist : 0,
    riskMoney,
    lots: 0,
    units: 0,
    stopAmount: 0,
    targetAmount: 0,
    tooSmall: false,
    openPL: null,
  };

  // MT5 gives a tick's value for a loss and for a profit (they differ when the account's currency
  // is neither of the symbol's): the stop and the lots use the loss, the target the profit.
  const perLot = spec && spec.tickSize > 0 && spec.tickValue > 0 ? (dist) => (dist / spec.tickSize) * spec.tickValue : null;
  const perLotProfit = perLot && spec.tickValueProfit > 0 ? (dist) => (dist / spec.tickSize) * spec.tickValueProfit : perLot;
  if (perLot && stopDist > 0) {
    const exact = riskMoney / perLot(stopDist);
    const step = spec.volStep > 0 ? spec.volStep : 0.01;
    let lots = Math.floor(exact / step + 1e-9) * step;
    if (spec.volMax > 0) lots = Math.min(lots, spec.volMax);
    out.exactLots = exact;
    out.minLots = spec.volMin > 0 ? spec.volMin : step;
    if (spec.volMin > 0 && lots < spec.volMin) {
      // Not tradable: the amounts show what the trader meant to risk.
      out.tooSmall = true;
      out.lots = 0;
      out.stopAmount = riskMoney;
      out.targetAmount = riskMoney * out.rr;
      return out;
    }
    out.lots = Number(lots.toFixed(8));
    out.stopAmount = out.lots * perLot(stopDist);
    out.targetAmount = out.lots * perLotProfit(targetDist);
    if (Number.isFinite(price)) {
      const gain = (price - entry) * side;
      out.openPL = gain >= 0 ? out.lots * perLotProfit(gain) : -out.lots * perLot(-gain);
    }
  } else if (stopDist > 0) {
    out.units = riskMoney / stopDist;
    out.stopAmount = riskMoney;
    out.targetAmount = out.units * targetDist;
    if (Number.isFinite(price)) out.openPL = out.units * (price - entry) * side;
  }
  return out;
}

// A position's stop and target at the given distances from its entry.
export function levelsFor(side, entry, stopDistance, targetDistance) {
  return { stop: entry - side * stopDistance, target: entry + side * targetDistance };
}
