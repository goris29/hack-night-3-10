import { html } from 'hono/html';
import { EMOJI_CANDIDATES } from './constants';

const style = `
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
`;

const script = `
  let voteCounts = {};

  async function updateVoteCounts() {
    const response = await fetch('/api/votes');
    voteCounts = await response.json();
    
    EMOJI_CANDIDATES.forEach(({ emoji }) => {
      const countElement = document.getElementById(\`count-\${encodeURIComponent(emoji)}\`);
      if (countElement) {
        countElement.textContent = voteCounts[emoji] || 0;
      }
    });
  }

  async function vote(emoji) {
    const card = document.getElementById(\`card-\${encodeURIComponent(emoji)}\`);
    card.classList.add('voted');
    setTimeout(() => card.classList.remove('voted'), 500);

    const response = await fetch(\`/api/vote?emoji=\${encodeURIComponent(emoji)}\`, { method: 'POST' });
    const result = await response.json();
    
    await updateVoteCounts();
  }

  // Update vote counts every 5 seconds
  updateVoteCounts();
  setInterval(updateVoteCounts, 5000);
`;

export function renderTemplate() {
  return html`
    <!doctype html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Global Emoji Battle 🌎</title>
        <style>${style}</style>
      </head>
      <body>
        <h1>Global Emoji Battle 🌎</h1>
        <p class="subtitle">Vote for your favorite emoji! Votes are counted in real-time across the globe!</p>
        <div class="emoji-grid">
          ${EMOJI_CANDIDATES.map(({ emoji, name }) => {
            const escapedEmoji = encodeURIComponent(emoji);
            return html`
              <div class="emoji-card" id="card-${escapedEmoji}">
                <div class="emoji">${emoji}</div>
                <div class="name">${name}</div>
                <div class="votes">Votes: <span id="count-${escapedEmoji}">0</span></div>
                <button class="vote-btn" onclick="vote('${escapedEmoji}')">Vote!</button>
              </div>
            `;
          })}
        </div>
        <script>
          const EMOJI_CANDIDATES = ${JSON.stringify(EMOJI_CANDIDATES)};
          ${script}
        </script>
      </body>
    </html>
  `;
}
