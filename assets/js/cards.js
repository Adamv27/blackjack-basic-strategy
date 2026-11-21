/**
 * Card creation, random dealing and hand totals.
 *
 * Dealing uses an "infinite deck" (each card drawn independently), which is
 * ideal for drills: every situation stays equally likely hand after hand.
 */
(function (BJ) {
  'use strict';

  const RANKS = Object.freeze(['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']);

  const SUITS = Object.freeze([
    Object.freeze({ name: 'spades', symbol: '♠', color: 'black' }),
    Object.freeze({ name: 'hearts', symbol: '♥', color: 'red' }),
    Object.freeze({ name: 'diamonds', symbol: '♦', color: 'red' }),
    Object.freeze({ name: 'clubs', symbol: '♣', color: 'black' }),
  ]);

  const TEN_RANKS = Object.freeze(['10', 'J', 'Q', 'K']);

  function rankValue(rank) {
    if (rank === 'A') return 11;
    if (TEN_RANKS.includes(rank)) return 10;
    return Number(rank);
  }

  function randomInt(max) {
    if (window.crypto && window.crypto.getRandomValues) {
      const buf = new Uint32Array(1);
      window.crypto.getRandomValues(buf);
      return buf[0] % max;
    }
    return Math.floor(Math.random() * max);
  }

  const pick = (list) => list[randomInt(list.length)];

  function makeCard(rank, suit = pick(SUITS)) {
    return Object.freeze({ rank, suit, value: rankValue(rank) });
  }

  const randomCard = () => makeCard(pick(RANKS));

  /** A random rank whose value matches (picks among 10/J/Q/K for 10). */
  function rankForValue(value) {
    if (value === 11) return 'A';
    if (value === 10) return pick(TEN_RANKS);
    return String(value);
  }

  /** Best blackjack total for a hand; soft = an ace is still counted as 11. */
  function handTotal(cards) {
    let total = 0;
    let aces = 0;
    for (const card of cards) {
      total += card.value;
      if (card.value === 11) aces += 1;
    }
    while (total > 21 && aces > 0) {
      total -= 10;
      aces -= 1;
    }
    return { total, soft: aces > 0 };
  }

  /** Two cards of equal value form a splittable pair (10, J, Q, K all count as tens). */
  const isPair = (cards) => cards.length === 2 && cards[0].value === cards[1].value;

  const isBlackjack = (cards) => cards.length === 2 && handTotal(cards).total === 21;

  /**
   * Deal a player hand matching the requested focus.
   * @param {'all'|'hard'|'soft'|'pairs'} focus
   */
  function dealPlayerHand(focus = 'all') {
    switch (focus) {
      case 'pairs': {
        const value = 2 + randomInt(10); // 2..11
        return [makeCard(rankForValue(value)), makeCard(rankForValue(value))];
      }
      case 'soft': {
        const other = makeCard(String(2 + randomInt(8))); // A,2 .. A,9
        return shuffleTwo([makeCard('A'), other]);
      }
      case 'hard': {
        let hand;
        do {
          hand = [randomCard(), randomCard()];
        } while (handTotal(hand).soft || isPair(hand));
        return hand;
      }
      default: {
        let hand;
        do {
          hand = [randomCard(), randomCard()];
        } while (isBlackjack(hand)); // nothing to decide on a natural
        return hand;
      }
    }
  }

  const shuffleTwo = (pair) => (randomInt(2) ? pair : [pair[1], pair[0]]);

  /**
   * Deal the dealer's upcard and hole card. The dealer has already "peeked",
   * so a dealer blackjack is never dealt — that's the situation basic strategy
   * assumes once you get to act.
   */
  function dealDealerHand() {
    const up = randomCard();
    let hole;
    do {
      hole = randomCard();
    } while (isBlackjack([up, hole]));
    return [up, hole];
  }

  /** Dealer draws to 17 and hits soft 17 (the rule this chart is built for). */
  function dealerShouldHit(cards) {
    const { total, soft } = handTotal(cards);
    return total < 17 || (total === 17 && soft);
  }

  BJ.cards = Object.freeze({
    RANKS,
    SUITS,
    makeCard,
    randomCard,
    handTotal,
    isPair,
    isBlackjack,
    dealPlayerHand,
    dealDealerHand,
    dealerShouldHit,
  });
})((window.BJ = window.BJ || {}));
