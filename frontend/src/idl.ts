export const IDL = {
  "version": "0.1.0",
  "name": "event_raffle",
  "instructions": [
    {
      "name": "initializeEvent",
      "accounts": [
        { "name": "organizer", "isMut": true, "isSigner": true },
        { "name": "event", "isMut": true, "isSigner": false },
        { "name": "systemProgram", "isMut": false, "isSigner": false }
      ],
      "args": [
        { "name": "eventId", "type": "u64" },
        { "name": "maxParticipants", "type": "u32" },
        { "name": "winnerCount", "type": "u32" },
        { "name": "registrationFee", "type": "u64" }
      ]
    },
    {
      "name": "openRegistration",
      "accounts": [
        { "name": "organizer", "isMut": false, "isSigner": true },
        { "name": "event", "isMut": true, "isSigner": false }
      ],
      "args": []
    },
    {
      "name": "register",
      "accounts": [
        { "name": "attendee", "isMut": true, "isSigner": true },
        { "name": "event", "isMut": true, "isSigner": false },
        { "name": "organizer", "isMut": true, "isSigner": false },
        { "name": "entry", "isMut": true, "isSigner": false },
        { "name": "systemProgram", "isMut": false, "isSigner": false }
      ],
      "args": []
    },
    {
      "name": "closeRegistration",
      "accounts": [
        { "name": "organizer", "isMut": false, "isSigner": true },
        { "name": "event", "isMut": true, "isSigner": false }
      ],
      "args": []
    },
    {
      "name": "requestRandomness",
      "accounts": [
        { "name": "organizer", "isMut": false, "isSigner": true },
        { "name": "event", "isMut": true, "isSigner": false },
        { "name": "randomnessAccount", "isMut": false, "isSigner": false }
      ],
      "args": []
    },
    {
      "name": "selectWinners",
      "accounts": [
        { "name": "organizer", "isMut": false, "isSigner": true },
        { "name": "event", "isMut": true, "isSigner": false },
        { "name": "randomnessAccount", "isMut": false, "isSigner": false }
      ],
      "args": []
    },
    {
      "name": "resolveWinner",
      "accounts": [
        { "name": "payer", "isMut": true, "isSigner": true },
        { "name": "event", "isMut": true, "isSigner": false },
        { "name": "entry", "isMut": true, "isSigner": false },
        { "name": "winnerPda", "isMut": true, "isSigner": false },
        { "name": "systemProgram", "isMut": false, "isSigner": false }
      ],
      "args": [
        { "name": "winnerIndex", "type": "u32" }
      ]
    },
    {
      "name": "completeEvent",
      "accounts": [
        { "name": "organizer", "isMut": false, "isSigner": true },
        { "name": "event", "isMut": true, "isSigner": false }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "event",
      "type": {
        "kind": "struct",
        "fields": [
          { "name": "organizer", "type": "publicKey" },
          { "name": "eventId", "type": "u64" },
          { "name": "maxParticipants", "type": "u32" },
          { "name": "winnerCount", "type": "u32" },
          { "name": "registrationFee", "type": "u64" },
          { "name": "participantCount", "type": "u32" },
          { "name": "state", "type": { "defined": "EventState" } },
          { "name": "randomnessAccount", "type": "publicKey" },
          { "name": "winners", "type": { "vec": { "defined": "WinnerInfo" } } }
        ]
      }
    },
    {
      "name": "entry",
      "type": {
        "kind": "struct",
        "fields": [
          { "name": "event", "type": "publicKey" },
          { "name": "attendee", "type": "publicKey" },
          { "name": "index", "type": "u32" },
          { "name": "isWinner", "type": "boolean" },
          { "name": "participationCnftMinted", "type": "boolean" },
          { "name": "winnerCnftMinted", "type": "boolean" }
        ]
      }
    },
    {
      "name": "winner",
      "type": {
        "kind": "struct",
        "fields": [
          { "name": "event", "type": "publicKey" },
          { "name": "attendee", "type": "publicKey" },
          { "name": "participantIndex", "type": "u32" },
          { "name": "winnerIndex", "type": "u32" }
        ]
      }
    }
  ],
  "types": [
    {
      "name": "WinnerInfo",
      "type": {
        "kind": "struct",
        "fields": [
          { "name": "attendee", "type": "publicKey" },
          { "name": "index", "type": "u32" }
        ]
      }
    },
    {
      "name": "EventState",
      "type": {
        "kind": "enum",
        "variants": [
          { "name": "Created" },
          { "name": "RegistrationOpen" },
          { "name": "RegistrationClosed" },
          { "name": "RandomnessRequested" },
          { "name": "WinnersSelected" },
          { "name": "Completed" }
        ]
      }
    }
  ],
  "errors": [
    { "code": 6000, "name": "RegistrationClosed", "msg": "Registration is closed" },
    { "code": 6001, "name": "EventFull", "msg": "Event is full" },
    { "code": 6002, "name": "Unauthorized", "msg": "Unauthorized" },
    { "code": 6003, "name": "InvalidStateTransition", "msg": "Invalid state transition" },
    { "code": 6004, "name": "InvalidWinnerCount", "msg": "Invalid winner count configuration" },
    { "code": 6005, "name": "WinnerCountTooHigh", "msg": "Winner count must not exceed 50" },
    { "code": 6006, "name": "InvalidMaxParticipants", "msg": "Max participants configuration must be greater than 0" },
    { "code": 6007, "name": "InvalidRandomnessAccount", "msg": "Invalid randomness account" },
    { "code": 6008, "name": "RandomnessNotResolved", "msg": "Randomness has not been resolved yet" },
    { "code": 6009, "name": "NoParticipants", "msg": "There are no participants in the raffle" },
    { "code": 6010, "name": "IndexOutOfBounds", "msg": "Index out of bounds" },
    { "code": 6011, "name": "EntryNotAWinner", "msg": "This entry is not a winner" },
    { "code": 6012, "name": "WinnerAlreadyResolved", "msg": "Winner is already resolved" },
    { "code": 6013, "name": "WinnersNotAllResolved", "msg": "Not all winners have been resolved" },
    { "code": 6014, "name": "InsufficientFunds", "msg": "Participant does not have enough SOL to cover the registration fee" }
  ]
};
