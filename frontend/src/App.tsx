import React, { useState, useEffect, useRef, useContext, createContext, useCallback } from 'react';
import {
  Compass,
  Ship,
  Star,
  Fish,
  RefreshCw,
  Plus,
  Users,
  Award,
  FileText,
  CheckCircle,
  ArrowRight,
  ShieldCheck,
  X,
  Sparkles,
  Zap,
  Globe,
  Medal,
  Trophy,
  Coins,
  AlertCircle,
  Calendar,
  Tag,
  UserPlus,
  LayoutGrid,
  Settings,
  ChevronRight,
  Clock,
  Hash,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import tentaclesHero from './assets/tentacles_hero.jpg';
import tentaclesDesert from './assets/tentacles_desert.jpg';

// Solana Web3 & Wallet imports
import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
  useConnection,
} from '@solana/wallet-adapter-react';
import {
  WalletModalProvider,
  WalletMultiButton,
  useWalletModal,
} from '@solana/wallet-adapter-react-ui';
import '@solana/wallet-adapter-react-ui/styles.css';

// ─── Types ───────────────────────────────────────────────────────────────────

type EventState =
  | 'None'
  | 'Created'
  | 'RegistrationOpen'
  | 'RegistrationClosed'
  | 'RandomnessRequested'
  | 'WinnersSelected'
  | 'Completed';

interface Winner {
  attendee: string;
  attendeeName: string;
  index: number;
  winnerIndex: number;
  resolved: boolean;
  participationCnftMinted?: boolean;
  winnerCnftMinted?: boolean;
}

interface Participant {
  address: string;
  name: string;
  participationCnftMinted: boolean;
}

interface RaffleEvent {
  id: number;
  name: string;
  organizer: string;
  organizerWallet: string;
  maxParticipants: number;
  winnerCount: number;
  registrationFeeSol: number;
  state: EventState;
  participants: Participant[];
  winners: Winner[];
  randomnessAccount: string;
  randomValue: string;
  createdAt: Date;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const LAMPORTS_PER_SOL = 1_000_000_000;



// ─── Event Store Context ──────────────────────────────────────────────────────

interface EventStoreCtx {
  events: RaffleEvent[];
  addEvent: (ev: RaffleEvent) => void;
  updateEvent: (id: number, patch: Partial<RaffleEvent>) => void;
  nextId: () => number;
}

const EventStoreContext = createContext<EventStoreCtx>({
  events: [],
  addEvent: () => {},
  updateEvent: () => {},
  nextId: () => 1,
});

function EventStoreProvider({ children }: { children: React.ReactNode }) {
  const [events, setEvents] = useState<RaffleEvent[]>([]);
  const idRef = useRef(1001);

  const nextId = useCallback(() => {
    const id = idRef.current;
    idRef.current += 1;
    return id;
  }, []);

  const addEvent = useCallback((ev: RaffleEvent) => {
    setEvents(prev => [...prev, ev]);
  }, []);

  const updateEvent = useCallback((id: number, patch: Partial<RaffleEvent>) => {
    setEvents(prev => prev.map(e => (e.id === id ? { ...e, ...patch } : e)));
  }, []);

  return (
    <EventStoreContext.Provider value={{ events, addEvent, updateEvent, nextId }}>
      {children}
    </EventStoreContext.Provider>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function djb2Hash(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) + input.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function stateColor(state: EventState): string {
  switch (state) {
    case 'RegistrationOpen': return '#22c55e';
    case 'RegistrationClosed': return '#f59e0b';
    case 'RandomnessRequested': return '#818cf8';
    case 'WinnersSelected': return '#f97316';
    case 'Completed': return '#6b7280';
    case 'Created': return '#06b6d4';
    default: return '#9ca3af';
  }
}

function stateBg(state: EventState): string {
  switch (state) {
    case 'RegistrationOpen': return '#dcfce7';
    case 'RegistrationClosed': return '#fef3c7';
    case 'RandomnessRequested': return '#ede9fe';
    case 'WinnersSelected': return '#ffedd5';
    case 'Completed': return '#f3f4f6';
    case 'Created': return '#cffafe';
    default: return '#f9fafb';
  }
}

// ─── Registration Modal ───────────────────────────────────────────────────────

interface RegistrationModalProps {
  event: RaffleEvent;
  onClose: () => void;
  onSuccess: () => void;
}

function RegistrationModal({ event, onClose, onSuccess }: RegistrationModalProps) {
  const { updateEvent } = useContext(EventStoreContext);
  const connectedWallet = useWallet();
  const { connection } = useConnection();
  const walletAddress = connectedWallet.publicKey?.toBase58() ?? '';

  const [name, setName] = useState('');
  const [step, setStep] = useState<'form' | 'confirming' | 'success'>('form');
  const [error, setError] = useState('');
  const [balanceLamports, setBalanceLamports] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(true);

  // Minimum lamports needed to cover Solana tx fees even for free events
  const TX_FEE_BUFFER_LAMPORTS = 5_000;

  const feeLamports = Math.round(event.registrationFeeSol * LAMPORTS_PER_SOL);
  const feeDisplay = event.registrationFeeSol === 0 ? 'Free' : `${event.registrationFeeSol} SOL`;
  const spotsLeft = event.maxParticipants - event.participants.length;

  // Fetch on-chain balance as soon as the modal opens
  useEffect(() => {
    if (!connectedWallet.publicKey) return;
    setBalanceLoading(true);
    connection
      .getBalance(connectedWallet.publicKey)
      .then(lamports => setBalanceLamports(lamports))
      .catch(() => setBalanceLamports(null))
      .finally(() => setBalanceLoading(false));
  }, [connection, connectedWallet.publicKey]);

  const requiredLamports = feeLamports + TX_FEE_BUFFER_LAMPORTS;
  const hasEnoughBalance =
    balanceLamports !== null && balanceLamports >= requiredLamports;

  const balanceSol =
    balanceLamports !== null
      ? (balanceLamports / LAMPORTS_PER_SOL).toFixed(4)
      : null;

  // Wallet gate — must be connected
  if (!connectedWallet.connected) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-card" onClick={e => e.stopPropagation()}>
          <button className="modal-close-btn" onClick={onClose}><X size={18} /></button>
          <div className="wallet-gate">
            <div className="wallet-gate-icon">🔐</div>
            <h3>Connect Your Wallet</h3>
            <p>You must connect a Solana wallet to register for events.</p>
            <WalletMultiButton style={{ marginTop: '1.5rem', width: '100%', justifyContent: 'center' }} />
          </div>
        </div>
      </div>
    );
  }

  const handleRegister = () => {
    setError('');
    if (!name.trim()) { setError('Please enter your name.'); return; }
    if (event.participants.some(p => p.address === walletAddress)) {
      setError('This wallet is already registered for this event.'); return;
    }
    if (!hasEnoughBalance) {
      setError(
        event.registrationFeeSol > 0
          ? `Insufficient balance. You need at least ${event.registrationFeeSol} SOL + fees. Current balance: ${balanceSol ?? '0'} SOL.`
          : `Insufficient balance. Your wallet has no SOL to cover transaction fees.`
      );
      return;
    }

    setStep('confirming');
    const participantName = name.trim();

    setTimeout(() => {
      const newParticipant: Participant = {
        address: walletAddress,
        name: participantName,
        participationCnftMinted: false,
      };
      const updatedParticipants = [...event.participants, newParticipant];
      updateEvent(event.id, { participants: updatedParticipants });

      setTimeout(() => {
        const minted = updatedParticipants.map(p =>
          p.address === walletAddress ? { ...p, participationCnftMinted: true } : p
        );
        updateEvent(event.id, { participants: minted });
        setStep('success');
        confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
        onSuccess();
      }, 800);
    }, 1200);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <button className="modal-close-btn" onClick={onClose}><X size={18} /></button>

        {step === 'form' && (
          <>
            <div className="modal-header-icon">
              <UserPlus size={36} />
            </div>
            <h2 className="modal-title">Register for Event</h2>
            <p className="modal-event-name">{event.name}</p>
            <p className="modal-organizer">by {event.organizer}</p>

            <div className="modal-info-row">
              <div className="modal-info-pill">
                <Coins size={13} />
                {feeDisplay}
              </div>
              <div className="modal-info-pill">
                <Users size={13} />
                {spotsLeft} spots left
              </div>
            </div>

            {/* Connected wallet display with live balance */}
            <div className="wallet-connected-pill">
              <CheckCircle size={13} />
              <span>{walletAddress.slice(0, 8)}…{walletAddress.slice(-6)}</span>
              {balanceLoading ? (
                <span style={{ marginLeft: 'auto', fontSize: '0.7rem', opacity: 0.7 }}>Checking balance…</span>
              ) : (
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    color: hasEnoughBalance ? '#2e7d32' : '#c62828',
                  }}
                >
                  {balanceSol ?? '0'} SOL
                </span>
              )}
            </div>

            {/* Insufficient balance warning */}
            {!balanceLoading && !hasEnoughBalance && (
              <div className="modal-error" style={{ marginTop: '0.75rem' }}>
                <AlertCircle size={14} />
                <span>
                  {event.registrationFeeSol > 0
                    ? `Insufficient funds. Need ${event.registrationFeeSol} SOL + fees, wallet has ${balanceSol ?? '0'} SOL.`
                    : `Your wallet has no SOL. You need a small amount to cover transaction fees.`}
                </span>
              </div>
            )}

            {error && (
              <div className="modal-error">
                <AlertCircle size={14} /> {error}
              </div>
            )}

            <div className="form-group" style={{ marginTop: '1.25rem' }}>
              <label className="form-label">Your Name</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Alice Johnson"
                value={name}
                onChange={e => setName(e.target.value)}
                id="reg-name"
              />
            </div>

            {event.registrationFeeSol > 0 && (
              <div className="fee-notice">
                <Coins size={13} />
                <span>
                  A fee of <strong>{feeDisplay}</strong> ({feeLamports.toLocaleString()} lamports)
                  will be deducted from your connected wallet.
                </span>
              </div>
            )}

            <button
              className="btn-primary"
              style={{ marginTop: '1rem', opacity: (!balanceLoading && !hasEnoughBalance) ? 0.5 : 1 }}
              onClick={handleRegister}
              disabled={balanceLoading || !hasEnoughBalance}
            >
              {balanceLoading
                ? 'Checking balance…'
                : !hasEnoughBalance
                  ? 'Insufficient Balance'
                  : <><span>Confirm Registration</span> <ArrowRight size={15} /></>}
            </button>
          </>
        )}

