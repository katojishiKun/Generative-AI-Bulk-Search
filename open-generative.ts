import { launchChrome } from './launch-chrome.ts';
import * as path from 'path';
import * as url from 'url';
import type { Page, Locator } from 'playwright';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const PAGE_PATH = `file:///${path.join(__dirname, 'generative.html').replace(/\\/g, '/')}`;
const GEMINI_URL      = 'https://gemini.google.com/u/0/app';
const CHATGPT_URL     = 'https://chatgpt.com/';
const CLAUDE_URL      = 'https://claude.ai/new';
const PERPLEXITY_URL  = 'https://www.perplexity.ai/';

const RESPONSE_TIMEOUT_MS = 90_000;

// ─────────────────────────────────────────────────────────────────
// テキスト入力ヘルパー
// keyboard.type() は長文で文字落ちが起きるため、以下の優先順位で入力する:
//   1. locator.fill()          … <textarea> / <input> で確実・高速
//   2. execCommand('insertText') … contenteditable 系（Gemini・Claude 等）で実績あり
//   3. Clipboard + Ctrl+V      … 上記が両方失敗した場合のフォールバック
// ─────────────────────────────────────────────────────────────────
async function pasteText(page: Page, locator: Locator, text: string): Promise<void> {
  await locator.click();
  await page.keyboard.press('Control+a');

  // 1. fill() を試みる（<textarea> / <input> はこれで完結）
  try {
    await locator.fill(text);
    // fill() 後に入力欄が空のままなら失敗とみなす
    const filled = await locator.evaluate((el: Element) => {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        return el.value.length > 0;
      }
      return (el as HTMLElement).innerText.trim().length > 0;
    });
    if (filled) return;
  } catch {
    // contenteditable 等では fill() が例外を投げることがある
  }

  // 2. execCommand('insertText') — contenteditable で動作し React/Vue のイベントも発火
  const inserted: boolean = await page.evaluate((t: string) => {
    try {
      return document.execCommand('insertText', false, t);
    } catch {
      return false;
    }
  }, text);
  if (inserted) return;

  // 3. クリップボード経由フォールバック
  await page.evaluate(async (t: string) => {
    await navigator.clipboard.writeText(t);
  }, text);
  await page.keyboard.press('Control+v');
}

const { context, chromeProcess } = await launchChrome();

// タブ1: generative.html（入力フォーム）
const inputPage = await context.newPage();
await inputPage.goto(PAGE_PATH);
console.log('入力フォームを開きました。');

// タブ2: Gemini
const geminiPage = await context.newPage();
await geminiPage.goto(GEMINI_URL, { waitUntil: 'domcontentloaded' });
console.log('Gemini を開きました。');

// タブ3: ChatGPT
const chatgptPage = await context.newPage();
await chatgptPage.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded' });
console.log('ChatGPT を開きました。');

// タブ4: Claude
const claudePage = await context.newPage();
await claudePage.goto(CLAUDE_URL, { waitUntil: 'domcontentloaded' });
console.log('Claude を開きました。');

// タブ5: Perplexity
const perplexityPage = await context.newPage();
await perplexityPage.goto(PERPLEXITY_URL, { waitUntil: 'domcontentloaded' });
console.log('Perplexity を開きました。');

// 入力フォームタブをデフォルトで前面に
await inputPage.bringToFront();

// 最後に送信したときの情報（再取得で使う）
let lastPreviousGeminiCount = 0;
let lastPreviousChatGPTCount = 0;
let lastPreviousClaudeCount = 0;
let lastPreviousPerplexityCount = 0;
let lastEntryId = '';

