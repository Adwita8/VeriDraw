import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as sb from "@switchboard-xyz/on-demand";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { keypairIdentity, publicKey, none } from "@metaplex-foundation/umi";
import { createTree, mintV1, mplBubblegum } from "@metaplex-foundation/mpl-bubblegum";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Load wallet keypair from local solana config
function loadWalletKeypair(): Keypair {
  const home = os.homedir();
  const keypairPath = path.join(home, ".config/solana/id.json");
  if (fs.existsSync(keypairPath)) {
    return Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf-8")))
    );
  }
  throw new Error(`Solana keypair not found at ${keypairPath}. Please generate one using 'solana-keygen new'.`);
}

// Helper to delay execution
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const useDevnet = process.argv.includes("--devnet");
  const endpoint = useDevnet
    ? "https://api.devnet.solana.com"
    : "http://127.0.0.1:8899";

  console.log(`Connecting to Solana cluster: ${endpoint}`);
  const connection = new Connection(endpoint, "confirmed");

  const organizer = loadWalletKeypair();
  const wallet = new anchor.Wallet(organizer);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  // Load IDL
  const idlPath = path.join(__dirname, "../target/idl/event_raffle.json");
  if (!fs.existsSync(idlPath)) {
    throw new Error(`IDL not found at ${idlPath}. Please run 'anchor build' first.`);
  }
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  const program = new Program(idl, provider) as any;

  console.log("Raffle Program ID:", program.programId.toBase58());

  // Define unique Event ID and count configuration
  const eventId = new anchor.BN(Math.floor(Math.random() * 1000000));
  const [eventPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("event"), eventId.toArrayLike(Buffer, "le", 8)],
    program.programId
  );

  console.log(`Event ID: ${eventId.toString()}`);
  console.log(`Event PDA: ${eventPda.toBase58()}`);

  const maxParticipants = 10;
  const winnerCount = 3;

  // 1. Initialize Event
  console.log("\n--- Step 1: Initializing Event ---");
  const initTx = await program.methods
    .initializeEvent(eventId, maxParticipants, winnerCount)
    .accounts({
      organizer: organizer.publicKey,
      event: eventPda,
      systemProgram: SystemProgram.programId,
    })
    .signers([organizer])
    .rpc();
  console.log(`Event Initialized. Tx: ${initTx}`);

  // 2. Open Registration
  console.log("\n--- Step 2: Opening Registration ---");
  const openTx = await program.methods
    .openRegistration()
    .accounts({
      organizer: organizer.publicKey,
      event: eventPda,
    })
    .signers([organizer])
    .rpc();
  console.log(`Registration Opened. Tx: ${openTx}`);

  // 3. Register Multiple Participants (e.g. 5 participants)
  console.log(`\n--- Step 3: Registering ${winnerCount + 2} Participants ---`);
  const participants: Keypair[] = [];
  const entryPdas: PublicKey[] = [];

  for (let i = 0; i < winnerCount + 2; i++) {
    const participant = Keypair.generate();
    participants.push(participant);
    console.log(`Registering Participant ${i + 1}: ${participant.publicKey.toBase58()}`);

    // Airdrop SOL to participant to pay for rent
    const airdropSig = await connection.requestAirdrop(
      participant.publicKey,
      1_000_000_000
    );
    await connection.confirmTransaction(airdropSig, "confirmed");

    const [entryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("entry"), eventPda.toBuffer(), participant.publicKey.toBuffer()],
      program.programId
    );
    entryPdas.push(entryPda);

    const regTx = await program.methods
      .register()
      .accounts({
        attendee: participant.publicKey,
        event: eventPda,
        entry: entryPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([participant])
      .rpc();
    console.log(`Participant ${i + 1} Registered. Tx: ${regTx}`);
  }

  // 4. Close Registration
  console.log("\n--- Step 4: Closing Registration ---");
  const closeTx = await program.methods
    .closeRegistration()
    .accounts({
      organizer: organizer.publicKey,
      event: eventPda,
    })
    .signers([organizer])
    .rpc();
  console.log(`Registration Closed. Tx: ${closeTx}`);

  // 5. Request/Commit Switchboard Randomness
  console.log("\n--- Step 5: Committing/Requesting Randomness ---");
  const sbProgram = await sb.AnchorUtils.loadProgramFromConnection(connection, wallet);

  let queuePubkey: PublicKey;
  if (useDevnet) {
    queuePubkey = new PublicKey("EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7");
  } else {
    try {
      queuePubkey = (await sb.Queue.loadDefault(sbProgram)).pubkey;
    } catch {
      // Fallback for localnet without default queue
      queuePubkey = new PublicKey("EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7");
    }
  }

  console.log(`Switchboard Queue: ${queuePubkey.toBase58()}`);

  const rngKp = Keypair.generate();
  console.log(`Creating Switchboard randomness account: ${rngKp.publicKey.toBase58()}`);

  const [randomness, createIx] = await sb.Randomness.create(
    sbProgram,
    rngKp,
    queuePubkey
  );

  const commitIx = await randomness.commitIx(queuePubkey, organizer.publicKey);

  const reqRandomnessIx = await program.methods
    .requestRandomness()
    .accounts({
      organizer: organizer.publicKey,
      event: eventPda,
      randomnessAccount: rngKp.publicKey,
    })
    .instruction();

  const tx1 = new Transaction().add(createIx).add(commitIx).add(reqRandomnessIx);
  const tx1Sig = await sendAndConfirmTransaction(connection, tx1, [organizer, rngKp]);
  console.log(`Randomness requested/committed. Tx: ${tx1Sig}`);

  // 6. Wait for Oracle to resolve randomness
  console.log("\n--- Step 6: Waiting for Switchboard Oracle to resolve randomness ---");
  let revealIx;
  for (let i = 0; i < 20; i++) {
    try {
      console.log(`Attempt ${i + 1}: Querying gateway for signature...`);
      revealIx = await randomness.revealIx();
      console.log("Randomness is resolved and ready to reveal!");
      break;
    } catch (err) {
      await delay(3000);
    }
  }

  if (!revealIx) {
    throw new Error("Timeout waiting for Switchboard Oracle to resolve randomness.");
  }

  // 7. Atomically Reveal and Select Winners
  console.log("\n--- Step 7: Atomically revealing randomness and selecting winners ---");
  const selectWinnersIx = await program.methods
    .selectWinners()
    .accounts({
      organizer: organizer.publicKey,
      event: eventPda,
      randomnessAccount: rngKp.publicKey,
    })
    .instruction();

  const tx2 = new Transaction().add(revealIx).add(selectWinnersIx);
  const tx2Sig = await sendAndConfirmTransaction(connection, tx2, [organizer]);
  console.log(`Randomness revealed and winners selected! Tx: ${tx2Sig}`);

  // 8. Fetch event state & winner indices
  const finalEvent = await program.account.event.fetch(eventPda);
  console.log("\n--- Step 8: Verifying Winner Selections ---");
  console.log("Event state (Enum index):", finalEvent.state);
  console.log("Winners selected (indices):", finalEvent.winners.map((w: any) => w.index));

  // 9. Resolve Winners on-chain
  console.log("\n--- Step 9: Resolving Winner attendee mappings and PDAs on-chain ---");
  for (let i = 0; i < finalEvent.winners.length; i++) {
    const winnerInfo = finalEvent.winners[i];
    // Find the participant keypair corresponding to winnerInfo.index
    // We can query each entry to find the one matching the index
    let winnerAttendee: Keypair | null = null;
    let winnerEntryPda: PublicKey | null = null;

    for (let pIdx = 0; pIdx < participants.length; pIdx++) {
      const entryData = await program.account.entry.fetch(entryPdas[pIdx]);
      if (entryData.index === winnerInfo.index) {
        winnerAttendee = participants[pIdx];
        winnerEntryPda = entryPdas[pIdx];
        break;
      }
    }

    if (!winnerAttendee || !winnerEntryPda) {
      throw new Error(`Could not find participant matching winner index ${winnerInfo.index}`);
    }

    const [winnerPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("winner"),
        eventPda.toBuffer(),
        new anchor.BN(i).toArrayLike(Buffer, "le", 4),
      ],
      program.programId
    );

    console.log(`Resolving Winner ${i + 1}: Index = ${winnerInfo.index}, Attendee = ${winnerAttendee.publicKey.toBase58()}`);

    const resolveTx = await program.methods
      .resolveWinner(i)
      .accounts({
        payer: organizer.publicKey,
        event: eventPda,
        entry: winnerEntryPda,
        winnerPda: winnerPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([organizer])
      .rpc();

    console.log(`Winner ${i + 1} Resolved. Tx: ${resolveTx}`);

    // Verify winner PDA is active
    const winnerPdaData = await program.account.winner.fetch(winnerPda);
    console.log(`Winner PDA on-chain confirmation: Winner Index ${winnerPdaData.winner_index} -> ${winnerPdaData.attendee.toBase58()}`);
    
    // 10. Mint/Issue Compressed NFT to Winner
    await mintWinnerCNFT(connection, organizer, winnerAttendee.publicKey, `Raffle-${eventId.toString()}`, eventId, useDevnet);
  }

  // 11. Complete Event Lifecycle
  console.log("\n--- Step 11: Finalizing Event ---");
  const completeTx = await program.methods
    .completeEvent()
    .accounts({
      organizer: organizer.publicKey,
      event: eventPda,
    })
    .signers([organizer])
    .rpc();
  console.log(`Event Completed. Tx: ${completeTx}`);

  // Fetch final completed event state
  const completedEvent = await program.account.event.fetch(eventPda);
  console.log("\n--- Final Event State Verification ---");
  console.log("Event state (Completed index = 5):", completedEvent.state);
  console.log("Winners list resolved details:", completedEvent.winners);
}

async function mintWinnerCNFT(
  connection: Connection,
  organizer: Keypair,
  winnerPubkey: PublicKey,
  eventName: string,
  eventId: anchor.BN,
  useDevnet: boolean
) {
  console.log(`\n--- Compressed NFT: Issuing to ${winnerPubkey.toBase58()} ---`);

  if (!useDevnet) {
    console.log("[Simulation] Running on localnet. Skipping live Metaplex Bubblegum mint because the Bubblegum program is not deployed on localnet.");
    console.log("[Simulation] In production (Devnet/Mainnet), the following code runs to mint a cNFT to the winner:");
    console.log(`
      const umi = createUmi("${connection.rpcEndpoint}")
        .use(keypairIdentity(fromWeb3JsKeypair(organizer)))
        .use(mplBubblegum());
        
      // 1. Create a Merkle Tree for state compression
      const merkleTreeKeypair = generateSigner(umi);
      const treeBuilder = await createTree(umi, {
        merkleTree: merkleTreeKeypair,
        maxDepth: 14,
        maxBufferSize: 64,
      });
      await treeBuilder.sendAndConfirm(umi);
      
      // 2. Mint the cNFT representing proof of winning to the winner's wallet
      const { signature } = await mintV1(umi, {
        leafOwner: publicKey("${winnerPubkey.toBase58()}"),
        merkleTree: merkleTreeKeypair.publicKey,
        metadata: {
          name: "Event Raffle Winner - ${eventName}",
          symbol: "RAFFLE",
          uri: "https://arweave.net/example-metadata-uri",
          sellerFeeBasisPoints: 0,
          creators: [
            { address: umi.identity.publicKey, verified: true, share: 100 },
          ],
          attributes: [
            { trait_type: "Event ID", value: "${eventId.toString()}" },
            { trait_type: "Status", value: "Winner" },
          ],
        },
      }).sendAndConfirm(umi);
      
      console.log("cNFT minted successfully! Signature:", signature);
    `);
    return;
  }

  // Real Devnet implementation
  try {
    const { generateSigner } = await import("@metaplex-foundation/umi");
    
    const umi = createUmi(connection.rpcEndpoint)
      .use(mplBubblegum());
      
    // Load organizer keypair in Umi format
    const umiOrganizerKeypair = umi.eddsa.createKeypairFromSecretKey(organizer.secretKey);
    umi.use(keypairIdentity(umiOrganizerKeypair));

    console.log("Initializing Merkle Tree on Devnet...");
    const merkleTreeKeypair = generateSigner(umi);
    
    // Create Merkle Tree
    const treeBuilder = await createTree(umi, {
      merkleTree: merkleTreeKeypair,
      maxDepth: 14,
      maxBufferSize: 64,
      public: false,
    });
    
    await treeBuilder.sendAndConfirm(umi);
    console.log(`Merkle Tree initialized. Address: ${merkleTreeKeypair.publicKey}`);

    console.log("Minting cNFT to winner wallet...");
    const mintResult = await mintV1(umi, {
      leafOwner: publicKey(winnerPubkey.toBase58()),
      merkleTree: merkleTreeKeypair.publicKey,
      metadata: {
        name: `Raffle Winner - ${eventName}`,
        symbol: "RAFFLE",
        uri: "https://arweave.net/dummy-metadata-hash",
        sellerFeeBasisPoints: 0,
        collection: none(),
        creators: [{ address: umi.identity.publicKey, verified: true, share: 100 }],
        editionNonce: none(),
        isMutable: true,
        tokenProgramVersion: 0, // TokenProgramVersion.Original
        tokenStandard: none(), // Option<TokenStandard>
        uses: none(),
      }
    }).sendAndConfirm(umi);

    console.log(`cNFT successfully minted on Devnet! Signature: ${anchor.utils.bytes.hex.encode(Buffer.from(mintResult.signature))}`);
  } catch (err) {
    console.error("Failed to mint cNFT on Devnet:", err);
  }
}

main().catch((err) => {
  console.error("Error executing client script:", err);
  process.exit(1);
});
