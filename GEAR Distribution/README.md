# Gearbox Revenue Calculator

Calculate weighted average TVL and potential revenue for Gearbox DAO using on-chain data.

## 🚀 Quick Start

### Requirements

- Node.js 18+ (tested on Node 20)
- An Ethereum RPC endpoint with log access for the target network

### Basic Mode
```bash
node index.js <rpcUrl> <poolAddress> <fromDate> <toDate> <interestFee>
```

### Revenue Share Mode
```bash
node index.js <rpcUrl> <poolAddress> <fromDate> <toDate> <interestFee> \
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
- `--treasury 0x...` – override the address returned by the pool’s `treasury()` call
- `--dao-share-bps <0-10000>` – override DAO share in basis points 
- `--revenue-share` – enable revenue share mode
  - `--addresses 0xABC,0xDEF` – comma-separated LP token holder addresses
  - `--rev-coeff <0-1>` – revenue share coefficient applied to pool revenue
- `--debug-share-price` – print every share price delta and its revenue impact (useful for auditing)

## 💡 Examples

```bash
# Basic calculation
node index.js https://... 0xff94993fa7ea27efc943645f95adb36c1b81244b 2025-09-01 2025-09-30 2000

# With revenue share
node index.js https://... 0xff94993fa7ea27efc943645f95adb36c1b81244b 2025-09-01 2025-09-30 2000 \
  --revenue-share --addresses 0xABC,0xDEF --rev-coeff 0.2

# Override treasury + DAO share and print share-price deltas
node index.js https://... 0xff94993fa7ea27efc943645f95adb36c1b81244b 2025-09-01 2025-09-30 2000 \
  --treasury 0x5c3B8b1685B5B022eE641952Ead7820Ec200c138 --dao-share-bps 5000 --debug-share-price
```

## 📊 Output

- Average TVL in tokens
- Unrealized revenue for the DAO (share-price appreciation attributable to the pool)
- Realized revenue for the DAO (minted treasury shares valued at end-of-period share price)
- Total DAO revenue = unrealized + realized
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
- Inspect `Total Revenue Raw` vs. `Unrealized/Realized Revenue (DAO)` in the output to understand how the DAO’s cut compares against gross pool revenue.