// ─────────────────────────────────────────────────────────────────
// Gemini 回答待機（安定判定は textContent、返却は innerHTML）
// ─────────────────────────────────────────────────────────────────
async function waitForGeminiResponse(
  previousCount: number,
  timeoutMs = RESPONSE_TIMEOUT_MS
): Promise<string> {
  const pollInterval = 1500;
  const stableThreshold = 3;
  const start = Date.now();
  let lastText = '';
  let stableCount = 0;

  // 新しい model-response 要素が追加されるまで待機
  while (Date.now() - start < timeoutMs) {
    const count: number = await geminiPage.evaluate(
      () => document.querySelectorAll('model-response').length
    );
    if (count > previousCount) break;
    await new Promise(r => setTimeout(r, 500));
  }

  while (Date.now() - start < timeoutMs) {
    const currentText: string = await geminiPage.evaluate((prev) => {
      const responses = document.querySelectorAll('model-response');
      const newResponses = Array.from(responses).slice(prev);
      if (newResponses.length === 0) return '';
      const last = newResponses[newResponses.length - 1];
      return last?.querySelector('message-content')?.textContent?.trim() ?? '';
    }, previousCount);

    if (currentText.length > 0 && currentText === lastText) {
      stableCount++;
      if (stableCount >= stableThreshold) {
        // 安定したら innerHTML を返す
        const html: string = await geminiPage.evaluate((prev) => {
          const responses = document.querySelectorAll('model-response');
          const newResponses = Array.from(responses).slice(prev);
          if (newResponses.length === 0) return '';
          const last = newResponses[newResponses.length - 1];
          return last?.querySelector('message-content')?.innerHTML ?? '';
        }, previousCount);
        return html;
      }
    } else {
      stableCount = 0;
      lastText = currentText;
    }
    await new Promise(r => setTimeout(r, pollInterval));
  }
  throw new Error(`Gemini の応答がタイムアウトしました（${timeoutMs / 1000}秒）。`);
}

// ─────────────────────────────────────────────────────────────────
// ChatGPT 回答待機（安定判定は textContent、返却は innerHTML）
// ─────────────────────────────────────────────────────────────────
const CHATGPT_RESPONSE_SEL = '[data-message-author-role="assistant"]';

async function waitForChatGPTResponse(
  previousCount: number,
  timeoutMs = RESPONSE_TIMEOUT_MS
): Promise<string> {
  const pollInterval = 1500;
  const stableThreshold = 3;
  const start = Date.now();
  let lastText = '';
  let stableCount = 0;

  // 新しい assistant メッセージが追加されるまで待機
  while (Date.now() - start < timeoutMs) {
    const count: number = await chatgptPage.evaluate(
      (sel) => document.querySelectorAll(sel).length,
      CHATGPT_RESPONSE_SEL
    );
    if (count > previousCount) break;
    await new Promise(r => setTimeout(r, 500));
  }

  while (Date.now() - start < timeoutMs) {
    const currentText: string = await chatgptPage.evaluate(({ sel, prev }) => {
      const responses = document.querySelectorAll(sel);
      const newResponses = Array.from(responses).slice(prev);
      if (newResponses.length === 0) return '';
      const last = newResponses[newResponses.length - 1];
      return last?.textContent?.trim() ?? '';
    }, { sel: CHATGPT_RESPONSE_SEL, prev: previousCount });

    if (currentText.length > 0 && currentText === lastText) {
      stableCount++;
      if (stableCount >= stableThreshold) {
        // 安定したら innerHTML を返す（.markdown 要素があればそれを優先）
        const html: string = await chatgptPage.evaluate(({ sel, prev }) => {
          const responses = document.querySelectorAll(sel);
          const newResponses = Array.from(responses).slice(prev);
          if (newResponses.length === 0) return '';
          const last = newResponses[newResponses.length - 1];
          const markdown = last?.querySelector('.markdown, .prose');
          return (markdown ?? last)?.innerHTML ?? '';
        }, { sel: CHATGPT_RESPONSE_SEL, prev: previousCount });
        return html;
      }
    } else {
      stableCount = 0;
      lastText = currentText;
    }
    await new Promise(r => setTimeout(r, pollInterval));
  }
  throw new Error(`ChatGPT の応答がタイムアウトしました（${timeoutMs / 1000}秒）。`);
}

