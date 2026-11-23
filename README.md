# rankings-hub

Daily discovery data: under-the-radar apps that are **new and rising**, plus GitHub repositories ranked over several time windows. Built to be consumed by a mobile app or static site — this repo produces data only, it does not serve traffic.

Every day GitHub Actions collects the raw signals, scores them, and commits small JSON shards plus a manifest.

## What it produces

```
data/
├─ manifest.json                     # version + every shard: path / bytes / brBytes / sha256 / count
├─ manifest.json.br
├─ rising/apple/{cc}.json            # risingNow / justLaunched / hiddenGems (30 each)
├─ rising/google/{cc}.json           # same shape, fewer fields
├─ charts/apple/{cc}.json            # top free + new entries (30 each)
├─ charts/google/{cc}.json           # top free (30)
├─ mac/{cc}.json                     # Mac App Store free / paid (30 each)
├─ podcasts/{cc}.json                # top podcasts (30)
├─ github/{daily,weekly,monthly,quarterly,yearly}.json   # 30 each
├─ github/tracked.json               # repos from the tracked pool with real star velocity
├─ global/risers.json                # apps rising in 3+ regions at once
├─ alternatives.json                 # curated paid -> open source mapping
└─ health.json                       # per source success / failure / timing
```

Each JSON file has a precompressed `.br` sibling so a static server can send it without recompressing.

## Sources

| Source | Endpoint | Notes |
|---|---|---|
| iOS App Store charts | `itunes.apple.com/{cc}/rss/topfreeapplications`, `newfreeapplications` | official RSS, ~100 new apps per region |
| iOS app details | `itunes.apple.com/lookup?id=…&country={cc}` | batches of 140 ids, gives `releaseDate`, `userRatingCount` |
| Google Play charts | `google-play-scraper` → `TOP_FREE` | unofficial; no `NEW_FREE` collection exists |
| Mac App Store | `topfreemacapps`, `toppaidmacapps` | same RSS pipeline |
| Apple Podcasts | `toppodcasts` | same RSS pipeline |
| GitHub repositories | `api.github.com/search/repositories` | no trending API; windows are `created:>date` |

ossinsight's trending endpoint is **unavailable since 2026-03-01**, so star velocity is computed from our own daily snapshots instead.

## Scoring

```
rank_delta   = yesterday_rank - today_rank
is_new       = absent yesterday, present today        (suppressed on the first run per region)
rating_delta = rating_count_today - snapshot_yesterday
age_days     = today - release_date

riser = 0.45·norm(rank_delta) + 0.25·is_new + 0.20·norm(rating_delta) + 0.10·norm(1/max(age,1))
```

Filters (see `tools/lib/regions.mjs`):

- rating count `< 5,000` → counts as small / indie
- `age_days <= 90` → eligible for `justLaunched`; `<= 180` for general rising lists
- seller and category blocklists (big publishers, gambling, dating, VPN)
- one seller publishing 3+ brand-new apps in one day → 50% score penalty

GitHub uses a separate quality filter: keyword blocklist, `forks == 0` with `stars >= 100`, `NOASSERTION` license, 15+ topics, missing description. The recent-creation feed is roughly 90% star-farm spam, so this filter removes a lot of rows.

## Run

```bash
npm install                       # only for google-play-scraper
export GITHUB_TOKEN=$(gh auth token)

node tools/collect.mjs            # fetch raw signals
node tools/build.mjs              # score, shard, compress, manifest
node tools/validate.mjs           # integrity checks
```

Useful env vars:

| Var | Default | Meaning |
|---|---|---|
| `PLATFORMS` | `apple,mac,podcasts,github` | comma list, add `google` to include Play |
| `ENABLE_GOOGLE_PLAY` | unset | must be `true` for the Google collector |
| `REGIONS_LIMIT` | `0` (all) | cap regions, good for smoke tests |
| `CONCURRENCY` | `8` | parallel iTunes requests |
| `GOOGLE_CONCURRENCY` | `4` | parallel Play requests |
| `GOOGLE_DETAILS_LIMIT` | `0` | extra detail calls for new Play apps (installs, release date) |

Quick smoke test:

```bash
PLATFORMS=apple,github REGIONS_LIMIT=3 node tools/collect.mjs && \
node tools/build.mjs && REGIONS_LIMIT=3 node tools/validate.mjs
```

## Current scope and cadence

- **iOS**: 167 storefronts total, but each run covers the 40 major markets plus a rotating third of the rest (82 regions per run, every region refreshed within 3 days). The top-20 markets also pull 10 genre charts (Utilities, Productivity, Health, Finance, Education, Photo, Music, Lifestyle, Shopping) so long-tail apps get into the candidate pool.
- **Google Play**: 39 markets, `TOP_FREE` only (no `NEW_FREE` collection exists). Detail calls are capped at 3 long-tail apps per market per run; failures are recorded in `health.json`.
- **Mac App Store / Podcasts**: 40 markets each.
- **GitHub**: 5 windows, refreshed on every run.
- **Rate control**: Apple requests are globally throttled (`APPLE_RPS`, default 3/s) with a circuit breaker after 8 consecutive 403s. A burst above ~10/s gets the runner's IP blocked for a while.
- **First-run behaviour**: `is_new` is suppressed until a previous day's snapshot exists, so Android risers only appear after the second daily run.

## Quotas and runtime limits

| Item | Limit | This project |
|---|---|---|
| Actions minutes | unlimited on public repos (2,000/mo private) | 1 job/day, target under 4 minutes |
| Job timeout | 6 hours | `timeout-minutes: 8` |
| GitHub Search API | 30 requests/minute (authenticated) | serialised with a 2.1s gap |
| Repo size | 100MB per file, 5GB recommended | shards under 1MB, target repo size under 100MB |
| Scheduled workflow | disabled after 60 days without repo activity | daily bot commit keeps it alive |

## Validation guards

- any GitHub window returning nothing → run fails, nothing is committed
- a single region failing keeps that region's previous file and records it in `health.json`
- Brotli total above 2.5MB → fail
- every shard's SHA-256 is checked against the manifest before commit

## Known limitations

- **No download numbers.** Neither store publishes them. `rank_delta` and `rating_delta` are proxies; ranking velocity leads ratings by days.
- **Google Play has no `NEW_FREE` collection.** New Android entrants are detected by absence from yesterday's rank snapshot; release dates need `GOOGLE_DETAILS_LIMIT > 0`.
- **GitHub's daily window is noisy.** Windows are "repositories created within the window sorted by stars", not "stars gained in the window" — the latter needs an event stream we do not have.
- **Regional charts overlap heavily.** Small storefronts mostly mirror the US chart; dedupe happens in `global/risers.json`.

## Content licensing

`content/alternatives.yml` is hand-written editorial content (MIT, same as the code). App and repository metadata comes from Apple's public RSS, Google Play, and the GitHub API; only structured fields, short snippets, and links are stored.