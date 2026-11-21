/**
 * UI controller: deals hands, handles input, grades every decision, plays the
 * dealer's turn and tracks stats.
 *
 * Hand phases:
 *   dealing -> player (one or more graded decisions) -> dealer -> done
 */
(function (BJ) {
  'use strict';

  const { cards: Cards, strategy: Strategy } = BJ;
  const STORAGE_KEYS = Object.freeze({ stats: 'bst.stats', settings: 'bst.settings' });
  const LABEL = Strategy.ACTION_LABELS;

  // Animation timing (ms). Keep DEAL/FLIP in sync with --deal-ms / --flip-ms in styles.css.
  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TIMING = Object.freeze({
    DEAL: 300,
    DEAL_STAGGER: 140,
    FLIP: 500,
    DEALER_DRAW_GAP: 550,
  });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, REDUCED_MOTION ? 0 : ms));

  const KEY_TO_ACTION = Object.freeze({
    h: 'hit',
    s: 'stand',
    d: 'double',
    p: 'split',
    r: 'surrender',
  });

  // --------------------------------------------------------------------------
  // Persistence (localStorage may be unavailable, e.g. private mode)
  // --------------------------------------------------------------------------
  const storage = {
    load(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key);
        return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
      } catch {
        return { ...fallback };
      }
    },
    save(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* ignore */
      }
    },
  };

  const DEFAULT_STATS = Object.freeze({ correct: 0, total: 0, streak: 0, best: 0 });
  const DEFAULT_SETTINGS = Object.freeze({
    focus: 'all',
    showTotals: false, // off by default so you practise adding the cards up yourself
    ...Strategy.DEFAULT_RULES,
  });

  const state = {
    handId: 0, // bumps on every deal so stale async dealer turns can bail out
    phase: 'dealing',
    player: [],
    dealer: [], // [upcard, hole card, ...draws]
    dealerRevealed: false,
    outcome: { text: '', result: '' },
    decisions: [], // { situation, chosen, result, correct }
    stats: storage.load(STORAGE_KEYS.stats, DEFAULT_STATS),
    settings: storage.load(STORAGE_KEYS.settings, DEFAULT_SETTINGS),
  };

  const dealerUp = () => state.dealer[0];

  // --------------------------------------------------------------------------
  // DOM references
  // --------------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const el = {
    dock: $('dock'),
    dealerCards: $('dealer-cards'),
    dealerTotal: $('dealer-total'),
    playerCards: $('player-cards'),
    playerTotal: $('player-total'),
    actionButtons: document.querySelectorAll('[data-action]'),
    feedback: $('feedback'),
    verdict: $('feedback-verdict'),
    situation: $('feedback-situation'),
    detail: $('feedback-detail'),
    log: $('decision-log'),
    outcome: $('hand-outcome'),
    nextBtn: $('next-hand'),
    settingsForm: $('settings-form'),
    resetStats: $('reset-stats'),
    stats: {
      accuracy: $('stat-accuracy'),
      hands: $('stat-hands'),
      streak: $('stat-streak'),
      best: $('stat-best'),
    },
  };

  // --------------------------------------------------------------------------
  // Card rendering
  // --------------------------------------------------------------------------
  const cardLabel = (card) => `${card.rank} of ${card.suit.name}`;

  /**
   * Build a card element. Every card has both faces so it can be flipped.
   * @param {object} card
   * @param {{ faceDown?: boolean, delay?: number }} [opts]
   */
  function renderCard(card, { faceDown = false, delay = 0 } = {}) {
    const node = document.createElement('div');
    node.className = 'card';
    if (card.suit.color === 'red') node.classList.add('card--red');
    if (faceDown) node.classList.add('is-facedown');
    node.style.setProperty('--delay', `${delay}ms`);
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', faceDown ? 'Face-down card' : cardLabel(card));

    const corner = (extra = '') =>
      `<span class="card__corner${extra}"><span>${card.rank}</span><span>${card.suit.symbol}</span></span>`;

    node.innerHTML = `
      <div class="card__inner" aria-hidden="true">
        <div class="card__face card__face--front">
          ${corner()}
          <span class="card__pip">${card.suit.symbol}</span>
          ${corner(' card__corner--bottom')}
        </div>
        <div class="card__face card__face--back"></div>
      </div>`;
    return node;
  }

  function flipCard(node, card) {
    node.classList.remove('is-facedown');
    node.setAttribute('aria-label', cardLabel(card));
  }

  /** Deal a single card onto a hand with the slide-in animation. */
  async function dealCardTo(container, card) {
    container.append(renderCard(card));
    await sleep(TIMING.DEAL);
  }

  // --------------------------------------------------------------------------
  // Other rendering
  // --------------------------------------------------------------------------
  function formatTotal(cards) {
    const { total, soft } = Cards.handTotal(cards);
    return soft && total < 21 ? `${total - 10} / ${total}` : String(total);
  }

  function renderPlayerTotal() {
    el.playerTotal.hidden = !state.settings.showTotals || state.phase === 'dealing';
    if (el.playerTotal.hidden) return;
    el.playerTotal.textContent = formatTotal(state.player);
    el.playerTotal.classList.toggle('is-bust', Cards.handTotal(state.player).total > 21);
  }

  function renderDealerTotal() {
    el.dealerTotal.hidden = !state.settings.showTotals || !state.dealerRevealed;
    if (el.dealerTotal.hidden) return;
    const { total, soft } = Cards.handTotal(state.dealer);
    // Show the final number once the dealer is done drawing.
    el.dealerTotal.textContent = state.phase === 'done' || !soft ? String(total) : formatTotal(state.dealer);
    el.dealerTotal.classList.toggle('is-bust', total > 21);
  }

  function renderStats() {
    const { correct, total, streak, best } = state.stats;
    el.stats.accuracy.textContent = total ? `${Math.round((correct / total) * 100)}%` : '—';
    el.stats.hands.textContent = String(total);
    el.stats.streak.textContent = String(streak);
    el.stats.best.textContent = String(best);
  }

  function updateButtons() {
    const acting = state.phase === 'player';
    const opening = state.player.length === 2;
    const canSplit = opening && Cards.isPair(state.player);
    const last = state.decisions[state.decisions.length - 1];
    const showMarks = state.phase === 'done' && last;

    el.actionButtons.forEach((btn) => {
      const action = btn.dataset.action;
      let enabled = acting;
      if (action === 'double') enabled = enabled && opening;
      if (action === 'split') enabled = enabled && canSplit;
      if (action === 'surrender') enabled = enabled && opening && state.settings.surrender;
      btn.disabled = !enabled;

      // Mark right/wrong only once the hand is over, so mid-hand highlights
      // don't read as hints for the next decision.
      btn.classList.toggle('is-correct', Boolean(showMarks && action === last.result.action));
      btn.classList.toggle('is-wrong', Boolean(showMarks && !last.correct && action === last.chosen));
    });
  }

  function renderFeedback() {
    const last = state.decisions[state.decisions.length - 1];
    if (!last) {
      el.feedback.hidden = true;
      return;
    }

    el.feedback.classList.toggle('is-correct', last.correct);
    el.feedback.classList.toggle('is-wrong', !last.correct);
    el.verdict.textContent = last.correct
      ? `Correct — ${LABEL[last.chosen]} follows basic strategy.`
      : `Not quite — basic strategy says ${LABEL[last.result.action]}.`;
    el.situation.textContent = last.situation;

    const chartLine = `Chart: ${last.result.code} (${Strategy.CODE_MEANINGS[last.result.code]}).`;
    el.detail.textContent = [chartLine, ...last.result.notes].join(' ');

    renderLog();

    const handFinished = state.phase === 'dealer' || state.phase === 'done';
    el.outcome.hidden = !handFinished;
    el.outcome.textContent = state.outcome.text;
    el.outcome.dataset.result = state.outcome.result;
    el.nextBtn.hidden = state.phase !== 'done';

    el.feedback.hidden = false;
  }

  /** Lists every decision this hand once there's more than one. */
  function renderLog() {
    const items = state.decisions.length > 1 ? state.decisions : [];
    el.log.hidden = items.length === 0;
    el.log.replaceChildren(
      ...items.map((d) => {
        const li = document.createElement('li');
        li.className = d.correct ? 'is-correct' : 'is-wrong';
        const fix = d.correct ? '' : ` (should ${LABEL[d.result.action].toLowerCase()})`;
        li.textContent = `${d.situation}: ${LABEL[d.chosen]}${fix}`;
        return li;
      }),
    );
  }

  function renderAll() {
    renderStats();
    renderFeedback();
    updateButtons();
    el.dock.classList.toggle('is-done', state.phase === 'done');
  }

  /**
   * On phones the dock is fixed to the bottom of the screen; mirror its height
   * into --dock-h so the page can pad itself and nothing hides behind it.
   */
  function watchDockHeight() {
    if (!('ResizeObserver' in window)) return;
    const root = document.documentElement;
    new ResizeObserver(() => {
      const fixed = getComputedStyle(el.dock).position === 'fixed';
      root.style.setProperty('--dock-h', fixed ? `${el.dock.offsetHeight}px` : '0px');
    }).observe(el.dock);
  }

  // --------------------------------------------------------------------------
  // Game flow
  // --------------------------------------------------------------------------
  const isCurrent = (id) => id === state.handId;

  /** Deal player, dealer up, player, dealer hole — like a real table. */
  async function dealHand() {
    const id = ++state.handId;
    state.phase = 'dealing';
    state.player = Cards.dealPlayerHand(state.settings.focus);
    state.dealer = Cards.dealDealerHand();
    state.dealerRevealed = false;
    state.outcome = { text: '', result: '' };
    state.decisions = [];

    const order = [
      [el.playerCards, state.player[0], false],
      [el.dealerCards, state.dealer[0], false],
      [el.playerCards, state.player[1], false],
      [el.dealerCards, state.dealer[1], true],
    ];
    el.playerCards.replaceChildren();
    el.dealerCards.replaceChildren();
    order.forEach(([container, card, faceDown], i) => {
      container.append(renderCard(card, { faceDown, delay: i * TIMING.DEAL_STAGGER }));
    });

    renderPlayerTotal();
    renderDealerTotal();
    renderAll();

    await sleep(TIMING.DEAL_STAGGER * (order.length - 1) + TIMING.DEAL);
    if (!isCurrent(id)) return;

    state.phase = 'player';
    renderPlayerTotal();
    updateButtons();
  }

  function recordDecision(chosen) {
    const result = Strategy.getCorrectAction(state.player, dealerUp().value, {
      doubleAfterSplit: state.settings.doubleAfterSplit,
      surrender: state.settings.surrender,
    });
    const correct = chosen === result.action;

    state.decisions.push({
      situation: Strategy.describeSituation(state.player, dealerUp().value),
      chosen,
      result,
      correct,
    });

    const stats = state.stats;
    stats.total += 1;
    if (correct) {
      stats.correct += 1;
      stats.streak += 1;
      stats.best = Math.max(stats.best, stats.streak);
    } else {
      stats.streak = 0;
    }
    storage.save(STORAGE_KEYS.stats, stats);
  }

  async function answer(action) {
    if (state.phase !== 'player') return;
    const btn = document.querySelector(`[data-action="${action}"]`);
    if (!btn || btn.disabled) return;

    const id = state.handId;
    recordDecision(action);

    // Lock input while any card is in flight.
    state.phase = 'busy';
    renderAll();

    if (action === 'hit' || action === 'double') {
      const card = Cards.randomCard();
      state.player.push(card);
      await dealCardTo(el.playerCards, card);
      if (!isCurrent(id)) return;
      renderPlayerTotal();
    }

    const { total } = Cards.handTotal(state.player);
    if (action === 'hit' && total < 21) {
      state.phase = 'player';
      renderAll();
      return;
    }

    await playDealer(id, action, total);
  }

  /** Reveal the hole card, let the dealer draw if needed, then settle the hand. */
  async function playDealer(id, lastAction, playerTotal) {
    state.phase = 'dealer';
    const playerBust = playerTotal > 21;
    const dealerMustPlay = !playerBust && (lastAction === 'hit' || lastAction === 'stand' || lastAction === 'double');
    state.outcome = { text: dealerMustPlay ? 'Dealer’s turn…' : '', result: 'pending' };
    renderAll();

    // Flip the hole card.
    const holeNode = el.dealerCards.children[1];
    flipCard(holeNode, state.dealer[1]);
    await sleep(TIMING.FLIP);
    if (!isCurrent(id)) return;
    state.dealerRevealed = true;
    renderDealerTotal();

    if (dealerMustPlay) {
      while (Cards.dealerShouldHit(state.dealer)) {
        await sleep(TIMING.DEALER_DRAW_GAP);
        if (!isCurrent(id)) return;
        const card = Cards.randomCard();
        state.dealer.push(card);
        await dealCardTo(el.dealerCards, card);
        if (!isCurrent(id)) return;
        renderDealerTotal();
      }
    }

    state.phase = 'done';
    state.outcome = settle(lastAction, playerTotal);
    renderDealerTotal();
    renderAll();
    el.nextBtn.focus({ preventScroll: true });
  }

  /** Work out the result of the hand for display. */
  function settle(lastAction, playerTotal) {
    const dealerTotal = Cards.handTotal(state.dealer).total;
    const doubled = lastAction === 'double';
    const stake = doubled ? ' (doubled)' : '';
    const right = state.decisions.filter((d) => d.correct).length;
    const summary =
      state.decisions.length > 1 ? ` ${right} of ${state.decisions.length} decisions correct.` : '';

    let text;
    let result;
    if (lastAction === 'split') {
      text = 'Split — split hands aren’t played out in this trainer.';
      result = 'push';
    } else if (lastAction === 'surrender') {
      text = 'Surrendered — you get half your bet back.';
      result = 'lose';
    } else if (playerTotal > 21) {
      text = `Bust with ${playerTotal} — dealer wins${stake}.`;
      result = 'lose';
    } else if (dealerTotal > 21) {
      text = `Dealer busts with ${dealerTotal} — you win${stake}!`;
      result = 'win';
    } else if (playerTotal > dealerTotal) {
      text = `${playerTotal} beats ${dealerTotal} — you win${stake}!`;
      result = 'win';
    } else if (playerTotal < dealerTotal) {
      text = `Dealer’s ${dealerTotal} beats your ${playerTotal}${stake}.`;
      result = 'lose';
    } else {
      text = `Push — both have ${playerTotal}.`;
      result = 'push';
    }
    return { text: text + summary, result };
  }

  // --------------------------------------------------------------------------
  // Settings
  // --------------------------------------------------------------------------
  function syncSettingsForm() {
    const form = el.settingsForm.elements;
    form.focus.value = state.settings.focus;
    form.showTotals.checked = state.settings.showTotals;
    form.doubleAfterSplit.checked = state.settings.doubleAfterSplit;
    form.surrender.checked = state.settings.surrender;
  }

  function onSettingsChange() {
    const form = el.settingsForm.elements;
    const focusChanged = form.focus.value !== state.settings.focus;
    state.settings = {
      focus: form.focus.value,
      showTotals: form.showTotals.checked,
      doubleAfterSplit: form.doubleAfterSplit.checked,
      surrender: form.surrender.checked,
    };
    storage.save(STORAGE_KEYS.settings, state.settings);

    // Only a new practice focus needs a new hand; other settings apply in place.
    if (focusChanged) {
      dealHand();
      return;
    }
    renderPlayerTotal();
    renderDealerTotal();
    updateButtons();
  }

  function resetStats() {
    state.stats = { ...DEFAULT_STATS };
    storage.save(STORAGE_KEYS.stats, state.stats);
    renderStats();
  }

  // --------------------------------------------------------------------------
  // Events
  // --------------------------------------------------------------------------
  function onKeyDown(event) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    if (event.target.closest('select, input, textarea')) return;

    if (event.key === 'Enter' || event.key === ' ') {
      // A focused button already activates on Enter/Space natively.
      if (state.phase === 'done' && !event.target.closest('button')) {
        event.preventDefault();
        dealHand();
      }
      return;
    }

    const action = KEY_TO_ACTION[event.key.toLowerCase()];
    if (action) {
      event.preventDefault();
      answer(action);
    }
  }

  function init() {
    el.actionButtons.forEach((btn) => {
      btn.addEventListener('click', () => answer(btn.dataset.action));
    });
    el.nextBtn.addEventListener('click', dealHand);
    el.settingsForm.addEventListener('change', onSettingsChange);
    el.resetStats.addEventListener('click', resetStats);
    document.addEventListener('keydown', onKeyDown);

    syncSettingsForm();
    watchDockHeight();
    renderStats();
    dealHand();
  }

  init();
})(window.BJ);
