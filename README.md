# PixelParcel

A 50x50 shared canvas of ownable colored parcels on BOT Chain. Claim a parcel, paint it, leave a short message, list it for sale.

## Stack

- Solidity 0.8.20 (optimizer, 200 runs)
- Hardhat + hardhat-toolbox
- OpenZeppelin ^5.0.0 (Ownable, ReentrancyGuard, Pausable)
- ethers v6
- Single-file HTML frontend (ethers UMD via cdnjs)

## Networks

- **Testnet 968** — chainId `0x3C8`, RPC `https://rpc.bohr.life`
- **Mainnet 677** — chainId `0x2A5`, RPC `https://rpc.botchain.ai`
- Native token: **BOT**

## Setup

```bash
npm install
cp .env.example .env   # add PRIVATE_KEY
npx hardhat compile
npx hardhat test
```

## Deploy

```bash
npm run deploy:testnet
# or
npm run deploy:mainnet
```

After deployment, copy the printed contract address into `CONTRACT_ADDRESS` at the top of `frontend/index.html`.

## Contract

50x50 grid = 2500 parcels. Each parcel stores `(owner, color uint24 RGB, message ≤64 chars, listedPrice)`.

- `claimParcel(id, color, message)` payable — pay `parcelBasePrice` (default 0.005 BOT) for unclaimed parcels.
- `updateParcel(id, color, message)` — owner mutates color and message.
- `listForSale(id, price)` — owner lists (or delists with `price == 0`).
- `buyParcel(id)` payable — buyer pays listed price; seller gets price minus `platformFeeBps` (default 250 = 2.5%); ownership transfers, listing clears.
- `getParcels(ids)` — batched view for canvas rendering.
- Admin: `pause`, `unpause`, `setBasePrice` (≤ 1 BOT), `setPlatformFeeBps` (≤ 1000), `withdrawFees`.

## Frontend

`frontend/index.html` is a single-file DApp with a Y2K chrome / Windows-XP aesthetic. Renders the 50x50 grid by batching `getParcels` in chunks of 200. Modal opens on cell click for claim / update / list / buy actions.

Update these before shipping:
- `CONTRACT_ADDRESS`
- `USE_MAINNET` (defaults to testnet)

## Tradeoffs

- Colors are `uint24` (3-byte RGB). No alpha channel.
- Message capped at 64 bytes — enough for a short URL or one-liner.
- `_ownedIndex` is global by parcelId (not per-owner) — safe because a parcel has at most one owner at a time.
- Grid rendering uses batched view calls (200 ids each) — 13 RPC calls to render the whole canvas.