        {step === 'confirming' && (
          <div className="modal-loading">
            <RefreshCw size={36} className="spin-icon" />
            <h3>Confirming on-chain…</h3>
            <p>Creating your entry PDA and minting Participation Badge cNFT…</p>
          </div>
        )}

        {step === 'success' && (
          <div className="modal-success">
            <div className="success-icon-circle">
              <CheckCircle size={40} />
            </div>
            <h3>You're registered! 🎉</h3>
            <p>Your Participation Badge cNFT has been minted to your wallet.</p>
            <p style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.5rem' }}>
              Good luck in the draw for <strong>{event.name}</strong>!
            </p>
            <button className="btn-primary" style={{ marginTop: '1.5rem' }} onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Event Card ───────────────────────────────────────────────────────────────

interface EventCardProps {
  event: RaffleEvent;
  onRegister: (ev: RaffleEvent) => void;
}

function EventCard({ event, onRegister }: EventCardProps) {
  const { connected, connect } = useWallet();
  const spotsLeft = event.maxParticipants - event.participants.length;
  const fillPct = (event.participants.length / event.maxParticipants) * 100;
  const feeDisplay = event.registrationFeeSol === 0 ? 'Free' : `${event.registrationFeeSol} SOL`;
  const isOpen = event.state === 'RegistrationOpen' && spotsLeft > 0;

  const handleRegisterClick = () => {
    if (!isOpen) return;
    onRegister(event);
  };

  return (
    <div className="event-card">
      <div className="event-card-top">
        <div
          className="event-state-badge"
          style={{ background: stateBg(event.state), color: stateColor(event.state) }}
        >
          <span className="event-state-dot" style={{ background: stateColor(event.state) }} />
          {event.state.replace(/([A-Z])/g, ' $1').trim()}
        </div>
        <div className="event-id-badge">
          <Hash size={11} /> {event.id}
        </div>
      </div>

      <h3 className="event-card-title">{event.name}</h3>
      <p className="event-card-organizer">
        <Globe size={13} /> {event.organizer}
      </p>

      <div className="event-card-meta">
        <div className="event-meta-item">
          <Coins size={13} className="event-meta-icon" />
          <span>{feeDisplay}</span>
        </div>
        <div className="event-meta-item">
          <Trophy size={13} className="event-meta-icon" />
          <span>{event.winnerCount} winner{event.winnerCount !== 1 ? 's' : ''}</span>
        </div>
        <div className="event-meta-item">
          <Users size={13} className="event-meta-icon" />
          <span>{event.participants.length} / {event.maxParticipants}</span>
        </div>
        <div className="event-meta-item">
          <Clock size={13} className="event-meta-icon" />
          <span>{event.createdAt.toLocaleDateString()}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="event-progress-bar-bg">
        <div
          className="event-progress-bar-fill"
          style={{ width: `${fillPct}%`, background: spotsLeft === 0 ? '#ef4444' : stateColor('RegistrationOpen') }}
        />
      </div>
      <p className="event-spots-label">
        {spotsLeft === 0 ? 'Event full' : `${spotsLeft} spots remaining`}
      </p>

      <button
        className={isOpen ? 'btn-primary' : 'btn-outline'}
        style={{ marginTop: '1rem', opacity: isOpen ? 1 : 0.5, cursor: isOpen ? 'pointer' : 'not-allowed' }}
        onClick={handleRegisterClick}
        disabled={!isOpen}
      >
        {isOpen ? (
          connected
            ? <><UserPlus size={15} /> Register Now</>
            : <><ShieldCheck size={15} /> Connect Wallet to Register</>
        ) : (
          event.state === 'Completed' ? 'Event Ended' :
          spotsLeft === 0 ? 'Full' : event.state.replace(/([A-Z])/g, ' $1').trim()
        )}
      </button>
    </div>
  );
}

// ─── Event Browser Page ───────────────────────────────────────────────────────

function EventBrowserPage() {
  const { events } = useContext(EventStoreContext);
  const { connected } = useWallet();
  const { setVisible: openWalletModal } = useWalletModal();
  const [selectedEvent, setSelectedEvent] = useState<RaffleEvent | null>(null);
  const [registeredEventIds, setRegisteredEventIds] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<'all' | 'open' | 'completed'>('open');
  const [successId, setSuccessId] = useState<number | null>(null);

  const filtered = events.filter(ev => {
    if (filter === 'open') return ev.state === 'RegistrationOpen';
    if (filter === 'completed') return ev.state === 'Completed';
    return true;
  });

  const handleSuccess = (eventId: number) => {
    setRegisteredEventIds(prev => new Set([...prev, eventId]));
    setSuccessId(eventId);
  };

  return (
    <div className="page-container" id="events">
      <div className="page-header">
        <span className="dashboard-badge">Live Events</span>
        <h2 className="dashboard-title">Browse & Register</h2>
        <p className="dashboard-desc">
          Discover active raffles. Connect your wallet to register for any open event.
        </p>
      </div>

      {/* Filter tabs */}
      <div className="filter-tabs">
        {(['open', 'all', 'completed'] as const).map(f => (
          <button
            key={f}
            className={`filter-tab ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'open' ? '🟢 Open' : f === 'all' ? '🗂 All Events' : '✅ Completed'}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><LayoutGrid size={48} /></div>
          <h3>No events yet</h3>
          <p>
            {filter === 'open'
              ? 'No events are currently accepting registrations. Check back soon, or switch to All Events.'
              : 'No events found. Organizers can create events from the Organizer tab.'}
          </p>
        </div>
      ) : (
        <div className="events-grid">
          {filtered.map(ev => (
            <div key={ev.id} style={{ position: 'relative' }}>
              {registeredEventIds.has(ev.id) && (
                <div className="registered-ribbon">
                  <CheckCircle size={11} /> Registered
                </div>
              )}
              <EventCard
                event={ev}
                onRegister={e => {
                  if (!connected) {
                    openWalletModal(true);
                  } else {
                    setSelectedEvent(e);
                  }
                }}
              />
            </div>
          ))}
        </div>
      )}

      {selectedEvent && (
        <RegistrationModal
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onSuccess={() => handleSuccess(selectedEvent.id)}
        />
      )}
    </div>
  );
}

// ─── Organizer Dashboard ──────────────────────────────────────────────────────

function OrganizerDashboard() {
  const wallet = useWallet();
  const { connection } = useConnection();
  const { events, addEvent, updateEvent, nextId } = useContext(EventStoreContext);

  // Which event this organizer is currently working on
  const [activeEventId, setActiveEventId] = useState<number | null>(null);

  // Form state for new event
  const [eventName, setEventName] = useState('');
  const [organizerName, setOrganizerName] = useState('');
  const [maxParticipants, setMaxParticipants] = useState(20);
  const [winnerCount, setWinnerCount] = useState(3);
  const [registrationFeeSol, setRegistrationFeeSol] = useState(0.05);

  // UI state
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [logs, setLogs] = useState<Array<{ text: string; type: 'success' | 'error' | 'info' }>>([
    { text: 'VeriDraw Organizer Console Initialized.', type: 'info' },
    { text: 'Connect your wallet, then fill in event details and click Initialize Event.', type: 'info' },
  ]);

  const consoleEndRef = useRef<HTMLDivElement>(null);

  // NFT modal
  const [selectedWinnerForNFT, setSelectedWinnerForNFT] = useState<Winner | null>(null);
  const [nftMintType, setNftMintType] = useState<'participation' | 'winner'>('winner');
  const [mintStatus, setMintStatus] = useState('');
  const [isMinting, setIsMinting] = useState(false);

  // On-chain balance
  const [balanceLamports, setBalanceLamports] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const TX_FEE_BUFFER_LAMPORTS = 5_000;
  const hasEnoughBalance = balanceLamports !== null && balanceLamports >= TX_FEE_BUFFER_LAMPORTS;
  const balanceSol = balanceLamports !== null ? (balanceLamports / LAMPORTS_PER_SOL).toFixed(4) : null;

  // Derived: the active event object
  const activeEvent = events.find(e => e.id === activeEventId) ?? null;

  // Filter to events owned by this wallet
  const myWalletAddr = wallet.publicKey?.toBase58() ?? '';
  const myEvents = myWalletAddr
    ? events.filter(e => e.organizerWallet === myWalletAddr)
    : [];

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    if (errorBanner) {
      const t = setTimeout(() => setErrorBanner(null), 6000);
      return () => clearTimeout(t);
    }
  }, [errorBanner]);

  // Fetch organizer's on-chain balance whenever wallet changes
  useEffect(() => {
    if (!wallet.publicKey) { setBalanceLamports(null); return; }
    setBalanceLoading(true);
    connection
      .getBalance(wallet.publicKey)
      .then(lamports => setBalanceLamports(lamports))
      .catch(() => setBalanceLamports(null))
      .finally(() => setBalanceLoading(false));
  }, [connection, wallet.publicKey]);

  const addLog = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    const ts = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { text: `[${ts}] ${text}`, type }]);
  };

  const feeLamports = Math.round(registrationFeeSol * LAMPORTS_PER_SOL);
  const feeDisplay = registrationFeeSol === 0 ? 'Free' : `${registrationFeeSol} SOL`;

  // ── Simulated Actions ────────────────────────────────────────────────────────

  const simInitializeEvent = () => {
    if (!eventName.trim()) { addLog('Event name is required.', 'error'); return; }
    if (!organizerName.trim()) { addLog('Organizer name is required.', 'error'); return; }
    if (winnerCount <= 0 || winnerCount > 50) { addLog('Winner count must be 1–50.', 'error'); return; }
    if (maxParticipants <= 0) { addLog('Max participants must be > 0.', 'error'); return; }
    if (!hasEnoughBalance) {
      addLog(`Insufficient balance: wallet has ${balanceSol ?? '0'} SOL. You need SOL to cover transaction fees.`, 'error');
      return;
    }

    const id = nextId();
    addLog(`[Solana] Initializing Event PDA with ID=${id}…`, 'info');
    addLog(`[Solana] Registration fee: ${feeDisplay} (${feeLamports} lamports)`, 'info');

    const newEvent: RaffleEvent = {
      id,
      name: eventName.trim(),
      organizer: organizerName.trim(),
      organizerWallet: myWalletAddr,
      maxParticipants,
      winnerCount,
      registrationFeeSol,
      state: 'Created',
      participants: [],
      winners: [],
      randomnessAccount: '',
      randomValue: '',
      createdAt: new Date(),
    };

    setTimeout(() => {
      addEvent(newEvent);
      setActiveEventId(id);
      addLog(`[Solana] Event "${eventName}" (ID ${id}) created. State: Created.`, 'success');
      // Reset form for next event
      setEventName('');
      setOrganizerName('');
    }, 600);
  };

  const simOpenRegistration = () => {
    if (!activeEvent) return;
    addLog('[Solana] Executing open_registration…', 'info');
    setTimeout(() => {
      updateEvent(activeEvent.id, { state: 'RegistrationOpen' });
      addLog(`[Solana] Event "${activeEvent.name}" — Registration is now OPEN. Fee: ${activeEvent.registrationFeeSol === 0 ? 'Free' : activeEvent.registrationFeeSol + ' SOL'}.`, 'success');
    }, 600);
  };



  const simRegisterAttendee = (walletAddr: string, attendeeName: string) => {
    if (!activeEvent) return;
    if (activeEvent.participants.length >= activeEvent.maxParticipants) {
      addLog('Registration failed: Event is full.', 'error'); return;
    }
    if (activeEvent.participants.some(p => p.address === walletAddr)) {
      addLog(`Already registered: ${walletAddr.slice(0, 6)}…`, 'error'); return;
    }
    addLog(`[Solana] Creating Entry PDA for ${attendeeName} (${walletAddr.slice(0, 6)}…)`, 'info');
    if (activeEvent.registrationFeeSol > 0) {
      addLog(`[Solana] Transferring ${feeDisplay} from attendee → organizer…`, 'info');
    }
    setTimeout(() => {
      const newP: Participant = { address: walletAddr, name: attendeeName, participationCnftMinted: false };
      const updated = [...activeEvent.participants, newP];
      updateEvent(activeEvent.id, { participants: updated });
      addLog(`[Solana] ${attendeeName} registered at index ${updated.length - 1}.`, 'success');
      setTimeout(() => {
        addLog(`[Bubblegum:PART] Minting Participation Badge → ${attendeeName}…`, 'info');
        setTimeout(() => {
          const minted = updated.map(p => p.address === walletAddr ? { ...p, participationCnftMinted: true } : p);
          updateEvent(activeEvent.id, { participants: minted });
          addLog(`[Bubblegum:PART] 🏅 Badge minted to ${attendeeName}.`, 'success');
        }, 500);
      }, 300);
    }, 400);
  };



  const simCloseRegistration = () => {
    if (!activeEvent) return;
    addLog('[Solana] Executing close_registration…', 'info');
    setTimeout(() => {
      updateEvent(activeEvent.id, { state: 'RegistrationClosed' });
      addLog('[Solana] State → RegistrationClosed. No more registrations.', 'success');
    }, 600);
  };

  const simRequestRandomness = () => {
    if (!activeEvent) return;
    addLog('[Solana] Calling request_randomness…', 'info');
    setTimeout(() => {
      const mockSBAccount = 'SB_VRF_' + Math.random().toString(36).substring(2, 10).toUpperCase();
      updateEvent(activeEvent.id, { state: 'RandomnessRequested', randomnessAccount: mockSBAccount });
      addLog(`[Switchboard] Oracle commit confirmed. Randomness Account: ${mockSBAccount}`, 'success');
    }, 800);
  };

  const simSelectWinners = () => {
    if (!activeEvent) return;
    if (activeEvent.participants.length === 0) {
      addLog('No participants registered.', 'error'); return;
    }
    addLog('[Solana] Invoking select_winners…', 'info');
    setTimeout(() => {
      const mockRV = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
      const actualCount = Math.min(activeEvent.winnerCount, activeEvent.participants.length);
      const selectedWinnersList: Winner[] = [];

      for (let i = 0; i < actualCount; i++) {
        const seedStr = mockRV + i.toString();
        const hashedVal = djb2Hash(seedStr);
        const startIndex = hashedVal % activeEvent.participants.length;
        let selectedIndex = startIndex;
        let attempts = 0;
        while (attempts < activeEvent.participants.length) {
          if (!selectedWinnersList.some(w => w.index === selectedIndex)) break;
          selectedIndex = (selectedIndex + 1) % activeEvent.participants.length;
          attempts++;
        }
        const p = activeEvent.participants[selectedIndex];
        selectedWinnersList.push({
          attendee: p.address,
          attendeeName: p.name,
          index: selectedIndex,
          winnerIndex: i,
          resolved: false,
          participationCnftMinted: p.participationCnftMinted,
          winnerCnftMinted: false,
        });
        addLog(`[Solana] Winner #${i + 1}: ${p.name} (index ${selectedIndex})`, 'info');
      }

      updateEvent(activeEvent.id, { winners: selectedWinnersList, randomValue: mockRV, state: 'WinnersSelected' });
      addLog('[Solana] Winners selected. State: WinnersSelected.', 'success');
    }, 1000);
  };

  const simResolveWinner = (winnerIdx: number) => {
    if (!activeEvent) return;
    const targetWinner = activeEvent.winners.find(w => w.winnerIndex === winnerIdx);
    if (!targetWinner) return;
    addLog(`[Solana] Resolving Winner #${winnerIdx + 1} — ${targetWinner.attendeeName}`, 'info');
    setTimeout(() => {
      const updated = activeEvent.winners.map(w => w.winnerIndex === winnerIdx ? { ...w, resolved: true } : w);
      updateEvent(activeEvent.id, { winners: updated });
      addLog(`[Solana] Winner PDA created for ${targetWinner.attendeeName}.`, 'success');
      setTimeout(() => {
        addLog(`[Bubblegum:WIN] Minting Winner Certificate → ${targetWinner.attendeeName}…`, 'info');
        setTimeout(() => {
          const minted = updated.map(w => w.winnerIndex === winnerIdx ? { ...w, winnerCnftMinted: true } : w);
          updateEvent(activeEvent.id, { winners: minted });
          addLog(`[Bubblegum:WIN] 🏆 Certificate minted to ${targetWinner.attendeeName}.`, 'success');
        }, 600);
      }, 400);
    }, 600);
  };

  const simCompleteEvent = () => {
    if (!activeEvent) return;
    if (!activeEvent.winners.every(w => w.resolved)) {
      addLog('All winners must be resolved first.', 'error'); return;
    }
    addLog('[Solana] Executing complete_event…', 'info');
    setTimeout(() => {
      updateEvent(activeEvent.id, { state: 'Completed' });
      addLog(`[Solana] Event "${activeEvent.name}" (ID ${activeEvent.id}) is now COMPLETED. 🎉`, 'success');
      addLog(`[Summary] ${activeEvent.participants.length} Badges + ${activeEvent.winners.length} Certificates minted.`, 'success');
      confetti({ particleCount: 150, spread: 80, origin: { y: 0.6 } });
    }, 600);
  };

  const handleMintcNFT = (winner: Winner, type: 'participation' | 'winner') => {
    setSelectedWinnerForNFT(winner);
    setNftMintType(type);
    setIsMinting(true);
    setMintStatus('Connecting Metaplex Umi client…');
    setTimeout(() => {
      setMintStatus('Configuring Bubblegum Merkle Tree…');
      setTimeout(() => {
        setMintStatus(type === 'participation' ? 'Signing Participation Badge mint…' : 'Signing Winner Certificate mint…');
        setTimeout(() => {
          setMintStatus('Minted successfully to Devnet!');
          setIsMinting(false);
          if (!activeEvent) return;
          if (type === 'participation') {
            updateEvent(activeEvent.id, {
              participants: activeEvent.participants.map(p => p.address === winner.attendee ? { ...p, participationCnftMinted: true } : p),
              winners: activeEvent.winners.map(w => w.winnerIndex === winner.winnerIndex ? { ...w, participationCnftMinted: true } : w),
            });
          } else {
            updateEvent(activeEvent.id, {
              winners: activeEvent.winners.map(w => w.winnerIndex === winner.winnerIndex ? { ...w, winnerCnftMinted: true } : w),
            });
          }
          confetti({ particleCount: 50, angle: 60, spread: 55, origin: { x: 0 } });
          confetti({ particleCount: 50, angle: 120, spread: 55, origin: { x: 1 } });
        }, 1200);
      }, 1000);
    }, 1000);
  };


  const currentState = activeEvent?.state ?? 'None';

  // Wallet guard — must connect before doing anything
  if (!wallet.connected) {
    return (
      <div className="dashboard-container" id="dashboard">
        <div className="dashboard-header-block">
          <span className="dashboard-badge">Organizer Portal</span>
          <h2 className="dashboard-title">Raffle Control Center</h2>
          <p className="dashboard-desc">Create and manage your raffle events. Multiple events can be open simultaneously.</p>
        </div>
        <div className="wallet-gate-full">
          <div className="wallet-gate-icon" style={{ fontSize: '3rem' }}>🔐</div>
          <h3>Connect Your Wallet to Continue</h3>
          <p>Wallet connection is required to create and manage events on VeriDraw.</p>
          <WalletMultiButton style={{ marginTop: '1.5rem' }} />
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-container" id="dashboard">
      {errorBanner && (
        <div className="error-banner">
          <AlertCircle size={18} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{errorBanner}</span>
          <button onClick={() => setErrorBanner(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#cc0000' }}>
            <X size={16} />
          </button>
        </div>
      )}

      <div className="dashboard-header-block">
        <span className="dashboard-badge">Organizer Portal</span>
        <h2 className="dashboard-title">Raffle Control Center</h2>
        <p className="dashboard-desc">Create and manage your raffle events. Multiple events can be open simultaneously.</p>
      </div>

      {/* Event Selector Sidebar + Main Panel */}
      <div className="organizer-layout">
        {/* Sidebar: My Events */}
        <div className="organizer-sidebar">
          <div className="sidebar-header">
            <LayoutGrid size={16} />
            <span>My Events</span>
          </div>
          {myEvents.length === 0 && (
            <p className="sidebar-empty">No events yet. Create one below.</p>
          )}
          {myEvents.map(ev => (
            <button
              key={ev.id}
              className={`sidebar-event-item ${activeEventId === ev.id ? 'active' : ''}`}
              onClick={() => setActiveEventId(ev.id)}
            >
              <div className="sidebar-event-name">{ev.name}</div>
              <div
                className="sidebar-event-state"
                style={{ color: stateColor(ev.state) }}
              >
                {ev.state.replace(/([A-Z])/g, ' $1').trim()}
              </div>
            </button>
          ))}
          <button
            className="btn-outline sidebar-new-btn"
            onClick={() => setActiveEventId(null)}
          >
            <Plus size={14} /> New Event
          </button>
        </div>

        {/* Main control area */}
        <div className="organizer-main">
          <div className="dashboard-card">
            <div className="dashboard-card-header">
              <div className="logo-container">
                <Zap size={18} className="text-terracotta" />
                <span className="dashboard-card-title">Event Engine Control</span>
              </div>
              <div className="wallet-status-pill" style={{ gap: '0.5rem' }}>
                <CheckCircle size={13} />
                <span>{myWalletAddr.slice(0, 6)}…{myWalletAddr.slice(-4)}</span>
                {balanceLoading ? (
                  <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>checking…</span>
                ) : (
                  <span style={{ fontWeight: 700, fontSize: '0.72rem', color: hasEnoughBalance ? '#2e7d32' : '#c62828' }}>
                    {balanceSol ?? '0'} SOL
                  </span>
                )}
              </div>
            </div>

            <div className="dashboard-card-body">
              {/* State Timeline */}
              {activeEvent && (
                <div className="state-timeline">
                  {(['Created', 'RegistrationOpen', 'RegistrationClosed', 'RandomnessRequested', 'WinnersSelected', 'Completed'] as EventState[]).map((st, i) => {
                    const isActive = currentState === st;
                    const stateOrder = ['None', 'Created', 'RegistrationOpen', 'RegistrationClosed', 'RandomnessRequested', 'WinnersSelected', 'Completed'];
                    const isCompleted = stateOrder.indexOf(currentState) > stateOrder.indexOf(st);
                    return (
                      <div key={st} className={`timeline-step ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}>
                        <div className="step-node">{i + 1}</div>
                        <div className="step-label">{st.replace(/([A-Z])/g, ' $1').trim()}</div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="dashboard-grid">
                {/* Control Panel */}
                <div className="control-panel">

                  {/* No event selected — show create form */}
                  {!activeEvent && (
                    <div>
                      <h3 className="form-title"><Plus size={20} /> Initialize New Event</h3>

                      <div className="form-group">
                        <label className="form-label"><Tag size={13} /> Event Name</label>
                        <input type="text" className="form-input" placeholder="e.g. DevCon 2026 Raffle" value={eventName} onChange={e => setEventName(e.target.value)} id="event-name" />
                      </div>
                      <div className="form-group">
                        <label className="form-label"><Globe size={13} /> Organizer Name</label>
                        <input type="text" className="form-input" placeholder="e.g. DevCon Team" value={organizerName} onChange={e => setOrganizerName(e.target.value)} id="organizer-name" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Max Participants</label>
                        <input type="number" className="form-input" value={maxParticipants} onChange={e => setMaxParticipants(Number(e.target.value))} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Winner Count</label>
                        <input type="number" className="form-input" value={winnerCount} onChange={e => setWinnerCount(Number(e.target.value))} />
                      </div>
                      <div className="form-group">
                        <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <Coins size={14} /> Registration Fee (SOL)
                        </label>
                        <input type="number" step="0.01" min="0" className="form-input" value={registrationFeeSol} onChange={e => setRegistrationFeeSol(Number(e.target.value))} />
                        <p style={{ fontSize: '0.72rem', color: '#888', marginTop: '0.35rem' }}>
                          {registrationFeeSol === 0 ? '🎁 Free event.' : `= ${feeLamports.toLocaleString()} lamports per registrant.`}
                        </p>
                      </div>

                      {!balanceLoading && !hasEnoughBalance && (
                        <div className="modal-error" style={{ marginBottom: '1rem', borderRadius: '8px' }}>
                          <AlertCircle size={14} />
                          <span>Your wallet has no SOL. You need SOL to cover on-chain transaction fees before creating an event.</span>
                        </div>
                      )}

                      <button
                        className="btn-primary"
                        onClick={simInitializeEvent}
                        disabled={balanceLoading || !hasEnoughBalance}
                        style={{ opacity: (!balanceLoading && !hasEnoughBalance) ? 0.5 : 1 }}
                      >
                        {balanceLoading ? 'Checking balance…' : !hasEnoughBalance ? 'Insufficient Balance' : 'Initialize Event'}
                      </button>
                    </div>
                  )}

                  {/* Created state */}
                  {activeEvent && currentState === 'Created' && (
                    <div>
                      <h3 className="form-title"><Compass size={20} /> Open Registration</h3>
                      <div className="event-info-pill-group">
                        <span className="event-info-pill"><Calendar size={12} /> {activeEvent.name}</span>
                        <span className="event-info-pill" style={{ background: activeEvent.registrationFeeSol === 0 ? '#e8f5e9' : '#fff3e0', color: activeEvent.registrationFeeSol === 0 ? '#2e7d32' : '#e65100' }}>
                          <Coins size={12} /> {activeEvent.registrationFeeSol === 0 ? 'Free' : `${activeEvent.registrationFeeSol} SOL`}
                        </span>
                      </div>
                      <p className="feature-desc" style={{ marginBottom: '1.5rem', textAlign: 'left' }}>
                        The event has been initialized. Open registration to allow attendees to sign up from the Events tab.
                      </p>
                      <button className="btn-primary" onClick={simOpenRegistration}>Open Registration</button>
                    </div>
                  )}

                  {/* RegistrationOpen state */}
                  {activeEvent && currentState === 'RegistrationOpen' && (
                    <div>
                      <h3 className="form-title"><Users size={20} /> Register Attendees</h3>
                      {activeEvent.registrationFeeSol > 0 && (
                        <div className="fee-notice" style={{ marginBottom: '1rem' }}>
                          <Coins size={14} />
                          <span>Each registration charges <strong>{activeEvent.registrationFeeSol} SOL</strong> → organizer.</span>
                        </div>
                      )}
                      <p style={{ fontSize: '0.8rem', color: '#4a5447', marginBottom: '1rem' }}>
                        Attendees can self-register from the <strong>Events</strong> tab.
                      </p>
                      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
                        <button className="btn-primary" onClick={simCloseRegistration} style={{ flex: 1 }}>Close Registration</button>
                      </div>
                      <div>
                        <h4 className="form-label" style={{ marginBottom: '0.5rem' }}>
                          Registered ({activeEvent.participants.length} / {activeEvent.maxParticipants})
                        </h4>
                        <div className="participant-list">
                          {activeEvent.participants.length === 0 ? (
                            <p style={{ fontSize: '0.8rem', color: '#8c958a', textAlign: 'center', padding: '1rem' }}>No participants yet.</p>
                          ) : (
                            activeEvent.participants.map((p, idx) => (
                              <div key={idx} className="participant-item">
                                <div>
                                  <span style={{ fontWeight: 600 }}>{p.name}</span>
                                  <div style={{ fontSize: '0.7rem', opacity: 0.7 }}>{p.address.slice(0, 8)}…{p.address.slice(-8)}</div>
                                </div>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.7rem', fontWeight: 700, color: p.participationCnftMinted ? '#2e7d32' : '#888' }}>
                                  <Medal size={12} /> {p.participationCnftMinted ? 'Badge Minted' : 'Minting…'}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* RegistrationClosed state */}
                  {activeEvent && currentState === 'RegistrationClosed' && (
                    <div>
                      <h3 className="form-title"><RefreshCw size={20} /> Request Randomness</h3>
                      <p className="feature-desc" style={{ marginBottom: '1.5rem', textAlign: 'left' }}>
                        Registration closed with {activeEvent.participants.length} attendees. Request verifiable randomness from Switchboard VRF Oracle.
                      </p>
                      <button className="btn-primary" onClick={simRequestRandomness}>Request Randomness (VRF)</button>
                    </div>
                  )}

                  {/* RandomnessRequested state */}
                  {activeEvent && currentState === 'RandomnessRequested' && (
                    <div>
                      <h3 className="form-title"><Sparkles size={20} /> Resolve & Draw Winners</h3>
                      <p className="feature-desc" style={{ marginBottom: '1.5rem', textAlign: 'left' }}>
                        VRF randomness requested. Once resolved, trigger on-chain winner selection.
                      </p>
                      <div style={{ backgroundColor: '#f5f7f4', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem', fontSize: '0.85rem' }}>
                        <strong>Randomness PDA:</strong> {activeEvent.randomnessAccount || 'Fetching…'}
                      </div>
                      <button className="btn-primary" onClick={simSelectWinners}>Select Winners (Probing)</button>
                    </div>
                  )}

                  {/* WinnersSelected state */}
                  {activeEvent && currentState === 'WinnersSelected' && (
                    <div>
                      <h3 className="form-title"><Award size={20} /> Resolve Winners</h3>
                      <p className="feature-desc" style={{ marginBottom: '1.5rem', textAlign: 'left' }}>
                        Resolve Winner PDAs on-chain to mint Winner Certificate cNFTs.
                      </p>
                      <div className="participant-list" style={{ marginBottom: '1.5rem', maxHeight: '220px' }}>
                        {activeEvent.winners.map((w, idx) => (
                          <div key={idx} className={`participant-item ${w.resolved ? 'winner' : ''}`} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.5rem', padding: '0.75rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                              <div>
                                <span style={{ fontWeight: 'bold' }}>Winner #{w.winnerIndex + 1}</span>
                                <div style={{ fontSize: '0.75rem', opacity: 0.8 }}>{w.attendeeName} — {w.attendee.slice(0, 10)}…</div>
                              </div>
                              {w.resolved ? (
                                <span style={{ color: 'var(--color-pine)', fontSize: '0.75rem', fontWeight: 'bold' }}>Resolved</span>
                              ) : (
                                <button className="btn-secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem' }} onClick={() => simResolveWinner(w.winnerIndex)}>
                                  Resolve PDA
                                </button>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                              <span style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.68rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: '12px', background: w.participationCnftMinted ? '#e8f5e9' : '#f5f5f5', color: w.participationCnftMinted ? '#2e7d32' : '#999', border: `1px solid ${w.participationCnftMinted ? '#81c784' : '#ddd'}` }}>
                                <Medal size={10} /> {w.participationCnftMinted ? '🏅 Badge Minted' : '🏅 Badge Pending'}
                              </span>
                              <span style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.68rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: '12px', background: w.winnerCnftMinted ? '#fff3e0' : '#f5f5f5', color: w.winnerCnftMinted ? '#e65100' : '#999', border: `1px solid ${w.winnerCnftMinted ? '#ffb74d' : '#ddd'}` }}>
                                <Trophy size={10} /> {w.winnerCnftMinted ? '🏆 Certificate Minted' : '🏆 Certificate Pending'}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                      {activeEvent.winners.every(w => w.resolved) ? (
                        <button className="btn-primary" onClick={simCompleteEvent}>Complete Event</button>
                      ) : (
                        <button className="btn-primary" disabled>Resolve All Winners First</button>
                      )}
                    </div>
                  )}

                  {/* Completed state */}
                  {activeEvent && currentState === 'Completed' && (
                    <div>
                      <h3 className="form-title"><CheckCircle size={20} className="text-pine" /> Raffle Completed</h3>
                      <p className="feature-desc" style={{ marginBottom: '1.5rem', textAlign: 'left' }}>
                        All participants received 🏅 Participation Badge cNFTs. Winners received 🏆 Certificate cNFTs.
                      </p>
                      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: '100px', background: '#e8f5e9', border: '1.5px solid #81c784', borderRadius: '10px', padding: '0.6rem', textAlign: 'center' }}>
                          <div style={{ fontSize: '1.4rem' }}>🏅</div>
                          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#2e7d32' }}>Badges</div>
                          <div style={{ fontSize: '1.1rem', fontWeight: 900, color: '#1b5e20' }}>{activeEvent.participants.length}</div>
                        </div>
                        <div style={{ flex: 1, minWidth: '100px', background: '#fff3e0', border: '1.5px solid #ffb74d', borderRadius: '10px', padding: '0.6rem', textAlign: 'center' }}>
                          <div style={{ fontSize: '1.4rem' }}>🏆</div>
                          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#e65100' }}>Certificates</div>
                          <div style={{ fontSize: '1.1rem', fontWeight: 900, color: '#bf360c' }}>{activeEvent.winners.length}</div>
                        </div>
                        {activeEvent.registrationFeeSol > 0 && (
                          <div style={{ flex: 1, minWidth: '100px', background: '#f3e5f5', border: '1.5px solid #ce93d8', borderRadius: '10px', padding: '0.6rem', textAlign: 'center' }}>
                            <div style={{ fontSize: '1.4rem' }}>💸</div>
                            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#6a1b9a' }}>Fees Collected</div>
                            <div style={{ fontSize: '1.1rem', fontWeight: 900, color: '#4a148c' }}>{(activeEvent.registrationFeeSol * activeEvent.participants.length).toFixed(3)} SOL</div>
                          </div>
                        )}
                      </div>
                      <div className="participant-list" style={{ marginBottom: '1.5rem' }}>
                        {activeEvent.winners.map((w, idx) => (
                          <div key={idx} className="participant-item winner" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.5rem', padding: '0.75rem' }}>
                            <div>
                              <span style={{ fontWeight: 'bold' }}>Winner #{w.winnerIndex + 1} — {w.attendeeName}</span>
                              <div style={{ fontSize: '0.7rem', opacity: 0.8 }}>{w.attendee}</div>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', width: '100%' }}>
                              {w.participationCnftMinted ? (
                                <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.73rem', fontWeight: 700, padding: '0.2rem 0.6rem', borderRadius: '14px', background: '#e8f5e9', color: '#2e7d32', border: '1px solid #81c784' }}>
                                  <Medal size={11} /> 🏅 Badge Minted
                                </span>
                              ) : (
                                <button className="btn-secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem', backgroundColor: '#e8f5e9', color: '#2e7d32', borderColor: '#81c784', boxShadow: '2px 2px 0px #81c784' }} onClick={() => handleMintcNFT(w, 'participation')}>
                                  Mint 🏅 Badge
                                </button>
                              )}
                              {w.winnerCnftMinted ? (
                                <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.73rem', fontWeight: 700, padding: '0.2rem 0.6rem', borderRadius: '14px', background: '#fff3e0', color: '#e65100', border: '1px solid #ffb74d' }}>
                                  <Trophy size={11} /> 🏆 Certificate Minted
                                </span>
                              ) : (
                                <button className="btn-secondary" style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', backgroundColor: 'var(--color-terracotta)', color: '#ffffff', borderColor: '#000000', boxShadow: '2px 2px 0px #000000' }} onClick={() => handleMintcNFT(w, 'winner')}>
                                  Mint 🏆 Certificate
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      <button className="btn-outline" onClick={() => setActiveEventId(null)}>
                        Create Another Event
                      </button>
                    </div>
                  )}
                </div>

                {/* Console */}
                <div className="log-panel">
                  <h3 className="form-title"><FileText size={20} /> Developer Console</h3>
                  <div className="console-box">
                    {logs.map((log, index) => (
                      <div key={index} className={`console-line ${log.type}`}>{log.text}</div>
                    ))}
                    <div ref={consoleEndRef} />
                  </div>
                  <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', color: '#666e63' }}>
                      State: <strong style={{ color: 'var(--color-pine)' }}>{currentState}</strong>
                      {activeEvent && <> &nbsp;|&nbsp; Event: <strong>{activeEvent.name}</strong></>}
                    </span>
                    <button className="btn-outline" style={{ padding: '0.25rem 0.5rem', fontSize: '0.7rem' }} onClick={() => setLogs([{ text: 'Console cleared.', type: 'info' }])}>
                      Clear Logs
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* NFT Mint Modal */}
      {selectedWinnerForNFT && (
        <div className="nft-modal-overlay">
          <div className="nft-card">
            <button className="close-btn" onClick={() => setSelectedWinnerForNFT(null)}><X /></button>
            <div className="nft-certificate-seal">
              {nftMintType === 'participation' ? <Medal size={42} /> : <Award size={42} />}
            </div>
            <h3 className="nft-card-title">
              {nftMintType === 'participation' ? '🏅 Participation Badge cNFT' : '🏆 Winner Certificate cNFT'}
            </h3>
            <p className="nft-card-subtitle">
              {nftMintType === 'participation' ? 'Proof of entry — minted to every registrant' : 'Verifiable proof of Solana Event Raffle win'}
            </p>
            <table className="nft-details-table">
              <tbody>
                <tr><td>Event</td><td>{activeEvent?.name}</td></tr>
                <tr><td>Event ID</td><td>{activeEvent?.id}</td></tr>
                {nftMintType === 'winner' && <tr><td>Winner Index</td><td>#{selectedWinnerForNFT.winnerIndex + 1}</td></tr>}
                <tr><td>Attendee</td><td>{selectedWinnerForNFT.attendeeName}</td></tr>
                <tr><td>Symbol</td><td>{nftMintType === 'participation' ? 'PART' : 'WIN'}</td></tr>
                <tr><td>MINT TYPE</td><td>Metaplex Bubblegum cNFT</td></tr>
              </tbody>
            </table>
            {isMinting ? (
              <div style={{ textAlign: 'center' }}>
                <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'center' }}>
                  <RefreshCw size={24} style={{ animation: 'spin 1.5s linear infinite', color: 'var(--color-terracotta)' }} />
                </div>
                <p style={{ fontStyle: 'italic', fontSize: '0.9rem', color: 'var(--color-pine)' }}>{mintStatus}</p>
              </div>
            ) : (
              <div>
                <div style={{ color: 'var(--color-pine)', fontWeight: 'bold', fontSize: '0.95rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                  <CheckCircle size={18} /> {nftMintType === 'participation' ? 'Badge' : 'Certificate'} Minted!
                </div>
                <button className="btn-primary" onClick={() => setSelectedWinnerForNFT(null)}>Close Proof</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────

interface HeaderProps {
  activeTab: 'events' | 'organizer';
  onTabChange: (tab: 'events' | 'organizer') => void;
}

function Header({ activeTab, onTabChange }: HeaderProps) {
  return (
    <header>
      <div className="logo-container">
        <Compass size={22} className="text-primary" />
        <span className="logo-text">VeriDraw</span>
      </div>
      <nav>
        <ul>
          <li><a href="#home">Home</a></li>
          <li>
            <button
              className={`nav-tab-btn ${activeTab === 'events' ? 'active' : ''}`}
              onClick={() => onTabChange('events')}
            >
              <LayoutGrid size={14} /> Events
            </button>
          </li>
          <li>
            <button
              className={`nav-tab-btn ${activeTab === 'organizer' ? 'active' : ''}`}
              onClick={() => onTabChange('organizer')}
            >
              <Settings size={14} /> Organizer
            </button>
          </li>
          <li><a href="#about">About</a></li>
        </ul>
      </nav>
      <div className="header-right">
        <WalletMultiButton
          className="btn-secondary"
          style={{
            height: 'auto',
            padding: '0.5rem 1rem',
            fontSize: '0.8rem',
            background: '#ffffff',
            color: 'var(--color-pine)',
            border: '2px solid var(--color-pine)',
            boxShadow: '3px 3px 0px var(--color-pine)',
            fontFamily: 'var(--font-title)',
            fontWeight: '800',
          }}
        />
      </div>
    </header>
  );
}

// ─── App Layout ───────────────────────────────────────────────────────────────

function App() {
  const [activeTab, setActiveTab] = useState<'events' | 'organizer'>('events');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Header activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Hero */}
      <section className="hero-section" id="home">
        <div className="hero-overlay" />
        <div className="hero-container">
          <div className="hero-content">
            <div className="hero-title-group">
              <h1 className="hero-title">
                <span>veri</span>
                <span className="indent">draw</span>
              </h1>

            </div>
            <div style={{ marginTop: '2.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <button
                className="btn-primary"
                style={{ display: 'inline-flex', width: 'auto' }}
                onClick={() => setActiveTab('events')}
              >
                Browse Events <LayoutGrid size={16} />
              </button>
              <button
                className="btn-outline"
                style={{ display: 'inline-flex', width: 'auto', color: '#fff', borderColor: '#fff' }}
                onClick={() => setActiveTab('organizer')}
              >
                Create Event <ArrowRight size={16} />
              </button>
            </div>
          </div>
          <div className="hero-image-wrapper">
            <img src={tentaclesHero} alt="Vintage illustration of tentacles in sea fog" className="hero-image" />
          </div>
        </div>
      </section>

      {/* Intro */}
      <section className="intro-section">
        <p className="intro-text">
          VeriDraw is an <strong>on-chain raffle platform</strong> built for <strong>transparent and verifiable winner selection.</strong>
          Multiple organizers can run concurrent events — anyone can register without creating an account.
        </p>
      </section>

      {/* Features */}
      <section className="features-section">
        <div className="features-grid">
          <div className="feature-col">
            <div className="feature-icon-circle"><Compass size={32} /></div>
            <h3 className="feature-title">Create Events</h3>
            <p className="feature-desc">Any organizer can initialize an event on-chain with custom config — multiple events run simultaneously.</p>
          </div>
          <div className="feature-col">
            <div className="feature-icon-circle"><UserPlus size={32} /></div>
            <h3 className="feature-title">Register Freely</h3>
            <p className="feature-desc">Attendees browse active events and register with just a name and wallet address — no account required.</p>
          </div>
          <div className="feature-col">
            <div className="feature-icon-circle"><Star size={32} /></div>
            <h3 className="feature-title">Switchboard VRF</h3>
            <p className="feature-desc">Hook into Switchboard On-Demand VRF for un-biasable random buffer calculations.</p>
          </div>
          <div className="feature-col">
            <div className="feature-icon-circle"><Fish size={32} /></div>
            <h3 className="feature-title">Dual cNFT Proofs</h3>
            <p className="feature-desc">Every registrant gets a 🏅 Participation Badge. Winners get a 🏆 Certificate — both via Metaplex Bubblegum.</p>
          </div>
        </div>
      </section>

      {/* Main content: Events or Organizer tab */}
      <section className="dashboard-section">
        {activeTab === 'events' ? <EventBrowserPage /> : <OrganizerDashboard />}
      </section>

      {/* About */}
      <section className="about-section" id="about">
        <div className="about-image-wrapper">
          <img src={tentaclesDesert} alt="Person in desert with red tentacles illustration" className="about-image" />
        </div>
        <div className="about-content">
          <h2 className="about-title">About VeriDraw</h2>
          <p className="about-text">
            Solana raffle protocols often rely on blockhashes or simple timestamps for drawing indices. These are easily exploited by malicious validators or front-runners. VeriDraw changes the game by integrating Switchboard VRF randomness accounts directly into the selection lifecycle.
          </p>
          <p className="about-text">
            When drawing multiple winners, simple modulos can result in duplicate entries. VeriDraw uses a deterministic linear probing algorithm implemented in Rust: for each winner index, a hash seed resolves an index. If that attendee is already flagged, it probes forward circularly until a unique winner is locked.
          </p>
          <p className="about-text">
            Every participant receives a <strong>Participation Badge cNFT</strong> (symbol: PART) as on-chain proof of entry. VRF-selected winners additionally receive a <strong>Winner Certificate cNFT</strong> (symbol: WIN). Winner outcomes are written into dedicated PDA seeds: <code>["winner", event_pubkey, winner_index]</code>.
          </p>
        </div>
      </section>

      <footer>
        <div className="footer-credits">VeriDraw &copy; 2026.</div>
      </footer>
    </div>
  );
}

// ─── Root Export ─────────────────────────────────────────────────────────────

export default function AppWithProvider() {
  return (
    // @ts-ignore
    <ConnectionProvider endpoint="https://api.devnet.solana.com">
      {/* @ts-ignore */}
      <WalletProvider wallets={[]} autoConnect>
        {/* @ts-ignore */}
        <WalletModalProvider>
          <EventStoreProvider>
            <App />
          </EventStoreProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