// ─────────────────────────────────────────────────────────────────
// 送信 → Gemini
// ─────────────────────────────────────────────────────────────────
await inputPage.exposeFunction('sendToGemini', async (text: string, entryId: string) => {
  console.log(`Gemini へ送信: ${text} (entryId: ${entryId})`);
  lastEntryId = entryId;

  await geminiPage.bringToFront();

  const inputSelector = 'rich-textarea div[contenteditable="true"], rich-textarea div.ql-editor';
  await geminiPage.waitForSelector(inputSelector, { timeout: 15000 });
  const inputEl = geminiPage.locator(inputSelector).first();

  lastPreviousGeminiCount = await geminiPage.evaluate(
    () => document.querySelectorAll('model-response').length
  );

  await pasteText(geminiPage, inputEl, text);

  const sendBtn = geminiPage.locator('div.send-button-container button').first();
  await sendBtn.click();
  console.log(`Gemini 送信完了 (送信前応答数: ${lastPreviousGeminiCount})`);

  // 新しい model-response が出るまで待機
  const sendTimeout = Date.now() + 15000;
  while (Date.now() < sendTimeout) {
    const count: number = await geminiPage.evaluate(
      () => document.querySelectorAll('model-response').length
    );
    if (count > lastPreviousGeminiCount) break;
    await new Promise(r => setTimeout(r, 300));
  }

  await inputPage.bringToFront();

  try {
    const answer = await waitForGeminiResponse(lastPreviousGeminiCount);
    console.log(`Gemini 回答取得完了 (${answer.length} 文字)`);
    await inputPage.evaluate(
      ({ id, a }) => { (window as any).updateGeminiResponse(id, a); },
      { id: entryId, a: answer }
    );
  } catch (err: any) {
    console.error(`Gemini 回答取得失敗: ${err.message}`);
    await inputPage.evaluate(
      ({ id, msg }) => { (window as any).updateGeminiResponseError(id, msg); },
      { id: entryId, msg: err.message }
    );
  }
});

// ─────────────────────────────────────────────────────────────────
// 送信 → ChatGPT
// ─────────────────────────────────────────────────────────────────
await inputPage.exposeFunction('sendToChatGPT', async (text: string, entryId: string) => {
  console.log(`ChatGPT へ送信: ${text} (entryId: ${entryId})`);

  await chatgptPage.bringToFront();

  const inputSelector = '#prompt-textarea';
  try {
    await chatgptPage.waitForSelector(inputSelector, { timeout: 15000 });
  } catch {
    await inputPage.evaluate(
      ({ id, msg }) => { (window as any).updateChatGPTResponseError(id, msg); },
      { id: entryId, msg: 'ChatGPT の入力欄が見つかりません。ログインしているか確認してください。' }
    );
    return;
  }

  // 送信前の assistant メッセージ数を記録
  const previousCount: number = await chatgptPage.evaluate(
    (sel) => document.querySelectorAll(sel).length,
    CHATGPT_RESPONSE_SEL
  );
  lastPreviousChatGPTCount = previousCount;

  const inputEl = chatgptPage.locator(inputSelector).first();
  await pasteText(chatgptPage, inputEl, text);

  // 送信ボタンをクリック
  const sendBtn = chatgptPage.locator('button[data-testid="send-button"]').first();
  await sendBtn.click();
  console.log(`ChatGPT 送信完了 (送信前応答数: ${previousCount})`);

  await inputPage.bringToFront();

  try {
    const answer = await waitForChatGPTResponse(previousCount);
    console.log(`ChatGPT 回答取得完了 (${answer.length} 文字)`);
    await inputPage.evaluate(
      ({ id, a }) => { (window as any).updateChatGPTResponse(id, a); },
      { id: entryId, a: answer }
    );
  } catch (err: any) {
    console.error(`ChatGPT 回答取得失敗: ${err.message}`);
    await inputPage.evaluate(
      ({ id, msg }) => { (window as any).updateChatGPTResponseError(id, msg); },
      { id: entryId, msg: err.message }
    );
  }
});

// ─────────────────────────────────────────────────────────────────
// Claude セレクタ定数
// ─────────────────────────────────────────────────────────────────
// data-is-streaming 属性を持つコンテナ単位でカウント・完了判定する
const CLAUDE_RESPONSE_SEL = '[data-is-streaming]';
const CLAUDE_INPUT_SEL    = '[data-testid="chat-input"], .tiptap.ProseMirror, [role="textbox"]';
const CLAUDE_SEND_BTN_SEL = 'button[aria-label*="Send"], button[aria-label*="送信"], button[aria-label*="メッセージを送信"]';

