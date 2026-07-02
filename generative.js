const btn = document.getElementById('submit-btn');
const retryBtn = document.getElementById('retry-btn');
const statusEl = document.getElementById('status');
const historyEl = document.getElementById('history');

// まとめ機能関連
const summarySubmitBtn = document.getElementById('summary-submit-btn');
const summaryRetryBtn = document.getElementById('summary-retry-btn');
const summaryStatusEl = document.getElementById('summary-status');
const summaryResultEl = document.getElementById('summary-result');
const summaryPromptEl = document.getElementById('summary-prompt');

let lastQuestion = '';
let lastEntryId = '';
let lastCheckedTargets = [];
let lastSummaryTarget = '';
let lastComposedPrompt = '';

// ─── 送信ボタン ───────────────────────────────────────────────
btn.addEventListener('click', async () => {
  const text = document.getElementById('input-area').value.trim();
  if (!text) return;

  // チェックされた送信先を取得
  const checkedTargets = [
    ...document.querySelectorAll('.send-panel .destination-group input[type="checkbox"]:checked')
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

  // 各サービスへ順番に送信（直列処理 - タブのフォーカス競合を防ぐため）
  // ※ 回答待ちは各 AI の送信関数内でバックグラウンドで並行実行されます
  statusEl.textContent = '送信中... 各AIへ順番に入力しています。';
  if (checkedTargets.includes('gemini')) await window.sendToGemini(text, entryId);
  if (checkedTargets.includes('chatgpt')) await window.sendToChatGPT(text, entryId);
  if (checkedTargets.includes('claude')) await window.sendToClaude(text, entryId);
  if (checkedTargets.includes('perplexity')) await window.sendToPerplexity(text, entryId);

  btn.disabled = false;
  retryBtn.disabled = false;
  statusEl.textContent = '全AIへの送信完了。回答を待っています。';
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

window.updateGeminiResponse = function (entryId, answer) {
  updateResponse('gemini', entryId, answer);
  statusEl.className = '';
  statusEl.textContent = 'Gemini の回答を受け取りました。';
};

window.updateChatGPTResponse = function (entryId, answer) {
  updateResponse('chatgpt', entryId, answer);
  statusEl.className = '';
  statusEl.textContent = 'ChatGPT の回答を受け取りました。';
};

window.updateGeminiResponseError = function (entryId, message) {
  updateResponseError('gemini', entryId, message);
  statusEl.className = 'error';
  statusEl.textContent = 'Gemini の回答取得に失敗しました。';
  retryBtn.disabled = false;
};

window.updateChatGPTResponseError = function (entryId, message) {
  updateResponseError('chatgpt', entryId, message);
  statusEl.className = 'error';
  statusEl.textContent = 'ChatGPT の回答取得に失敗しました。';
};

window.updateClaudeResponse = function (entryId, answer) {
  updateResponse('claude', entryId, answer);
  statusEl.className = '';
  statusEl.textContent = 'Claude の回答を受け取りました。';
};

window.updateClaudeResponseError = function (entryId, message) {
  updateResponseError('claude', entryId, message);
  statusEl.className = 'error';
  statusEl.textContent = 'Claude の回答取得に失敗しました。';
};

window.updatePerplexityResponse = function (entryId, answer) {
  updateResponse('perplexity', entryId, answer);
  statusEl.className = '';
  statusEl.textContent = 'Perplexity の回答を受け取りました。';
};

window.updatePerplexityResponseError = function (entryId, message) {
  updateResponseError('perplexity', entryId, message);
  statusEl.className = 'error';
  statusEl.textContent = 'Perplexity の回答取得に失敗しました。';
};

// 再取得完了時（全サービス終了後）のコールバック
window.onRetryComplete = function () {
  btn.disabled = false;
  retryBtn.disabled = false;
};

// 再取得失敗時の汎用エラー表示
window.showFetchError = function (message) {
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

// ─── まとめ機能 ───────────────────────────────────────────────

// まとめ送信ボタン
summarySubmitBtn.addEventListener('click', async () => {
  // まとめ先AIの確認（1つだけ選択を想定）
  const checkedSummaryTargets = [
    ...document.querySelectorAll('.summary-destination-group input[type="checkbox"]:checked')
  ].map(el => el.value);

  if (checkedSummaryTargets.length === 0) {
    summaryStatusEl.className = 'error';
    summaryStatusEl.textContent = 'まとめ先のAIを1つ以上選択してください。';
    return;
  }

  // 各AIの最新回答テキストを収集（最新エントリから取得）
  const latestEntry = historyEl.querySelector('.entry');
  if (!latestEntry) {
    summaryStatusEl.className = 'error';
    summaryStatusEl.textContent = 'まず送信先AIへ質問を送信してください。';
    return;
  }

  const SERVICE_LABEL_MAP = { gemini: 'Gemini', chatgpt: 'ChatGPT', claude: 'Claude', perplexity: 'Perplexity' };
  const answerParts = [];
  for (const [key, label] of Object.entries(SERVICE_LABEL_MAP)) {
    const body = latestEntry.querySelector(`.response-card.${key} .response-body`);
    if (!body) continue;
    if (body.classList.contains('loading') || body.classList.contains('error-text')) continue;
    const text = body.innerText?.trim();
    if (text) answerParts.push(`【${label}の回答】\n${text}`);
  }

  if (answerParts.length === 0) {
    summaryStatusEl.className = 'error';
    summaryStatusEl.textContent = '回答が1件も取得できていません。回答が揃ってから実行してください。';
    return;
  }

  // プロンプト合成
  const instruction = summaryPromptEl.value.trim() ||
    '各種生成AIの回答をまとめてください。';
  const composed = `${instruction}\n\n---\n${answerParts.join('\n\n')}\n---`;
  lastComposedPrompt = composed;
  lastSummaryTarget = checkedSummaryTargets[0]; // 1つ目のまとめ先を使用

  // まとめ結果エリアを「取得中」表示に
  summaryResultEl.style.display = 'block';
  summaryResultEl.innerHTML = `
    <div class="summary-result-header">${SERVICE_LABEL_MAP[lastSummaryTarget] ?? lastSummaryTarget} によるまとめ</div>
    <div class="summary-result-body loading">まとめを取得中...</div>`;

  summarySubmitBtn.disabled = true;
  summaryRetryBtn.disabled = true;
  summaryStatusEl.className = '';
  summaryStatusEl.textContent = 'まとめを送信中...';

  // バックエンドへ送信
  await window.sendSummary(composed, lastSummaryTarget);

  summaryStatusEl.textContent = 'まとめの送信完了。回答を待っています。';
});

// まとめ再取得ボタン
summaryRetryBtn.addEventListener('click', async () => {
  if (!lastComposedPrompt || !lastSummaryTarget) return;

  summarySubmitBtn.disabled = true;
  summaryRetryBtn.disabled = true;
  summaryStatusEl.className = '';
  summaryStatusEl.textContent = 'まとめを再取得中...';

  const SERVICE_LABEL_MAP = { gemini: 'Gemini', chatgpt: 'ChatGPT', claude: 'Claude', perplexity: 'Perplexity' };
  summaryResultEl.style.display = 'block';
  summaryResultEl.innerHTML = `
    <div class="summary-result-header">${SERVICE_LABEL_MAP[lastSummaryTarget] ?? lastSummaryTarget} によるまとめ</div>
    <div class="summary-result-body loading">まとめを再取得中...</div>`;

  await window.sendSummary(lastComposedPrompt, lastSummaryTarget);
});

// ─── まとめ結果受信コールバック（バックエンドから呼ばれる）────

window.updateSummaryResponse = function (answer) {
  const SERVICE_LABEL_MAP = { gemini: 'Gemini', chatgpt: 'ChatGPT', claude: 'Claude', perplexity: 'Perplexity' };
  summaryResultEl.style.display = 'block';
  summaryResultEl.innerHTML = `
    <div class="summary-result-header">${SERVICE_LABEL_MAP[lastSummaryTarget] ?? lastSummaryTarget} によるまとめ</div>
    <div class="summary-result-body">${answer}</div>`;
  summaryStatusEl.className = '';
  summaryStatusEl.textContent = 'まとめを受け取りました。';
  summarySubmitBtn.disabled = false;
  summaryRetryBtn.disabled = false;
};

window.updateSummaryResponseError = function (message) {
  const SERVICE_LABEL_MAP = { gemini: 'Gemini', chatgpt: 'ChatGPT', claude: 'Claude', perplexity: 'Perplexity' };
  summaryResultEl.style.display = 'block';
  summaryResultEl.innerHTML = `
    <div class="summary-result-header">${SERVICE_LABEL_MAP[lastSummaryTarget] ?? lastSummaryTarget} によるまとめ</div>
    <div class="summary-result-body error-text">エラー: ${message}</div>`;
  summaryStatusEl.className = 'error';
  summaryStatusEl.textContent = 'まとめの取得に失敗しました。';
  summarySubmitBtn.disabled = false;
  summaryRetryBtn.disabled = false;
};
