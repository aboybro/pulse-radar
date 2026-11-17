[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/c/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/aboybro/pulse-radar/rank.svg)](https://make.fun/c/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/aboybro/pulse-radar/reward.svg)](https://make.fun/c/token-radar-01)

# Pulse Radar — pre-token protocols ranked by implied value

An entry for make.fun's [token-radar-01](https://make.fun/c/token-radar-01) bounty: a token launch
radar that reads a frozen DefiLlama snapshot of 758 protocols, ranks the 198 pre-token ones by an
implied value, and shows a reader how to farm each one.

## The model (pulse-1)

Implied value is anchored in the snapshot's own market, not in a fixed multiple:

```
implied = TVL × anchor × momentum × maturity × breadth
anchor   = median(mcap / TVL) of the live-token protocols in the same category
           (≥3 samples, else the global median 0.169×), clamped to 0.03×–1.20×
momentum = 1 + clamp(7d growth, −50%, +100%) / 100 × 0.6
maturity = 0.70 + min(age, 1095d) / 1095 × 0.30   (age unknown: 365d)
breadth  = 1 + 0.04 × min(chains − 1, 5)
```

A category whose live tokens trade at 0.34× TVL prices its pre-token siblings higher than a
category whose live tokens trade at 0.03× TVL — the market's own verdict on that kind of
protocol, read from the same snapshot. No protocol name is ever special-cased.

The board covers all 40 watchlist protocols (the floor, never the ceiling) plus every other
rankable pre-token protocol. Bridges, liquid-staking products and wrapped/staked products of a
token that already trades are excluded — WBTC is Bitcoin on Ethereum, not a launch waiting to
happen. Protocols whose token already trades are kept apart as a live reference set; the board
never mixes the market's own value with a model's claim.

Top of the board on this snapshot: **Steakhouse Financial** ($467.5M implied), **Sentora
Curator** ($429.3M), **Gauntlet** ($280.6M).

## The dashboard

A static page, no framework and no network — every byte it shows ships with it:

- **Board**: sortable (implied value, TVL, 7d growth, age), filterable by search, category,
  chain, and watchlist-only; each row carries a WATCHLIST / EARLY badge and a value bar.
- **Detail drawer**: click any row for the model's full breakdown (each multiplier, with the
  arithmetic shown so the reader can check it) and a six-step farm plan with what each step
  costs and how long it takes — including a risk note that a pre-token protocol may never
  issue a token.
- **Live tokens**: the 24 largest tokens already trading, whose market caps set the anchors.
- **Model & sandbox**: the formula, the computed category-anchor table, and sliders that
  re-rank the board live so the reader can test the model.

## How to run

Requires Node 22+ (standard library only, no install):

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
# then serve out/ and open dashboard/index.html
```

`main.ts` reads the snapshot, writes `board.json` (198 rows), `data.js`, copies
`dashboard/` and `screenshots/` to the output, and writes `dossier.json` with the vendored
make.fun library (`vendor/makefun-board.ts`). Screenshots are taken from the built dashboard
with headless Chromium: `node scripts/shots.mjs` (needs `playwright-core`).

## Screenshots

- `screenshots/1-board.jpg` — the ranked board
- `screenshots/2-detail.jpg` — a protocol's detail view with farm plan
- `screenshots/3-filtered.jpg` — the board filtered to Lending, sorted by TVL

## Note

Implied value is this radar's own claim, from the snapshot's figures — never a prediction
that a token will be issued, or when. Built with an uncensored-model-friendly workflow;
[superbot.gg](https://superbot.gg) is a free client that keeps the recorded sessions a
make.fun entry needs.