// ─────────────────────────────────────────────────────────────────
// Claude 回答待機（data-is-streaming 属性で完了を検出）
// ─────────────────────────────────────────────────────────────────
async function waitForClaudeResponse(
  previousCount: number,
  timeoutMs = RESPONSE_TIMEOUT_MS
): Promise<string> {
  const start = Date.now();

  // 新しい data-is-streaming コンテナが追加されるまで待機
  while (Date.now() - start < timeoutMs) {
    const count: number = await claudePage.evaluate(
      (sel) => document.querySelectorAll(sel).length,
      CLAUDE_RESPONSE_SEL
    );
    if (count > previousCount) break;
    await new Promise(r => setTimeout(r, 500));
  }

  // data-is-streaming="true" の要素がなくなるまで待機（生成完了）
  const deadline = start + timeoutMs;
  while (Date.now() < deadline) {
    const isStreaming: boolean = await claudePage.evaluate(() => {
      return document.querySelector('[data-is-streaming="true"]') !== null;
    });
    if (!isStreaming) break;
    await new Promise(r => setTimeout(r, 800));
  }

  if (Date.now() >= deadline) {
    throw new Error(`Claude の応答がタイムアウトしました（${timeoutMs / 1000}秒）。`);
  }

  // 最後の回答コンテナから innerHTML を取得
  // .font-claude-response があればそれを優先、なければコンテナ全体
  const html: string = await claudePage.evaluate((prev) => {
    const containers = document.querySelectorAll('[data-is-streaming]');
    const newContainers = Array.from(containers).slice(prev);
    if (newContainers.length === 0) return '';
    const last = newContainers[newContainers.length - 1] as HTMLElement;
    const content = last.querySelector('.font-claude-response') ?? last;
    return (content as HTMLElement).innerHTML ?? '';
  }, previousCount);

  if (!html) {
    throw new Error('Claude の回答が空でした。');
  }
  return html;
}

// ─────────────────────────────────────────────────────────────────
// 送信 → Claude
// ─────────────────────────────────────────────────────────────────
await inputPage.exposeFunction('sendToClaude', async (text: string, entryId: string) => {
  console.log(`Claude へ送信: ${text} (entryId: ${entryId})`);

  await claudePage.bringToFront();

  try {
    await claudePage.waitForSelector(CLAUDE_INPUT_SEL, { timeout: 15000 });
  } catch {
    await inputPage.evaluate(
      ({ id, msg }) => { (window as any).updateClaudeResponseError(id, msg); },
      { id: entryId, msg: 'Claude の入力欄が見つかりません。ログインしているか確認してください。' }
    );
    return;
  }

  const previousCount: number = await claudePage.evaluate(
    (sel) => document.querySelectorAll(sel).length,
    CLAUDE_RESPONSE_SEL
  );
  lastPreviousClaudeCount = previousCount;

  const inputEl = claudePage.locator(CLAUDE_INPUT_SEL).first();
  await pasteText(claudePage, inputEl, text);

  const sendBtn = claudePage.locator(CLAUDE_SEND_BTN_SEL).first();
  await sendBtn.click();
  console.log(`Claude 送信完了 (送信前応答数: ${previousCount})`);

  await inputPage.bringToFront();

  try {
    const answer = await waitForClaudeResponse(previousCount);
    console.log(`Claude 回答取得完了 (${answer.length} 文字)`);
    await inputPage.evaluate(
      ({ id, a }) => { (window as any).updateClaudeResponse(id, a); },
      { id: entryId, a: answer }
    );
  } catch (err: any) {
    console.error(`Claude 回答取得失敗: ${err.message}`);
    await inputPage.evaluate(
      ({ id, msg }) => { (window as any).updateClaudeResponseError(id, msg); },
      { id: entryId, msg: err.message }
    );
  }
});

// ─────────────────────────────────────────────────────────────────
// Perplexity セレクタ定数
// ─────────────────────────────────────────────────────────────────
const PERPLEXITY_RESPONSE_SEL = '.prose';
const PERPLEXITY_INPUT_SEL    = 'textarea[placeholder], div[contenteditable="true"]';

