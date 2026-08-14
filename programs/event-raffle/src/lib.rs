use anchor_lang::prelude::*;
use switchboard_on_demand::RandomnessAccountData;
use solana_program::hash::hash;

declare_id!("yv7sj8H6wmQPj6CcMvzrHPfYvY5a2feXMeovm2KEj7a");

#[program]
pub mod event_raffle {
    use super::*;

    pub fn initialize_event(
        ctx: Context<InitializeEvent>,
        event_id: u64,
        max_participants: u32,
        winner_count: u32,
    ) -> Result<()> {
        let event = &mut ctx.accounts.event;

        require!(winner_count > 0, ErrorCode::InvalidWinnerCount);
        require!(winner_count <= 50, ErrorCode::WinnerCountTooHigh);
        require!(max_participants > 0, ErrorCode::InvalidMaxParticipants);

        event.organizer = ctx.accounts.organizer.key();
        event.event_id = event_id;
        event.max_participants = max_participants;
        event.winner_count = winner_count;
        event.participant_count = 0;
        event.state = EventState::Created;
        event.randomness_account = Pubkey::default();
        event.winners = Vec::new();

        Ok(())
    }

    pub fn open_registration(ctx: Context<OpenRegistration>) -> Result<()> {
        let event = &mut ctx.accounts.event;

        require!(
            event.state == EventState::Created,
            ErrorCode::InvalidStateTransition
        );

        event.state = EventState::RegistrationOpen;

        Ok(())
    }

    pub fn register(ctx: Context<Register>) -> Result<()> {
        let event = &mut ctx.accounts.event;

        require!(
            event.state == EventState::RegistrationOpen,
            ErrorCode::RegistrationClosed
        );

        require!(
            event.participant_count < event.max_participants,
            ErrorCode::EventFull
        );

        let entry = &mut ctx.accounts.entry;

        entry.event = event.key();
        entry.attendee = ctx.accounts.attendee.key();
        entry.index = event.participant_count;
        entry.is_winner = false;

        event.participant_count += 1;

        Ok(())
    }

    pub fn close_registration(ctx: Context<CloseRegistration>) -> Result<()> {
        let event = &mut ctx.accounts.event;

        require!(
            event.state == EventState::RegistrationOpen,
            ErrorCode::InvalidStateTransition
        );

        event.state = EventState::RegistrationClosed;

        Ok(())
    }

    pub fn request_randomness(ctx: Context<RequestRandomness>) -> Result<()> {
        let event = &mut ctx.accounts.event;

        require!(
            event.state == EventState::RegistrationClosed,
            ErrorCode::InvalidStateTransition
        );

        event.randomness_account = ctx.accounts.randomness_account.key();
        event.state = EventState::RandomnessRequested;

        Ok(())
    }

    pub fn select_winners(ctx: Context<SelectWinners>) -> Result<()> {
        let event = &mut ctx.accounts.event;

        require!(
            event.state == EventState::RandomnessRequested,
            ErrorCode::InvalidStateTransition
        );

        require!(
            event.participant_count > 0,
            ErrorCode::NoParticipants
        );

        let clock = Clock::get()?;

        let randomness_account_info = ctx.accounts.randomness_account.to_account_info();
        let data = randomness_account_info.data.borrow();

        let randomness_data = RandomnessAccountData::parse(data)
            .map_err(|_| ErrorCode::InvalidRandomnessAccount)?;

        let random_value = randomness_data
            .get_value(&clock)
            .map_err(|_| ErrorCode::RandomnessNotResolved)?;

        // Ensure we only select up to the number of participants registered
        let actual_winner_count = std::cmp::min(event.winner_count, event.participant_count);

        event.winners.clear();

        // Deterministically select multiple winners with linear probing for duplicate prevention
        for i in 0..actual_winner_count {
            let seed = (i as u64).to_le_bytes();
            let mut input = random_value.to_vec();
            input.extend_from_slice(&seed);
            let hashed = hash(&input).to_bytes();
            
            let start_index = (u64::from_le_bytes(
                hashed[0..8]
                    .try_into()
                    .unwrap(),
            ) % (event.participant_count as u64)) as u32;

            let mut selected_index = start_index;
            let mut attempts = 0;
            
            while attempts < event.participant_count {
                let already_selected = event.winners.iter().any(|w| w.index == selected_index);
                if !already_selected {
                    break;
                }
                selected_index = (selected_index + 1) % event.participant_count;
                attempts += 1;
            }

            event.winners.push(WinnerInfo {
                attendee: Pubkey::default(), // To be resolved via resolve_winner
                index: selected_index,
            });
        }

        event.state = EventState::WinnersSelected;

        Ok(())
    }

