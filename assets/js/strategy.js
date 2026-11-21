/**
 * Basic strategy chart and lookup.
 *
 * Every row lists the play for dealer upcards 2, 3, 4, 5, 6, 7, 8, 9, 10, A.
 * Codes match the reference chart:
 *   H  = Hit            S  = Stand
 *   D  = Double if allowed, otherwise hit
 *   Ds = Double if allowed, otherwise stand
 *   Y  = Split          N  = Don't split
 *   Y/N = Split only if double after split (DAS) is offered
 */
(function (BJ) {
  'use strict';

  const ACTIONS = Object.freeze({
    HIT: 'hit',
    STAND: 'stand',
    DOUBLE: 'double',
    SPLIT: 'split',
    SURRENDER: 'surrender',
  });

  const ACTION_LABELS = Object.freeze({
    hit: 'Hit',
    stand: 'Stand',
    double: 'Double',
    split: 'Split',
    surrender: 'Surrender',
  });

  const CODE_MEANINGS = Object.freeze({
    H: 'Hit',
    S: 'Stand',
    D: 'Double if allowed, otherwise hit',
    Ds: 'Double if allowed, otherwise stand',
    Y: 'Split the pair',
    N: "Don't split the pair",
    'Y/N': 'Split only if DAS is offered',
    SUR: 'Surrender',
  });

  const row = (s) => Object.freeze(s.trim().split(/\s+/));

  // Keyed by hard total. Totals above 17 use the 17 row, below 8 use the 8 row.
  const HARD = Object.freeze({
    17: row('S  S  S  S  S  S  S  S  S  S'),
    16: row('S  S  S  S  S  H  H  H  H  H'),
    15: row('S  S  S  S  S  H  H  H  H  H'),
    14: row('S  S  S  S  S  H  H  H  H  H'),
    13: row('S  S  S  S  S  H  H  H  H  H'),
    12: row('H  H  S  S  S  H  H  H  H  H'),
    11: row('D  D  D  D  D  D  D  D  D  D'),
    10: row('D  D  D  D  D  D  D  D  H  H'),
    9:  row('H  D  D  D  D  H  H  H  H  H'),
    8:  row('H  H  H  H  H  H  H  H  H  H'),
  });

  // Keyed by soft total: 20 = A,9 ... 13 = A,2.
  const SOFT = Object.freeze({
    20: row('S  S  S  S  S  S  S  S  S  S'),
    19: row('S  S  S  S  Ds S  S  S  S  S'),
    18: row('Ds Ds Ds Ds Ds S  S  H  H  H'),
    17: row('H  D  D  D  D  H  H  H  H  H'),
    16: row('H  H  D  D  D  H  H  H  H  H'),
    15: row('H  H  D  D  D  H  H  H  H  H'),
    14: row('H  H  H  D  D  H  H  H  H  H'),
    13: row('H  H  H  D  D  H  H  H  H  H'),
  });

  // Keyed by the value of one card in the pair (11 = aces).
  const PAIRS = Object.freeze({
    11: row('Y   Y   Y   Y   Y   Y   Y   Y   Y   Y'),
    10: row('N   N   N   N   N   N   N   N   N   N'),
    9:  row('Y   Y   Y   Y   Y   N   Y   Y   N   N'),
    8:  row('Y   Y   Y   Y   Y   Y   Y   Y   Y   Y'),
    7:  row('Y   Y   Y   Y   Y   Y   N   N   N   N'),
    6:  row('Y/N Y   Y   Y   Y   N   N   N   N   N'),
    5:  row('N   N   N   N   N   N   N   N   N   N'),
    4:  row('N   N   N   Y/N Y/N N   N   N   N   N'),
    3:  row('Y/N Y/N Y   Y   Y   Y   N   N   N   N'),
    2:  row('Y/N Y/N Y   Y   Y   Y   N   N   N   N'),
  });

  // Late surrender: hard total -> dealer upcard values (11 = ace).
  const SURRENDER = Object.freeze({
    16: Object.freeze([9, 10, 11]),
    15: Object.freeze([10]),
  });

  const DEFAULT_RULES = Object.freeze({
    doubleAfterSplit: true,
    surrender: true,
  });

  const columnFor = (upValue) => upValue - 2; // 2 -> 0 ... 11 (A) -> 9

  const upcardName = (upValue) => (upValue === 11 ? 'A' : String(upValue));

  /** Resolve a hard/soft chart code into a concrete action. */
  function resolvePlayCode(code, canDouble) {
    switch (code) {
      case 'H': return ACTIONS.HIT;
      case 'S': return ACTIONS.STAND;
      case 'D': return canDouble ? ACTIONS.DOUBLE : ACTIONS.HIT;
      case 'Ds': return canDouble ? ACTIONS.DOUBLE : ACTIONS.STAND;
      default: throw new Error(`Unknown chart code: ${code}`);
    }
  }

  function lookupTotals(total, soft, col) {
    if (soft && total >= 13 && total <= 20) {
      return { table: 'soft', code: SOFT[total][col] };
    }
    const key = Math.min(17, Math.max(8, total));
    return { table: 'hard', code: HARD[key][col] };
  }

  /**
   * Work out the basic-strategy play for an opening two-card hand.
   *
   * @param {Array} cards  Player cards ({ rank, value }).
   * @param {number} upValue  Dealer upcard value, 2-11 (11 = ace).
   * @param {object} [rules]  { doubleAfterSplit, surrender }
   * @returns {{ action: string, table: string, code: string, notes: string[] }}
   */
  function getCorrectAction(cards, upValue, rules = DEFAULT_RULES) {
    const { total, soft } = BJ.cards.handTotal(cards);
    const col = columnFor(upValue);
    const isOpening = cards.length === 2;
    const isPair = isOpening && BJ.cards.isPair(cards);
    const notes = [];

    // 1. Pair splitting takes precedence (e.g. 8,8 vs 10 splits rather than surrenders).
    if (isPair) {
      const pairCode = PAIRS[cards[0].value][col];
      if (pairCode === 'Y') {
        return { action: ACTIONS.SPLIT, table: 'pair', code: pairCode, notes };
      }
      if (pairCode === 'Y/N') {
        if (rules.doubleAfterSplit) {
          notes.push('Split because double after split (DAS) is enabled.');
          return { action: ACTIONS.SPLIT, table: 'pair', code: pairCode, notes };
        }
        notes.push('This pair is only split when DAS is offered, so play it as a normal total.');
      } else {
        notes.push(`Don't split — play it as ${soft ? 'soft' : 'hard'} ${total}.`);
      }
    }

    // 2. Late surrender (hard totals only).
    if (rules.surrender && isOpening && !soft) {
      const surrenderUps = SURRENDER[total];
      if (surrenderUps && surrenderUps.includes(upValue)) {
        return { action: ACTIONS.SURRENDER, table: 'surrender', code: 'SUR', notes };
      }
    }
    if (!rules.surrender && !soft && SURRENDER[total] && SURRENDER[total].includes(upValue)) {
      notes.push('The chart says surrender here, but surrender is turned off.');
    }

    // 3. Hard / soft totals.
    const { table, code } = lookupTotals(total, soft, col);
    if (!isOpening && (code === 'D' || code === 'Ds')) {
      notes.push(`You can only double on your first two cards, so ${code === 'D' ? 'hit' : 'stand'}.`);
    }
    return { action: resolvePlayCode(code, isOpening), table, code, notes };
  }

  /** Human-readable description of a hand, e.g. "Soft 18 (A,7) vs 6". */
  function describeSituation(cards, upValue) {
    const { total, soft } = BJ.cards.handTotal(cards);
    const vs = `vs dealer ${upcardName(upValue)}`;
    if (cards.length === 2 && BJ.cards.isPair(cards)) {
      const r = cards[0].value === 11 ? 'A' : cards[0].value === 10 ? 'T' : cards[0].rank;
      return `Pair ${r},${r} ${vs}`;
    }
    if (soft) {
      return `Soft ${total} (A,${total - 11}) ${vs}`;
    }
    return `Hard ${total} ${vs}`;
  }

  BJ.strategy = Object.freeze({
    ACTIONS,
    ACTION_LABELS,
    CODE_MEANINGS,
    DEFAULT_RULES,
    getCorrectAction,
    describeSituation,
  });
})((window.BJ = window.BJ || {}));