// ─────────────────────────────────────────────────────────────────
// Perplexity 回答待機（安定判定は textContent、返却は innerHTML）
// ─────────────────────────────────────────────────────────────────
async function waitForPerplexityResponse(
  previousCount: number,
  timeoutMs = RESPONSE_TIMEOUT_MS
): Promise<string> {
  const pollInterval = 1500;
  const stableThreshold = 3;
  const start = Date.now();
  let lastText = '';
  let stableCount = 0;

  // 新しい .prose 要素が追加されるまで待機
  while (Date.now() - start < timeoutMs) {
    const count: number = await perplexityPage.evaluate(
      (sel) => document.querySelectorAll(sel).length,
      PERPLEXITY_RESPONSE_SEL
    );
    if (count > previousCount) break;
    await new Promise(r => setTimeout(r, 500));
  }

  while (Date.now() - start < timeoutMs) {
    const currentText: string = await perplexityPage.evaluate(({ sel, prev }) => {
      const responses = document.querySelectorAll(sel);
      const newResponses = Array.from(responses).slice(prev);
      if (newResponses.length === 0) return '';
      const last = newResponses[newResponses.length - 1];
      return last?.textContent?.trim() ?? '';
    }, { sel: PERPLEXITY_RESPONSE_SEL, prev: previousCount });

    if (currentText.length > 0 && currentText === lastText) {
      stableCount++;
      if (stableCount >= stableThreshold) {
        const html: string = await perplexityPage.evaluate(({ sel, prev }) => {
          const responses = document.querySelectorAll(sel);
          const newResponses = Array.from(responses).slice(prev);
          if (newResponses.length === 0) return '';
          const last = newResponses[newResponses.length - 1];
          return last?.innerHTML ?? '';
        }, { sel: PERPLEXITY_RESPONSE_SEL, prev: previousCount });
        return html;
      }
    } else {
      stableCount = 0;
      lastText = currentText;
    }
    await new Promise(r => setTimeout(r, pollInterval));
  }
  throw new Error(`Perplexity の応答がタイムアウトしました（${timeoutMs / 1000}秒）。`);
}

// ─────────────────────────────────────────────────────────────────
// 送信 → Perplexity
// ─────────────────────────────────────────────────────────────────
await inputPage.exposeFunction('sendToPerplexity', async (text: string, entryId: string) => {
  console.log(`Perplexity へ送信: ${text} (entryId: ${entryId})`);

  await perplexityPage.bringToFront();

  // 新規チャット画面に遷移（毎回クリーンな状態で送信）
  await perplexityPage.goto(PERPLEXITY_URL, { waitUntil: 'domcontentloaded' });

  try {
    await perplexityPage.waitForSelector(PERPLEXITY_INPUT_SEL, { timeout: 15000 });
  } catch {
    await inputPage.evaluate(
      ({ id, msg }) => { (window as any).updatePerplexityResponseError(id, msg); },
      { id: entryId, msg: 'Perplexity の入力欄が見つかりません。ログインしているか確認してください。' }
    );
    return;
  }

  const previousCount: number = await perplexityPage.evaluate(
    (sel) => document.querySelectorAll(sel).length,
    PERPLEXITY_RESPONSE_SEL
  );
  lastPreviousPerplexityCount = previousCount;

  const inputEl = perplexityPage.locator(PERPLEXITY_INPUT_SEL).first();
  await pasteText(perplexityPage, inputEl, text);
  await perplexityPage.keyboard.press('Enter');
  console.log(`Perplexity 送信完了 (送信前応答数: ${previousCount})`);

  await inputPage.bringToFront();

  try {
    const answer = await waitForPerplexityResponse(previousCount);
    console.log(`Perplexity 回答取得完了 (${answer.length} 文字)`);
    await inputPage.evaluate(
      ({ id, a }) => { (window as any).updatePerplexityResponse(id, a); },
      { id: entryId, a: answer }
    );
  } catch (err: any) {
    console.error(`Perplexity 回答取得失敗: ${err.message}`);
    await inputPage.evaluate(
      ({ id, msg }) => { (window as any).updatePerplexityResponseError(id, msg); },
      { id: entryId, msg: err.message }
    );
  }
});

