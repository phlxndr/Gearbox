# Gearbox Revenue Calculator

Calculate weighted average TVL and potential revenue for Gearbox DAO using on-chain data.

## 🚀 Quick Start

```bash
node index.js <rpcUrl> <poolAddress> <fromDate> <toDate> <interestFee>
```

## 📋 Parameters

- **rpcUrl** - Ethereum RPC endpoint URL
- **poolAddress** - Gearbox pool contract address (0x...)
- **fromDate** - Start date (YYYY-MM-DD)
- **toDate** - End date (YYYY-MM-DD)
- **interestFee** - Interest fee in basis points (0-10000)

## 💡 Example

```bash
node index.js https://lb.drpc.live/ethereum/... 0xff94993fa7ea27efc943645f95adb36c1b81244b 2025-10-14 2025-10-14 1000
```

## 📊 Output

- Average TVL in tokens
- Generated revenue for DAO in tokens
- Token information and decimals

## 📦 Install

```bash
npm install
```
