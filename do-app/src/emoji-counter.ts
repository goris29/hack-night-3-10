import { EMOJI_CANDIDATES } from './constants';

export class EmojiCounter {
  private state: DurableObjectState;
  private votes: Map<string, number>;
  private userVotes: Map<string, string>;
  private sessions: Map<string, WebSocket>;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.votes = new Map();
    this.userVotes = new Map();
    this.sessions = new Map();
  }

  async initialize() {
    // Load stored votes and user votes
    const storedVotes = await this.state.storage.get('votes') as Map<string, number>;
    const storedUserVotes = await this.state.storage.get('userVotes') as Map<string, string>;
    
    this.votes = storedVotes || new Map(EMOJI_CANDIDATES.map(({ emoji }) => [emoji, 0]));
    this.userVotes = storedUserVotes || new Map();
  }

  // Broadcast current state to all connected clients
  private broadcast() {
    const data = JSON.stringify({
      votes: Object.fromEntries(this.votes),
      timestamp: new Date().toISOString()
    });

    this.sessions.forEach((ws, userId) => {
      ws.send(JSON.stringify({
        votes: Object.fromEntries(this.votes),
        userVote: this.userVotes.get(userId)
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
        userVote: this.userVotes.get(userId)
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
        votes: this.votes.get(emoji),
        previousVote 
      }));
    }

    // Return all vote counts and user's current vote if userId provided
    const result = {
      votes: Object.fromEntries(this.votes),
      userVote: userId ? this.userVotes.get(userId) : null
    };
    return new Response(JSON.stringify(result));
  }
}
