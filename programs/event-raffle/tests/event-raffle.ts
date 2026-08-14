// import * as anchor from "@coral-xyz/anchor";
// import { Program } from "@coral-xyz/anchor";
// import { EventRaffle } from "../target/types/event_raffle";

// describe("event-raffle", () => {
//   const provider = anchor.AnchorProvider.env();
//   anchor.setProvider(provider);

//   const program = anchor.workspace.eventRaffle as Program<EventRaffle>;

//   it("initializes an event", async () => {
//     const eventId = new anchor.BN(1);

//     const [eventPda] = anchor.web3.PublicKey.findProgramAddressSync(
//       [
//         Buffer.from("event"),
//         eventId.toArrayLike(Buffer, "le", 8),
//       ],
//       program.programId
//     );

//     await program.methods
//       .initializeEvent(
//         eventId,
//         5000,
//         10
//       )
//       .accounts({
//         organizer: provider.wallet.publicKey,
//         event: eventPda,
//       })
//       .rpc();

//     const event = await program.account.event.fetch(eventPda);

//     console.log("Event PDA:", eventPda.toString());
//     console.log("Event:", event);

//     console.log("Organizer:", event.organizer.toString());
//     console.log("Event ID:", event.eventId.toString());
//     console.log("Max participants:", event.maxParticipants);
//     console.log("Winner count:", event.winnerCount);
//     console.log("Registration open:", event.registrationOpen);
//   });
// });