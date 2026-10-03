import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  clusterApiUrl,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";

// SPL Memo program: writes a UTF-8 note into the transaction, readable on Explorer.
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const TIMEOUT_MS = 20_000;

export type ReceiptInput = {
  callId: string;
  transcriptHash: string;
  promisesHash: string;
  discount: number; // $ off per month
  months: number;
};

export type Receipt = {
  signature: string;
  explorerUrl: string;
};

function authority(): Keypair {
  const secret = process.env.SOLANA_AUTHORITY_SECRET;
  if (!secret) throw new Error("SOLANA_AUTHORITY_SECRET is not set (run `npm run solana:keygen`)");
  return Keypair.fromSecretKey(bs58.decode(secret));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Solana stamp timed out after ${ms / 1000}s`)), ms),
    ),
  ]);
}

export function explorerUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

export async function stampReceipt(input: ReceiptInput): Promise<Receipt> {
  const signer = authority();
  const connection = new Connection(process.env.SOLANA_RPC_URL || clusterApiUrl("devnet"), "confirmed");

  const memo = JSON.stringify({
    app: "holdless",
    v: 1,
    call: input.callId,
    transcript_sha256: input.transcriptHash,
    promises_sha256: input.promisesHash,
    discount_mo: input.discount,
    months: input.months,
  });

  const tx = new Transaction().add(
    new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [{ pubkey: signer.publicKey, isSigner: true, isWritable: false }],
      data: Buffer.from(memo, "utf8"),
    }),
  );

  const signature = await withTimeout(sendAndConfirmTransaction(connection, tx, [signer]), TIMEOUT_MS);
  return { signature, explorerUrl: explorerUrl(signature) };
}
