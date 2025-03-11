import { EMOJI_CANDIDATES } from './constants';

export class EmojiCounter {
  private state: DurableObjectState;
  private votes: Map<string, number>;
  private userVotes: Map<string, string>;
  private sessions: Map<string, WebSocket>;
  private currentBattle: {
    challenger: string;
    defender: string;
    endTime: number;
  } | null;
  private battleTimer: number | null;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.votes = new Map();
    this.userVotes = new Map();
    this.sessions = new Map();
    this.currentBattle = null;
    this.battleTimer = null;
  }

  async initialize() {
    // Load stored votes and user votes
    const storedVotes = await this.state.storage.get('votes') as Map<string, number>;
    const storedUserVotes = await this.state.storage.get('userVotes') as Map<string, string>;
    const storedBattle = await this.state.storage.get('currentBattle') as {
      challenger: string;
      defender: string;
      endTime: number;
    } | null;
    
    this.votes = storedVotes || new Map(EMOJI_CANDIDATES.map(({ emoji }) => [emoji, 0]));
    this.userVotes = storedUserVotes || new Map();
    this.currentBattle = storedBattle || this.startNewBattle();

    // Start battle timer if there's an active battle
    if (this.currentBattle) {
      const timeLeft = this.currentBattle.endTime - Date.now();
      if (timeLeft > 0) {
        this.scheduleBattleEnd(timeLeft);
      } else {
        this.endBattle();
      }
    }
  }

  private startNewBattle(): { challenger: string; defender: string; endTime: number; } {
    const availableEmojis = EMOJI_CANDIDATES.map(c => c.emoji).filter(e => 
      !this.currentBattle || (e !== this.currentBattle.challenger && e !== this.currentBattle.defender)
    );
    
    const defender = this.currentBattle ? 
      (this.getWinner() || this.currentBattle.defender) : 
      availableEmojis[Math.floor(Math.random() * availableEmojis.length)];
    
    const remainingEmojis = availableEmojis.filter(e => e !== defender);
    const challenger = remainingEmojis[Math.floor(Math.random() * remainingEmojis.length)];

    const battle = {
      challenger,
      defender,
      endTime: Date.now() + 10000 // 10 seconds
    };

    // Reset votes for new battle
    this.votes = new Map();
    this.userVotes = new Map();
    this.scheduleBattleEnd(10000);

    return battle;
  }

  private scheduleBattleEnd(delay: number) {
    if (this.battleTimer) {
      clearTimeout(this.battleTimer);
    }
    this.battleTimer = setTimeout(() => this.endBattle(), delay) as unknown as number;
  }

  private getWinner(): string | null {
    if (!this.currentBattle) return null;
    const challengerVotes = this.votes.get(this.currentBattle.challenger) || 0;
    const defenderVotes = this.votes.get(this.currentBattle.defender) || 0;
    if (challengerVotes === defenderVotes) return this.currentBattle.defender; // Defender wins ties
    return challengerVotes > defenderVotes ? this.currentBattle.challenger : this.currentBattle.defender;
  }

  private async endBattle() {
    if (!this.currentBattle) return;
    
    const winner = this.getWinner();
    const newBattle = this.startNewBattle();
    this.currentBattle = newBattle;
    
    // Save both battle state and votes
    await Promise.all([
      this.state.storage.put('currentBattle', this.currentBattle),
      this.state.storage.put('votes', this.votes),
      this.state.storage.put('userVotes', this.userVotes)
    ]);
    
    this.broadcast();
  }

  // Broadcast current state to all connected clients
  private broadcast() {
    this.sessions.forEach((ws, userId) => {
      ws.send(JSON.stringify({
        votes: Object.fromEntries(this.votes),
        userVote: this.userVotes.get(userId),
        battle: this.currentBattle,
        timeLeft: this.currentBattle ? Math.max(0, this.currentBattle.endTime - Date.now()) : 0
      }));
    });
  }

  async fetch(request: Request) {
    await this.initialize();

    const url = new URL(request.url);
    const emoji = url.searchParams.get('emoji');
    const userId = url.searchParams.get('userId');

    // Handle WebSocket upgrade requests
    if (url.pathname === '/ws' && userId) {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected websocket', { status: 400 });
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      server.accept();
      
      // Store the WebSocket connection
      this.sessions.set(userId, server);

      // Send initial state
      server.send(JSON.stringify({
        votes: Object.fromEntries(this.votes),
        userVote: this.userVotes.get(userId),
        battle: this.currentBattle,
        timeLeft: this.currentBattle ? Math.max(0, this.currentBattle.endTime - Date.now()) : 0
      }));

      // Handle WebSocket closure
      server.addEventListener('close', () => {
        this.sessions.delete(userId);
      });

      return new Response(null, {
        status: 101,
        webSocket: client
      });
    }

    if (request.method === 'POST' && emoji && userId) {
      // Validate emoji is part of current battle
      if (!this.currentBattle || (emoji !== this.currentBattle.defender && emoji !== this.currentBattle.challenger)) {
        return new Response(JSON.stringify({ error: 'Invalid emoji for current battle' }), { status: 400 });
      }

      // Check if user has voted before
      const previousVote = this.userVotes.get(userId);
      
      if (previousVote && previousVote !== emoji) {
        // Remove previous vote
        const previousVoteCount = this.votes.get(previousVote) || 0;
        this.votes.set(previousVote, Math.max(0, previousVoteCount - 1));
      }

      // Update vote count for new emoji
      const currentVotes = this.votes.get(emoji) || 0;
      this.votes.set(emoji, currentVotes + (previousVote === emoji ? 0 : 1));
      
      // Store user's new vote
      this.userVotes.set(userId, emoji);

      // Save both votes and user votes
      await Promise.all([
        this.state.storage.put('votes', this.votes),
        this.state.storage.put('userVotes', this.userVotes)
      ]);

      // Broadcast updates to all connected clients
      this.broadcast();

      return new Response(JSON.stringify({ 
        emoji, 
        votes: Object.fromEntries(this.votes),
        userVote: emoji,
        battle: this.currentBattle,
        timeLeft: this.currentBattle ? Math.max(0, this.currentBattle.endTime - Date.now()) : 0
      }));
    }

    // Return all vote counts and user's current vote if userId provided
    const result = {
      votes: Object.fromEntries(this.votes),
      userVote: userId ? this.userVotes.get(userId) : null,
      battle: this.currentBattle,
      timeLeft: this.currentBattle ? Math.max(0, this.currentBattle.endTime - Date.now()) : 0
    };
    return new Response(JSON.stringify(result));
  }
}
