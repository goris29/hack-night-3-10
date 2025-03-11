import { Hono } from 'hono';
import { EMOJI_CANDIDATES } from './constants';
import { EmojiCounter } from './emoji-counter';
import { renderTemplate } from './template';

// Define interface for our environment bindings
interface Env {
  EMOJI_COUNTER: DurableObjectNamespace;
}

// Create Hono app
const app = new Hono<{ Bindings: Env }>();

// Serve the frontend
app.get('/', (c) => {
  const emojiCards = EMOJI_CANDIDATES.map(({ emoji, name }) => {
    const escapedEmoji = encodeURIComponent(emoji);
    return `
      <div class="emoji-card" id="card-${escapedEmoji}">
        <div class="emoji">${emoji}</div>
        <div class="name">${name}</div>
        <div class="votes">Votes: <span id="count-${escapedEmoji}">0</span></div>
        <button class="vote-btn" onclick="vote('${emoji}')">Vote!</button>
      </div>
    `;
  }).join('');

  const page = `
    <!doctype html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Global Emoji Battle 🌎</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 2rem;
            background: #f0f2f5;
          }
          h1 {
            text-align: center;
            color: #1a1a1a;
            font-size: 2.5rem;
            margin-bottom: 2rem;
          }
          .subtitle {
            text-align: center;
            color: #666;
            margin-bottom: 3rem;
          }
          .emoji-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1.5rem;
            margin-bottom: 2rem;
          }
          .emoji-card {
            background: white;
            border-radius: 12px;
            padding: 1.5rem;
            text-align: center;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            transition: transform 0.2s;
            cursor: pointer;
          }
          .emoji-card:hover {
            transform: translateY(-5px);
          }
          .emoji {
            font-size: 4rem;
            margin-bottom: 0.5rem;
          }
          .name {
            font-size: 1.2rem;
            color: #333;
            margin-bottom: 0.5rem;
          }
          .votes {
            font-size: 1rem;
            color: #666;
          }
          .vote-btn {
            background: #4CAF50;
            color: white;
            border: none;
            padding: 0.5rem 1rem;
            border-radius: 6px;
            font-size: 1rem;
            cursor: pointer;
            transition: background 0.2s;
          }
          .vote-btn:hover {
            background: #45a049;
          }
          @keyframes pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.2); }
            100% { transform: scale(1); }
          }
          .voted {
            animation: pulse 0.5s;
          }
          .current-vote {
            border: 3px solid #4CAF50;
            background: #f8fff8;
          }
          .current-vote .vote-btn {
            background: #45a049;
          }
        </style>
      </head>
      <body>
        <h1>Global Emoji Battle 🌎</h1>
        <p class="subtitle">Vote for your favorite emoji! Votes are counted in real-time across the globe!</p>
        <div class="emoji-grid">
          ${emojiCards}
        </div>
        <script>
          const EMOJI_CANDIDATES = ${JSON.stringify(EMOJI_CANDIDATES)};
          let voteCounts = {};
          let currentUserVote = null;
          let ws;

          // Generate or retrieve user ID
          let userId = localStorage.getItem('emojiVoteUserId');
          if (!userId) {
            userId = crypto.randomUUID();
            localStorage.setItem('emojiVoteUserId', userId);
          }

          // Setup WebSocket connection
          function connectWebSocket() {
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = \`\${wsProtocol}//\${window.location.host}/ws?userId=\${encodeURIComponent(userId)}\`;
            ws = new WebSocket(wsUrl);

            ws.onmessage = (event) => {
              const data = JSON.parse(event.data);
              voteCounts = data.votes;
              currentUserVote = data.userVote;
              updateVoteUI();
            };

            ws.onclose = () => {
              // Reconnect after a short delay
              setTimeout(connectWebSocket, 1000);
            };
          }

          function updateVoteUI() {
            EMOJI_CANDIDATES.forEach(({ emoji }) => {
              const card = document.getElementById(\`card-\${encodeURIComponent(emoji)}\`);
              const countElement = document.getElementById(\`count-\${encodeURIComponent(emoji)}\`);
              
              if (countElement) {
                countElement.textContent = voteCounts[emoji] || 0;
              }
              
              if (card) {
                if (currentUserVote === emoji) {
                  card.classList.add('current-vote');
                } else {
                  card.classList.remove('current-vote');
                }
              }
            });
          }

          async function updateVoteCounts() {
            const response = await fetch(\`/api/votes?userId=\${encodeURIComponent(userId)}\`);
            const data = await response.json();
            voteCounts = data.votes;
            currentUserVote = data.userVote;
            updateVoteUI();
          }

          async function vote(emoji) {
            const card = document.getElementById(\`card-\${encodeURIComponent(emoji)}\`);
            card.classList.add('voted');
            setTimeout(() => card.classList.remove('voted'), 500);

            const response = await fetch(
              \`/api/vote?emoji=\${encodeURIComponent(emoji)}&userId=\${encodeURIComponent(userId)}\`,
              { method: 'POST' }
            );
            const result = await response.json();
          }

          // Initial load of vote counts and setup WebSocket
          updateVoteCounts();
          connectWebSocket();
        </script>
      </body>
    </html>
  `;

  return new Response(page, {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8'
    }
  });
});

// WebSocket endpoint
app.get('/ws', async (c) => {
  const id = c.env.EMOJI_COUNTER.idFromName('global');
  const obj = c.env.EMOJI_COUNTER.get(id);
  return await obj.fetch(c.req.raw);
});

// API endpoints
app.post('/api/vote', async (c) => {
  const emoji = decodeURIComponent(c.req.query('emoji') || '');
  if (!emoji || !EMOJI_CANDIDATES.some(candidate => candidate.emoji === emoji)) {
    return c.json({ error: 'Invalid emoji' }, 400);
  }

  const id = c.env.EMOJI_COUNTER.idFromName('global');
  const obj = c.env.EMOJI_COUNTER.get(id);
  return await obj.fetch(c.req.raw);
});

app.get('/api/votes', async (c) => {
  const id = c.env.EMOJI_COUNTER.idFromName('global');
  const obj = c.env.EMOJI_COUNTER.get(id);
  return await obj.fetch(c.req.raw);
});

export default app;
export { EmojiCounter };