// ─────────────────────────────────────────────────────────────────
// 再取得（全サービス対応）
// ─────────────────────────────────────────────────────────────────
await inputPage.exposeFunction('retryGetResponse', async (_question: string, targets: string[]) => {
  console.log(`再取得を実行 (entryId: ${lastEntryId}, targets: ${targets.join(', ')})`);

  const retries: Promise<void>[] = [];

  if (targets.includes('gemini')) {
    retries.push((async () => {
      try {
        const html = await waitForGeminiResponse(lastPreviousGeminiCount, 30_000);
        console.log(`Gemini 再取得成功 (${html.length} 文字)`);
        await inputPage.evaluate(
          ({ id, a }) => { (window as any).updateGeminiResponse(id, a); },
          { id: lastEntryId, a: html }
        );
      } catch (err: any) {
        console.error(`Gemini 再取得失敗: ${err.message}`);
        await inputPage.evaluate(
          ({ id, msg }) => { (window as any).updateGeminiResponseError(id, msg); },
          { id: lastEntryId, msg: err.message }
        );
      }
    })());
  }

  if (targets.includes('chatgpt')) {
    retries.push((async () => {
      try {
        const html = await waitForChatGPTResponse(lastPreviousChatGPTCount, 30_000);
        console.log(`ChatGPT 再取得成功 (${html.length} 文字)`);
        await inputPage.evaluate(
          ({ id, a }) => { (window as any).updateChatGPTResponse(id, a); },
          { id: lastEntryId, a: html }
        );
      } catch (err: any) {
        console.error(`ChatGPT 再取得失敗: ${err.message}`);
        await inputPage.evaluate(
          ({ id, msg }) => { (window as any).updateChatGPTResponseError(id, msg); },
          { id: lastEntryId, msg: err.message }
        );
      }
    })());
  }

  if (targets.includes('claude')) {
    retries.push((async () => {
      try {
        const html = await waitForClaudeResponse(lastPreviousClaudeCount, 30_000);
        console.log(`Claude 再取得成功 (${html.length} 文字)`);
        await inputPage.evaluate(
          ({ id, a }) => { (window as any).updateClaudeResponse(id, a); },
          { id: lastEntryId, a: html }
        );
      } catch (err: any) {
        console.error(`Claude 再取得失敗: ${err.message}`);
        await inputPage.evaluate(
          ({ id, msg }) => { (window as any).updateClaudeResponseError(id, msg); },
          { id: lastEntryId, msg: err.message }
        );
      }
    })());
  }

  if (targets.includes('perplexity')) {
    retries.push((async () => {
      try {
        const html = await waitForPerplexityResponse(lastPreviousPerplexityCount, 30_000);
        console.log(`Perplexity 再取得成功 (${html.length} 文字)`);
        await inputPage.evaluate(
          ({ id, a }) => { (window as any).updatePerplexityResponse(id, a); },
          { id: lastEntryId, a: html }
        );
      } catch (err: any) {
        console.error(`Perplexity 再取得失敗: ${err.message}`);
        await inputPage.evaluate(
          ({ id, msg }) => { (window as any).updatePerplexityResponseError(id, msg); },
          { id: lastEntryId, msg: err.message }
        );
      }
    })());
  }

  await Promise.allSettled(retries);

  // 全サービスの再取得完了をフロントエンドに通知
  await inputPage.evaluate(() => { (window as any).onRetryComplete(); });
});

console.log('準備完了。generative.html の送信ボタンを押してください。');

// ブラウザが閉じられるまで待機
// ※ chromeProcess は既存セッション再利用時に null の場合があるため ?. で安全に呼び出す
await new Promise<void>((resolve) => {
  const browser = context.browser();
  if (browser) {
    browser.on('disconnected', () => {
      console.log('ブラウザが閉じられました。');
      chromeProcess?.kill();
      resolve();
    });
  } else {
    context.on('close', () => {
      console.log('ブラウザが閉じられました。');
      chromeProcess?.kill();
      resolve();
    });
  }
});