    pub fn resolve_winner(ctx: Context<ResolveWinner>, winner_index: u32) -> Result<()> {
        let event = &mut ctx.accounts.event;
        let entry = &mut ctx.accounts.entry;
        let winner_pda = &mut ctx.accounts.winner_pda;

        require!(
            event.state == EventState::WinnersSelected,
            ErrorCode::InvalidStateTransition
        );

        let winner_index_usize = winner_index as usize;
        require!(
            winner_index_usize < event.winners.len(),
            ErrorCode::IndexOutOfBounds
        );

        let expected_participant_index = event.winners[winner_index_usize].index;
        require!(
            entry.index == expected_participant_index,
            ErrorCode::EntryNotAWinner
        );

        require!(
            event.winners[winner_index_usize].attendee == Pubkey::default(),
            ErrorCode::WinnerAlreadyResolved
        );

        // Map the winner info on-chain
        event.winners[winner_index_usize].attendee = entry.attendee;
        entry.is_winner = true;

        // Initialize the Winner PDA
        winner_pda.event = event.key();
        winner_pda.attendee = entry.attendee;
        winner_pda.participant_index = entry.index;
        winner_pda.winner_index = winner_index;

        Ok(())
    }

    pub fn complete_event(ctx: Context<CompleteEvent>) -> Result<()> {
        let event = &mut ctx.accounts.event;

        require!(
            event.state == EventState::WinnersSelected,
            ErrorCode::InvalidStateTransition
        );

        // Ensure all winners have been resolved before completing the event lifecycle
        for w in &event.winners {
            require!(
                w.attendee != Pubkey::default(),
                ErrorCode::WinnersNotAllResolved
            );
        }

        event.state = EventState::Completed;

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(event_id: u64)]
pub struct InitializeEvent<'info> {
    #[account(mut)]
    pub organizer: Signer<'info>,

    #[account(
        init,
        payer = organizer,
        space = 8 + Event::INIT_SPACE,
        seeds = [
            b"event",
            event_id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub event: Account<'info, Event>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OpenRegistration<'info> {
    pub organizer: Signer<'info>,

    #[account(
        mut,
        constraint = event.organizer == organizer.key() @ ErrorCode::Unauthorized
    )]
    pub event: Account<'info, Event>,
}

#[derive(Accounts)]
pub struct Register<'info> {
    #[account(mut)]
    pub attendee: Signer<'info>,

    #[account(mut)]
    pub event: Account<'info, Event>,

    #[account(
        init,
        payer = attendee,
        space = 8 + Entry::INIT_SPACE,
        seeds = [
            b"entry",
            event.key().as_ref(),
            attendee.key().as_ref()
        ],
        bump
    )]
    pub entry: Account<'info, Entry>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseRegistration<'info> {
    pub organizer: Signer<'info>,

    #[account(
        mut,
        constraint = event.organizer == organizer.key() @ ErrorCode::Unauthorized
    )]
    pub event: Account<'info, Event>,
}

