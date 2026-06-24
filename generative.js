const btn = document.getElementById('submit-btn');
const retryBtn = document.getElementById('retry-btn');
const statusEl = document.getElementById('status');
const historyEl = document.getElementById('history');

let lastQuestion = '';
let lastEntryId = '';
let lastCheckedTargets = [];

// ─── 送信ボタン ───────────────────────────────────────────────
btn.addEventListener('click', async () => {
  const text = document.getElementById('input-area').value.trim();
  if (!text) return;

  // チェックされた送信先を取得
  const checkedTargets = [
    ...document.querySelectorAll('.destination-group input[type="checkbox"]:checked')
  ].map(el => el.value);

  if (checkedTargets.length === 0) {
    statusEl.className = 'error';
    statusEl.textContent = '送信先を1つ以上選択してください。';
    return;
  }

  lastQuestion = text;
  lastCheckedTargets = checkedTargets;
  btn.disabled = true;
  retryBtn.disabled = true;
  statusEl.className = '';
  statusEl.textContent = '送信中... 回答を待っています。';

  // エントリーを作成してプレースホルダーカードを表示
  const entryId = Date.now().toString();
  lastEntryId = entryId;
  document.getElementById('input-area').value = '';
  createEntry(entryId, text, checkedTargets);

  // 各サービスへ並行送信
  const promises = [];
  if (checkedTargets.includes('gemini'))     promises.push(window.sendToGemini(text, entryId));
  if (checkedTargets.includes('chatgpt'))    promises.push(window.sendToChatGPT(text, entryId));
  if (checkedTargets.includes('claude'))     promises.push(window.sendToClaude(text, entryId));
  if (checkedTargets.includes('perplexity')) promises.push(window.sendToPerplexity(text, entryId));

  await Promise.allSettled(promises);
  btn.disabled = false;
});

// ─── 再取得ボタン ─────────────────────────────────────────────
retryBtn.addEventListener('click', async () => {
  if (!lastQuestion) return;

  retryBtn.disabled = true;
  btn.disabled = true;
  statusEl.className = '';
  statusEl.textContent = '再取得中...';

  try {
    await window.retryGetResponse(lastQuestion, lastCheckedTargets);
  } catch (e) {
    statusEl.className = 'error';
    statusEl.textContent = '再取得エラー: ' + e.message;
    retryBtn.disabled = false;
    btn.disabled = false;
  }
});

// ─── エントリー作成（プレースホルダーカード付き）────────────────
const SERVICE_LABELS = { gemini: 'Gemini', chatgpt: 'ChatGPT', claude: 'Claude', perplexity: 'Perplexity' };

function createEntry(entryId, question, targets) {
  const entry = document.createElement('div');
  entry.className = 'entry';
  entry.dataset.entryId = entryId;

  const labelEl = document.createElement('div');
  labelEl.className = 'label';
  labelEl.textContent = '質問';

  const questionEl = document.createElement('div');
  questionEl.className = 'question';
  questionEl.textContent = question;

  const responsesEl = document.createElement('div');
  responsesEl.className = 'responses';

  for (const target of targets) {
    const card = document.createElement('div');
    card.className = `response-card ${target}`;

    const header = document.createElement('div');
    header.className = 'response-header';
    header.textContent = SERVICE_LABELS[target] ?? target;

    const body = document.createElement('div');
    body.className = 'response-body loading';
    body.textContent = '回答を取得中...';

    card.appendChild(header);
    card.appendChild(body);
    responsesEl.appendChild(card);
  }

  entry.appendChild(labelEl);
  entry.appendChild(questionEl);
  entry.appendChild(responsesEl);
  historyEl.prepend(entry);
}

// ─── Node.js からの回答更新コールバック ──────────────────────────

window.updateGeminiResponse = function(entryId, answer) {
  updateResponse('gemini', entryId, answer);
  statusEl.className = '';
  statusEl.textContent = 'Gemini の回答を受け取りました。';
};

window.updateChatGPTResponse = function(entryId, answer) {
  updateResponse('chatgpt', entryId, answer);
  statusEl.className = '';
  statusEl.textContent = 'ChatGPT の回答を受け取りました。';
};

window.updateGeminiResponseError = function(entryId, message) {
  updateResponseError('gemini', entryId, message);
  statusEl.className = 'error';
  statusEl.textContent = 'Gemini の回答取得に失敗しました。';
  retryBtn.disabled = false;
};

window.updateChatGPTResponseError = function(entryId, message) {
  updateResponseError('chatgpt', entryId, message);
  statusEl.className = 'error';
  statusEl.textContent = 'ChatGPT の回答取得に失敗しました。';
};

window.updateClaudeResponse = function(entryId, answer) {
  updateResponse('claude', entryId, answer);
  statusEl.className = '';
  statusEl.textContent = 'Claude の回答を受け取りました。';
};

window.updateClaudeResponseError = function(entryId, message) {
  updateResponseError('claude', entryId, message);
  statusEl.className = 'error';
  statusEl.textContent = 'Claude の回答取得に失敗しました。';
};

window.updatePerplexityResponse = function(entryId, answer) {
  updateResponse('perplexity', entryId, answer);
  statusEl.className = '';
  statusEl.textContent = 'Perplexity の回答を受け取りました。';
};

window.updatePerplexityResponseError = function(entryId, message) {
  updateResponseError('perplexity', entryId, message);
  statusEl.className = 'error';
  statusEl.textContent = 'Perplexity の回答取得に失敗しました。';
};

// 再取得完了時（全サービス終了後）のコールバック
window.onRetryComplete = function() {
  btn.disabled = false;
  retryBtn.disabled = true;
};

// 再取得失敗時の汎用エラー表示
window.showFetchError = function(message) {
  statusEl.className = 'error';
  statusEl.textContent = message;
  btn.disabled = false;
  retryBtn.disabled = false;
};

// ─── ヘルパー ────────────────────────────────────────────────

function updateResponse(service, entryId, answer) {
  const entry = document.querySelector(`.entry[data-entry-id="${entryId}"]`);
  if (!entry) return;
  const body = entry.querySelector(`.response-card.${service} .response-body`);
  if (!body) return;
  body.classList.remove('loading');
  body.innerHTML = answer;
}

function updateResponseError(service, entryId, message) {
  const entry = document.querySelector(`.entry[data-entry-id="${entryId}"]`);
  if (!entry) return;
  const body = entry.querySelector(`.response-card.${service} .response-body`);
  if (!body) return;
  body.classList.remove('loading');
  body.classList.add('error-text');
  body.textContent = 'エラー: ' + message;
}
