# Gearbox Revenue Calculator

Calculate weighted average TVL and potential revenue for Gearbox DAO using on-chain data.

## 🚀 Quick Start

### Requirements

- Node.js 18+ (tested on Node 20)
- An Ethereum RPC endpoint with log access for the target network

### Basic Mode
```bash
node index.js <rpcUrl> <poolAddress> <fromDate> <toDate> <interestFee> --dao-share-bps <bps>
```

### Revenue Share Mode
```bash
node index.js <rpcUrl> <poolAddress> <fromDate> <toDate> <interestFee> --dao-share-bps <bps> \
  --revenue-share --addresses 0xABC...,0xDEF... --rev-coeff 0.2
```

## 📋 Parameters

- **rpcUrl** - Ethereum RPC endpoint URL
- **poolAddress** - Gearbox pool contract address (0x...)
- **fromDate** - Start date (YYYY-MM-DD)
- **toDate** - End date (YYYY-MM-DD)
- **interestFee** - Interest fee in basis points (0-10000)

Optional flags:

- `--deploy-date YYYY-MM-DD` – limit historical replay to the period after pool deployment (reduces log scanning)
- `--treasury 0x...` – override treasury address (defaults to the pool’s `treasury()` value)
- `--dao-share-bps <0-10000>` – DAO share in basis points (required)
- `--revenue-share` – enable revenue share mode
  - `--addresses 0xABC,0xDEF` – comma-separated LP token holder addresses
  - `--rev-coeff <0-1>` – revenue share coefficient applied to pool revenue
- `--debug-share-price` – print every share price delta and its revenue impact (useful for auditing)

## 💡 Examples

```bash
# Basic calculation
node index.js https://... 0xff94993fa7ea27efc943645f95adb36c1b81244b 2025-09-01 2025-09-30 2000 --dao-share-bps 5000

# With revenue share
node index.js https://... 0xff94993fa7ea27efc943645f95adb36c1b81244b 2025-09-01 2025-09-30 2000 --dao-share-bps 5000 \
  --revenue-share --addresses 0xABC,0xDEF --rev-coeff 0.2

# Override treasury + DAO share and print share-price deltas
node index.js https://... 0xff94993fa7ea27efc943645f95adb36c1b81244b 2025-09-01 2025-09-30 2000 --treasury 0x5c3B8b1685B5B022eE641952Ead7820Ec200c138 --dao-share-bps 5000 --debug-share-price
```

## 📊 Output

- Average TVL in tokens
- Total revenue delivered to the DAO (sum of unrealized + realized)
- Realized revenue (treasury share mints valued at end-of-period share price)
- Unrealized revenue (residual DAO revenue after subtracting realized portion)
- Revenue share for selected LP addresses (if enabled)
- Anchored block range actually used (closest events to the requested window)
- Data coverage ratio, token metadata, and raw bigint values for auditing

The script will expand the requested window to the nearest deposit/withdraw events. If it cannot anchor exactly at the supplied start/end blocks, it prints a warning and reports the effective blocks used.

> ⚠️ **Tip:** for historical ranges far in the past, use an archive-capable RPC or tighten `--deploy-date` to avoid providers refusing large `getLogs` calls.

## 📦 Install

```bash
npm install
```

## 🧪 Helpful Debug Commands

- `--debug-share-price` – traces each share-price jump with the pool supply and revenue impact.
- Inspect `Total Revenue Raw` vs. `Realized/Unrealized Revenue (DAO)` in the output to understand how the DAO’s cut compares against gross pool revenue.

## 🧠 Methodology (Pseudo-code Summary)

```text
inputs:
  rpc_url, pool_address, from_date, to_date, interest_fee_bps, treasury_address, dao_share_bps
  optional: revenue_share_addresses, revenue_share_coeff, deploy_date

resolve blocks:
  from_block = block_at(from_date 00:01)
  to_block   = block_at(to_date   23:59)

collect events:
  {events, transfers} = getPoolEvents(pool_address, deploy_block..to_block, include_transfers=true)

replay deposit/withdraw events:
  snapshots = derivePoolSnapshotsFromEvents(events)
  anchors   = closest snapshots covering [from_block, to_block]

share-price revenue:
  for each adjacent snapshot pair:
    share_price_diff = next.share_price - current.share_price
    interval_revenue = current.total_supply * share_price_diff / SCALE
    total_pool_revenue += interval_revenue
    weighted_tvl      += current.expected_liquidity * time_delta

DAO revenue split:
  pool_fee  = total_pool_revenue * interest_fee_bps / 10_000
  dao_total = pool_fee * dao_share_bps / 10_000

realized revenue:
  treasury_deposit_txs = {tx | Deposit.owner == treasury and deposit assets > 0}
  for each transfer in transfers:
    if from == zero and to == treasury and tx not in treasury_deposit_txs:
      realized_shares += transfer.value
  realized_dao  = realized_shares * final_share_price / SCALE
  unrealized_dao = max(dao_total - realized_dao, 0)

revenue share (optional):
  if revenue_share_addresses supplied:
    compute time-weighted TVL for addresses from cached transfers
  revenue_share_raw = dao_total * revenue_share_coeff

outputs:
  average_tvl = weighted_tvl / total_time
  total_dao_revenue = dao_total
  realized_dao_revenue = realized_dao
  unrealized_dao_revenue = unrealized_dao
  revenue_share = revenue_share_raw (if enabled)
```
