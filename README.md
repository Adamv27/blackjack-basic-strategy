# Basic Strategy Trainer

A small static site for drilling blackjack basic strategy. You get dealt a hand against a dealer upcard,
pick a play, and it tells you whether that play matches the chart.

## Run

Open `index.html` in a browser, or serve the folder:

```sh
python -m http.server 8080
```

## Controls

| Key   | Action     |
| ----- | ---------- |
| H     | Hit        |
| S     | Stand      |
| D     | Double     |
| P     | Split      |
| R     | Surrender  |
| Enter | Next hand  |

Hands are played out: after a Hit you get another card and decide again, so you practise multi-card
soft and hard totals (double, split and surrender are only available on the first two cards). Every
decision is graded, and the hand ends on Stand, Double, Split, Surrender, a bust or 21.

The dealer's turn is then played out: the hole card flips over and the dealer draws, hitting soft 17
(the rule this chart is built for), and the hand is settled as a win, loss or push. The dealer has
already checked for blackjack, so you never face a dealer natural.

Settings let you focus on hard totals, soft totals or pairs, and toggle double after split (DAS) and
late surrender. Stats and settings are saved in the browser.

## Structure

```
index.html              Markup only
assets/css/styles.css   Styles (light and dark themes)
assets/js/cards.js      Cards, dealing, hand totals
assets/js/strategy.js   Basic strategy chart data and lookup
assets/js/app.js        UI controller: rendering, input, grading, stats
```

Scripts are plain (non-module) files loaded with `defer` and share a single `window.BJ` namespace,
so the page works when opened directly from disk.
