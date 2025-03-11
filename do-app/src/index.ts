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
  const battleUI = `
    <div class="battle-container">
      <div class="battle-timer">
        <div class="timer-bar">
          <div class="timer-progress" id="timer-progress"></div>
        </div>
        <div class="timer-text">Time left: <span id="countdown">10</span>s</div>
      </div>
      <div class="battle-arena">
        <div class="emoji-card defender" id="defender-card">
          <div class="title">Defender</div>
          <div class="emoji" id="defender-emoji"></div>
          <div class="name" id="defender-name"></div>
          <div class="votes">Votes: <span id="defender-votes">0</span></div>
          <button class="vote-btn" onclick="vote('defender')">Vote!</button>
        </div>
        <div class="vs">VS</div>
        <div class="emoji-card challenger" id="challenger-card">
          <div class="title">Challenger</div>
          <div class="emoji" id="challenger-emoji"></div>
          <div class="name" id="challenger-name"></div>
          <div class="votes">Votes: <span id="challenger-votes">0</span></div>
          <button class="vote-btn" onclick="vote('challenger')">Vote!</button>
        </div>
      </div>
    </div>
  `;

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
            max-width: 1000px;
            margin: 0 auto;
            padding: 2rem;
            background: #1a1a1a;
            color: #fff;
          }
          h1 {
            text-align: center;
            color: #fff;
            font-size: 3rem;
            margin-bottom: 2rem;
            text-shadow: 0 0 10px rgba(255,255,255,0.5);
          }
          .subtitle {
            text-align: center;
            color: #aaa;
            margin-bottom: 3rem;
            font-size: 1.2rem;
          }
          .battle-container {
            background: rgba(255,255,255,0.1);
            border-radius: 20px;
            padding: 2rem;
            margin-bottom: 2rem;
          }
          .battle-timer {
            text-align: center;
            margin-bottom: 2rem;
          }
          .timer-bar {
            height: 10px;
            background: rgba(255,255,255,0.2);
            border-radius: 5px;
            margin: 1rem auto;
            width: 100%;
            max-width: 400px;
          }
          .timer-progress {
            height: 100%;
            background: #4CAF50;
            border-radius: 5px;
            width: 100%;
            transition: width 1s linear;
          }
          .timer-text {
            font-size: 1.2rem;
            color: #fff;
          }
          .battle-arena {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 2rem;
          }
          @media (max-width: 600px) {
            .battle-arena {
              flex-direction: column;
              gap: 1rem;
            }
            .vs {
              margin: 1rem 0;
            }
            .emoji-card {
              width: 100%;
            }
          }
          .emoji-card {
            background: rgba(255,255,255,0.1);
            border-radius: 12px;
            padding: 2rem;
            text-align: center;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            transition: transform 0.2s;
            flex: 1;
            position: relative;
            overflow: hidden;
          }
          .emoji-card:hover {
            transform: translateY(-5px);
            background: rgba(255,255,255,0.15);
          }
          .title {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            background: rgba(0,0,0,0.5);
            padding: 0.5rem;
            font-size: 0.9rem;
            text-transform: uppercase;
            letter-spacing: 1px;
          }
          .vs {
            font-size: 2rem;
            font-weight: bold;
            color: #fff;
            text-shadow: 0 0 10px rgba(255,255,255,0.5);
          }
          .emoji {
            font-size: 6rem;
            margin: 1.5rem 0;
            text-shadow: 0 0 20px rgba(255,255,255,0.3);
          }
          .name {
            font-size: 1.4rem;
            color: #fff;
            margin-bottom: 1rem;
          }
          .votes {
            font-size: 1.2rem;
            color: #aaa;
            margin-bottom: 1rem;
          }
          .vote-btn {
            background: #4CAF50;
            color: white;
            border: none;
            padding: 0.8rem 2rem;
            border-radius: 6px;
            font-size: 1.1rem;
            cursor: pointer;
            transition: all 0.2s;
            text-transform: uppercase;
            letter-spacing: 1px;
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
            background: rgba(76, 175, 80, 0.1);
          }
          .current-vote .vote-btn {
            background: #45a049;
          }
        </style>
      </head>
      <body>
        <h1>Global Emoji Battle 🌎</h1>
        <p class="subtitle">Every 10 seconds, two emojis battle for supremacy! Vote for your favorite!</p>
        ${battleUI}
        <script>
          const EMOJI_CANDIDATES = ${JSON.stringify(EMOJI_CANDIDATES)};
          let currentBattle = null;
          let voteCounts = {};
          let currentUserVote = null;
          let ws;
          let timerInterval = null;

          function startTimer() {
            if (timerInterval) {
              clearInterval(timerInterval);
            }
            
            timerInterval = setInterval(() => {
              if (currentBattle) {
                const timeLeft = Math.max(0, Math.floor((currentBattle.endTime - Date.now()) / 1000));
                updateTimer(timeLeft);
              }
            }, 1000);
          }

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
              currentBattle = data.battle;
              updateBattleUI(data);
            };

            ws.onclose = () => {
              // Reconnect after a short delay
              setTimeout(connectWebSocket, 1000);
            };
          }

          function updateBattleUI(data) {
            if (!data.battle) return;

            const previousEndTime = currentBattle?.endTime;
            
            // If this is a new battle (different end time), restart the timer
            if (previousEndTime !== data.battle.endTime) {
              startTimer();
            }
            
            currentBattle = data.battle;
            const defenderInfo = EMOJI_CANDIDATES.find(c => c.emoji === data.battle.defender);
            const challengerInfo = EMOJI_CANDIDATES.find(c => c.emoji === data.battle.challenger);
            
            if (!defenderInfo || !challengerInfo) {
              console.error('Could not find emoji info:', { defender: data.battle.defender, challenger: data.battle.challenger });
              return;
            }
            
            // Update emojis and names
            const defenderEmoji = document.getElementById('defender-emoji');
            const defenderName = document.getElementById('defender-name');
            const challengerEmoji = document.getElementById('challenger-emoji');
            const challengerName = document.getElementById('challenger-name');

            if (defenderEmoji) defenderEmoji.textContent = defenderInfo.emoji;
            if (defenderName) defenderName.textContent = defenderInfo.name;
            if (challengerEmoji) challengerEmoji.textContent = challengerInfo.emoji;
            if (challengerName) challengerName.textContent = challengerInfo.name;
            
            // Update vote counts
            document.getElementById('defender-votes').textContent = voteCounts[data.battle.defender] || 0;
            document.getElementById('challenger-votes').textContent = voteCounts[data.battle.challenger] || 0;
            
            // Update timer
            const timeLeft = Math.max(0, Math.floor((data.battle.endTime - Date.now()) / 1000));
            updateTimer(timeLeft);
            
            // Update vote buttons state
            const defenderCard = document.getElementById('defender-card');
            const challengerCard = document.getElementById('challenger-card');
            
            if (currentUserVote === data.battle.defender) {
              defenderCard.classList.add('current-vote');
              challengerCard.classList.remove('current-vote');
            } else if (currentUserVote === data.battle.challenger) {
              challengerCard.classList.add('current-vote');
              defenderCard.classList.remove('current-vote');
            } else {
              defenderCard.classList.remove('current-vote');
              challengerCard.classList.remove('current-vote');
            }
          }

          function updateTimer(seconds) {
            const progress = (seconds / 10) * 100;
            document.getElementById('timer-progress').style.width = \`\${progress}%\`;
            document.getElementById('countdown').textContent = seconds;
          }

          async function updateBattleState() {
            const response = await fetch(\`/api/votes?userId=\${encodeURIComponent(userId)}\`);
            const data = await response.json();
            voteCounts = data.votes;
            currentUserVote = data.userVote;
            currentBattle = data.battle;
            updateBattleUI(data);
          }

          async function vote(type) {
            if (!currentBattle) return;
            
            const emoji = type === 'defender' ? currentBattle.defender : currentBattle.challenger;
            const card = document.getElementById(\`\${type}-card\`);
            
            try {
              const response = await fetch(
                \`/api/vote?emoji=\${encodeURIComponent(emoji)}&userId=\${encodeURIComponent(userId)}\`,
                { method: 'POST' }
              );
              
              if (!response.ok) {
                const error = await response.json();
                console.error('Vote failed:', error);
                return;
              }

              const result = await response.json();
              
              // Update local state
              voteCounts = result.votes || voteCounts;
              currentUserVote = result.emoji;
              currentBattle = result.battle;
              
              // Show vote animation
              card.classList.add('voted');
              setTimeout(() => card.classList.remove('voted'), 500);
              
              // Update UI
              updateBattleUI({ 
                votes: voteCounts,
                userVote: currentUserVote,
                battle: currentBattle
              });
            } catch (error) {
              console.error('Vote failed:', error);
            }
          }

          // Initial load and setup WebSocket
          updateBattleState();
          connectWebSocket();
          startTimer();

          // Cleanup timer on page unload
          window.addEventListener('unload', () => {
            if (timerInterval) {
              clearInterval(timerInterval);
            }
          });
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
