// Generates the Holdless receipt authority keypair.
// Usage: npm run solana:keygen
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

const keypair = Keypair.generate();

console.log("Public key (fund this on devnet):");
console.log(`  ${keypair.publicKey.toBase58()}\n`);
console.log("Add this line to web/.env.local (keep it secret, never commit it):");
console.log(`  SOLANA_AUTHORITY_SECRET=${bs58.encode(keypair.secretKey)}\n`);
console.log("Fund it: https://faucet.solana.com (choose Devnet, paste the public key)");
