/**
 * Reads RentAnLLM's market straight from Arkiv (Rabdi testnet), no API key or account:
 *
 *   bun packages/arkiv/scripts/query.ts [writer] [model]
 */
import { arkivReader, entityUrl, readOffers, readReceipts } from "../src/index";

const DEFAULT_WRITER = "0x7A67B250ECa8Ed822B8439b331f8Eff22c1C20F8";

const [writer = DEFAULT_WRITER, model] = process.argv.slice(2);
const reader = arkivReader(process.env.ARKIV_ACCESS_KEY ?? "");
const address = writer as `0x${string}`;

const offers = await readOffers(reader, address, model);
process.stdout.write(`${offers.length} offer(s)\n`);
for (const offer of offers) {
  process.stdout.write(
    `  ${offer.model} · ${offer.online ? "online" : "offline"} · in ${offer.priceIn} / out ${offer.priceOut} micro-USDC per Mtok · pay ${offer.payTo} on ${offer.network}\n    ${entityUrl(offer.key)}\n`
  );
}
const receipts = await readReceipts(reader, address);
process.stdout.write(`${receipts.length} receipt(s)\n`);
for (const receipt of receipts) {
  process.stdout.write(
    `  ${receipt.at.toISOString()} ${receipt.model} · ${receipt.paid} micro-USDC · tx ${receipt.paymentTx}\n    ${entityUrl(receipt.key)}\n`
  );
}