#[derive(Accounts)]
pub struct RequestRandomness<'info> {
    pub organizer: Signer<'info>,

    #[account(
        mut,
        constraint = event.organizer == organizer.key() @ ErrorCode::Unauthorized
    )]
    pub event: Account<'info, Event>,

    /// CHECK: Verified owner is Switchboard program.
    #[account(
        constraint = randomness_account.owner.to_bytes() == switchboard_on_demand::get_switchboard_on_demand_program_id().to_bytes() @ ErrorCode::InvalidRandomnessAccount
    )]
    pub randomness_account: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SelectWinners<'info> {
    pub organizer: Signer<'info>,

    #[account(
        mut,
        constraint = event.organizer == organizer.key() @ ErrorCode::Unauthorized
    )]
    pub event: Account<'info, Event>,

    /// CHECK: Verified owner is Switchboard program and matches event.
    #[account(
        constraint = randomness_account.owner.to_bytes() == switchboard_on_demand::get_switchboard_on_demand_program_id().to_bytes() @ ErrorCode::InvalidRandomnessAccount,
        constraint = randomness_account.key() == event.randomness_account @ ErrorCode::InvalidRandomnessAccount
    )]
    pub randomness_account: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(winner_index: u32)]
pub struct ResolveWinner<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut)]
    pub event: Account<'info, Event>,

    #[account(
        mut,
        seeds = [
            b"entry",
            event.key().as_ref(),
            entry.attendee.as_ref()
        ],
        bump
    )]
    pub entry: Account<'info, Entry>,

    #[account(
        init,
        payer = payer,
        space = 8 + Winner::INIT_SPACE,
        seeds = [
            b"winner",
            event.key().as_ref(),
            winner_index.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub winner_pda: Account<'info, Winner>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CompleteEvent<'info> {
    pub organizer: Signer<'info>,

    #[account(
        mut,
        constraint = event.organizer == organizer.key() @ ErrorCode::Unauthorized
    )]
    pub event: Account<'info, Event>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq)]
pub struct WinnerInfo {
    pub attendee: Pubkey,
    pub index: u32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq)]
pub enum EventState {
    Created,
    RegistrationOpen,
    RegistrationClosed,
    RandomnessRequested,
    WinnersSelected,
    Completed,
}

#[account]
#[derive(InitSpace)]
pub struct Event {
    pub organizer: Pubkey,
    pub event_id: u64,
    pub max_participants: u32,
    pub winner_count: u32,
    pub participant_count: u32,
    pub state: EventState,
    pub randomness_account: Pubkey,
    #[max_len(50)]
    pub winners: Vec<WinnerInfo>,
}

#[account]
#[derive(InitSpace)]
pub struct Entry {
    pub event: Pubkey,
    pub attendee: Pubkey,
    pub index: u32,
    pub is_winner: bool,
}

#[account]
#[derive(InitSpace)]
pub struct Winner {
    pub event: Pubkey,
    pub attendee: Pubkey,
    pub participant_index: u32,
    pub winner_index: u32,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Registration is closed")]
    RegistrationClosed,

    #[msg("Event is full")]
    EventFull,

    #[msg("Unauthorized")]
    Unauthorized,

    #[msg("Invalid state transition")]
    InvalidStateTransition,

    #[msg("Invalid winner count configuration")]
    InvalidWinnerCount,

    #[msg("Winner count must not exceed 50")]
    WinnerCountTooHigh,

    #[msg("Max participants configuration must be greater than 0")]
    InvalidMaxParticipants,

    #[msg("Invalid randomness account")]
    InvalidRandomnessAccount,

    #[msg("Randomness has not been resolved yet")]
    RandomnessNotResolved,

    #[msg("There are no participants in the raffle")]
    NoParticipants,

    #[msg("Index out of bounds")]
    IndexOutOfBounds,

    #[msg("This entry is not a winner")]
    EntryNotAWinner,

    #[msg("Winner is already resolved")]
    WinnerAlreadyResolved,

    #[msg("Not all winners have been resolved")]
    WinnersNotAllResolved,
}