# Gearbox Revenue Calculator

Calculate weighted average TVL and potential revenue for Gearbox DAO using on-chain data.

## 🚀 Quick Start

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
- **--revenue-share** - Enable revenue share mode
- **--addresses** - Comma-separated LP token holder addresses
- **--rev-coeff** - Revenue share coefficient (0-1)

## 💡 Examples

```bash
# Basic calculation
node index.js https://... 0xff94993fa7ea27efc943645f95adb36c1b81244b 2025-09-01 2025-09-30 2000

# With revenue share
node index.js https://... 0xff94993fa7ea27efc943645f95adb36c1b81244b 2025-09-01 2025-09-30 2000 \
  --revenue-share --addresses 0xABC,0xDEF --rev-coeff 0.2
```

## 📊 Output

- Average TVL in tokens
- Generated revenue for DAO in tokens
- Revenue share for selected LP addresses (if enabled)
- Token information and decimals

## 📦 Install

```bash
npm install
```
