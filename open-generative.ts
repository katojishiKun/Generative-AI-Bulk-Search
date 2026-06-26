import { launchChrome } from './launch-chrome.ts';
import { type Page } from 'playwright';
import * as path from 'path';
import * as url from 'url';
import { SELECTORS } from './selectors.ts';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const PAGE_PATH = `file:///${path.join(__dirname, 'generative.html').replace(/\\/g, '/')}`;
const GEMINI_URL      = 'https://gemini.google.com/u/0/app';
const CHATGPT_URL     = 'https://chatgpt.com/';
const CLAUDE_URL      = 'https://claude.ai/new';
const PERPLEXITY_URL  = 'https://www.perplexity.ai/';

const RESPONSE_TIMEOUT_MS = 90_000;

const MAX_TYPE_RETRIES = 3;
const RETRY_DELAY_MS   = 1500;

// ─────────────────────────────────────────────────────────────────
// 入力チェック＆リトライ付きタイピング
// ・keyboard.type() でテキストを入力した後、入力欄の実際の値と比較し、
//   一致しなければ入力欄をクリアして再入力する（最大 MAX_TYPE_RETRIES 回）。
// ・低スペック PC でタブ切り替えなどによる入力漏れを未然に防ぐ。
// ─────────────────────────────────────────────────────────────────
async function typeWithRetry(
  page: Page,
  inputSelector: string,
  text: string,
  getActualText: () => Promise<string>
): Promise<void> {
  const expectedLen = text.trim().length;

  for (let attempt = 1; attempt <= MAX_TYPE_RETRIES; attempt++) {
    const inputEl = page.locator(inputSelector).first();
    await inputEl.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    // クリア完了を少し待つ
    await new Promise(r => setTimeout(r, 200));

    // keyboard.type() の代わりに insertText を使用
    // ・OSのクリップボードを汚さない
    // ・改行 (\n) が Enter キーとして解釈されず、そのまま入力欄に挿入されるため送信が暴発しない
    // ・タイピングではなく一括挿入のため、フォーカス外れによる入力途切れが起きない
    await page.evaluate(({ sel, txt }) => {
      const el = document.querySelector(sel) as HTMLElement;
      if (el) {
        el.focus();
        document.execCommand('insertText', false, txt);
      }
    }, { sel: inputSelector, txt: text });

    // 入力後1秒待機（低スペックPCでのDOM反映遅延を吸収する）
    await new Promise(r => setTimeout(r, 1000));

    const actualText = await getActualText();
    const actualLen  = actualText.trim().length;
    // 入力元テキストを100%として、85%〜115%の文字数なら許容（改行変換等によるズレを吸収）
    const ratio = expectedLen > 0 ? actualLen / expectedLen : 1;
    if (ratio >= 0.85 && ratio <= 1.15) {
      if (attempt > 1) {
        console.log(`[入力チェックOK] ${attempt}回目で成功（文字数: ${actualLen}/${expectedLen}, 比率: ${(ratio * 100).toFixed(1)}%）。`);
      }
      return;
    }

    console.warn(
      `[入力チェック失敗] 期待: ${expectedLen}文字 / 実際: ${actualLen}文字` +
      ` (比率: ${(ratio * 100).toFixed(1)}%) (${attempt}/${MAX_TYPE_RETRIES})`
    );
    if (attempt < MAX_TYPE_RETRIES) {
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  throw new Error(
    `${MAX_TYPE_RETRIES}回リトライしましたが、正しく入力できませんでした` +
    `（期待: ${expectedLen}文字）。`
  );
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
      (sel) => document.querySelectorAll(sel).length,
      SELECTORS.gemini.response
    );
    if (count > previousCount) break;
    await new Promise(r => setTimeout(r, 500));
  }

  while (Date.now() - start < timeoutMs) {
    const currentText: string = await geminiPage.evaluate(({ prev, responseSel, contentSel }) => {
      const responses = document.querySelectorAll(responseSel);
      const newResponses = Array.from(responses).slice(prev);
      if (newResponses.length === 0) return '';
      const last = newResponses[newResponses.length - 1];
      return last?.querySelector(contentSel)?.textContent?.trim() ?? '';
    }, { prev: previousCount, responseSel: SELECTORS.gemini.response, contentSel: SELECTORS.gemini.content });

    if (currentText.length > 0 && currentText === lastText) {
      stableCount++;
      if (stableCount >= stableThreshold) {
        // 安定したら innerHTML を返す
        const html: string = await geminiPage.evaluate(({ prev, responseSel, contentSel }) => {
          const responses = document.querySelectorAll(responseSel);
          const newResponses = Array.from(responses).slice(prev);
          if (newResponses.length === 0) return '';
          const last = newResponses[newResponses.length - 1];
          return last?.querySelector(contentSel)?.innerHTML ?? '';
        }, { prev: previousCount, responseSel: SELECTORS.gemini.response, contentSel: SELECTORS.gemini.content });
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
      SELECTORS.chatgpt.response
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
    }, { sel: SELECTORS.chatgpt.response, prev: previousCount });

    if (currentText.length > 0 && currentText === lastText) {
      stableCount++;
      if (stableCount >= stableThreshold) {
        // 安定したら innerHTML を返す（.markdown 要素があればそれを優先）
        const html: string = await chatgptPage.evaluate(({ sel, prev, contentSel }) => {
          const responses = document.querySelectorAll(sel);
          const newResponses = Array.from(responses).slice(prev);
          if (newResponses.length === 0) return '';
          const last = newResponses[newResponses.length - 1];
          const markdown = last?.querySelector(contentSel);
          return (markdown ?? last)?.innerHTML ?? '';
        }, { sel: SELECTORS.chatgpt.response, prev: previousCount, contentSel: SELECTORS.chatgpt.content });
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
  console.log(`Gemini へ送信: ${text.length}文字 (entryId: ${entryId})`);
  lastEntryId = entryId;

  await geminiPage.bringToFront();

  const inputSelector = SELECTORS.gemini.input;
  await geminiPage.waitForSelector(inputSelector, { timeout: 15000 });

  lastPreviousGeminiCount = await geminiPage.evaluate(
    (sel) => document.querySelectorAll(sel).length,
    SELECTORS.gemini.response
  );

  // ① 入力チェック＆リトライ付きタイピング
  try {
    await typeWithRetry(
      geminiPage,
      inputSelector,
      text,
      async () => await geminiPage.evaluate((sel) =>
        document.querySelector(sel)?.textContent?.trim() ?? '', inputSelector)
    );
  } catch (err: any) {
    console.error(`Gemini 入力失敗: ${err.message}`);
    await inputPage.bringToFront();
    await inputPage.evaluate(
      ({ id, msg }) => { (window as any).updateGeminiResponseError(id, msg); },
      { id: entryId, msg: err.message }
    );
    return;
  }

  // ② 送信
  const sendBtn = geminiPage.locator(SELECTORS.gemini.sendBtn).first();
  await sendBtn.click();
  // 次の画面（一括調べもの画面）に切り替わる前に0.5秒待機する
  await new Promise(r => setTimeout(r, 500));
  console.log(`Gemini 送信完了 (送信前応答数: ${lastPreviousGeminiCount})`);

  // ③ 新しい model-response が出るまで少し待機
  const sendTimeout = Date.now() + 15000;
  while (Date.now() < sendTimeout) {
    const count: number = await geminiPage.evaluate(
      (sel) => document.querySelectorAll(sel).length,
      SELECTORS.gemini.response
    );
    if (count > lastPreviousGeminiCount) break;
    await new Promise(r => setTimeout(r, 300));
  }

  await inputPage.bringToFront();

  // ④ 回答待ちをバックグラウンドで実行（直列送信を妨げないよう fire-and-forget）
  const capturedGeminiCount = lastPreviousGeminiCount;
  void (async () => {
    try {
      const answer = await waitForGeminiResponse(capturedGeminiCount);
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
  })();
  // sendToGemini はここで return。回答待ちは非同期で継続。
});

// ─────────────────────────────────────────────────────────────────
// 送信 → ChatGPT
// ─────────────────────────────────────────────────────────────────
await inputPage.exposeFunction('sendToChatGPT', async (text: string, entryId: string) => {
  console.log(`ChatGPT へ送信: ${text.length}文字 (entryId: ${entryId})`);

  await chatgptPage.bringToFront();

  const inputSelector = SELECTORS.chatgpt.input;
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
    SELECTORS.chatgpt.response
  );
  lastPreviousChatGPTCount = previousCount;

  // ① 入力チェック＆リトライ付きタイピング
  try {
    await typeWithRetry(
      chatgptPage,
      inputSelector,
      text,
      async () => await chatgptPage.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return '';
        // textarea は .value、contenteditable div は .innerText で取得
        return ((el as HTMLTextAreaElement).value ?? (el as HTMLElement).innerText ?? '').trim();
      }, SELECTORS.chatgpt.input)
    );
  } catch (err: any) {
    console.error(`ChatGPT 入力失敗: ${err.message}`);
    await inputPage.bringToFront();
    await inputPage.evaluate(
      ({ id, msg }) => { (window as any).updateChatGPTResponseError(id, msg); },
      { id: entryId, msg: err.message }
    );
    return;
  }

  // ② 送信ボタンをクリック
  const sendBtn = chatgptPage.locator(SELECTORS.chatgpt.sendBtn).first();
  await sendBtn.click();
  // 次の画面（一括調べもの画面）に切り替わる前に0.5秒待機する
  await new Promise(r => setTimeout(r, 500));
  console.log(`ChatGPT 送信完了 (送信前応答数: ${previousCount})`);

  await inputPage.bringToFront();

  // ③ 回答待ちをバックグラウンドで実行（fire-and-forget）
  const capturedChatGPTCount = previousCount;
  void (async () => {
    try {
      const answer = await waitForChatGPTResponse(capturedChatGPTCount);
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
  })();
  // sendToChatGPT はここで return。回答待ちは非同期で継続。
});

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
      SELECTORS.claude.response
    );
    if (count > previousCount) break;
    await new Promise(r => setTimeout(r, 500));
  }

  // data-is-streaming="true" の要素がなくなるまで待機（生成完了）
  const deadline = start + timeoutMs;
  while (Date.now() < deadline) {
    const isStreaming: boolean = await claudePage.evaluate((sel) => {
      return document.querySelector(sel) !== null;
    }, SELECTORS.claude.streaming);
    if (!isStreaming) break;
    await new Promise(r => setTimeout(r, 800));
  }

  if (Date.now() >= deadline) {
    throw new Error(`Claude の応答がタイムアウトしました（${timeoutMs / 1000}秒）。`);
  }

  // 最後の回答コンテナから innerHTML を取得
  // .font-claude-message-content / .font-claude-response 等があればそれを優先，
  // 見つからない場合は innerText のみ取得（SVG 等のノイズを排除）
  const html: string = await claudePage.evaluate(({ prev, responseSel, contentSel }) => {
    const containers = document.querySelectorAll(responseSel);
    const newContainers = Array.from(containers).slice(prev);
    if (newContainers.length === 0) return '';
    const last = newContainers[newContainers.length - 1] as HTMLElement;
    const content = last.querySelector(contentSel);
    if (content) {
      // 本文エリアが見つかった場合：リッチな HTML を返す
      return (content as HTMLElement).innerHTML ?? '';
    } else {
      // 見つからなかった場合（フォールバック）：テキストのみ取得（SVG / ボタンなどノイズを完全排除）
      const text = (last as HTMLElement).innerText?.trim() ?? '';
      return text ? `<div style="white-space: pre-wrap;">${text}</div>` : '';
    }
  }, { prev: previousCount, responseSel: SELECTORS.claude.response, contentSel: SELECTORS.claude.content });

  if (!html) {
    throw new Error('Claude の回答が空でした。');
  }
  return html;
}

// ─────────────────────────────────────────────────────────────────
// 送信 → Claude
// ─────────────────────────────────────────────────────────────────
await inputPage.exposeFunction('sendToClaude', async (text: string, entryId: string) => {
  console.log(`Claude へ送信: ${text.length}文字 (entryId: ${entryId})`);

  await claudePage.bringToFront();

  try {
    await claudePage.waitForSelector(SELECTORS.claude.input, { timeout: 15000 });
  } catch {
    await inputPage.evaluate(
      ({ id, msg }) => { (window as any).updateClaudeResponseError(id, msg); },
      { id: entryId, msg: 'Claude の入力欄が見つかりません。ログインしているか確認してください。' }
    );
    return;
  }

  const previousCount: number = await claudePage.evaluate(
    (sel) => document.querySelectorAll(sel).length,
    SELECTORS.claude.response
  );
  lastPreviousClaudeCount = previousCount;

  // ① 入力チェック＆リトライ付きタイピング
  try {
    await typeWithRetry(
      claudePage,
      SELECTORS.claude.input,
      text,
      async () => await claudePage.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return '';
        // ProseMirror は innerText が改行を正しく反映する
        return ((el as HTMLElement).innerText ?? el.textContent ?? '').trim();
      }, SELECTORS.claude.input)
    );
  } catch (err: any) {
    console.error(`Claude 入力失敗: ${err.message}`);
    await inputPage.bringToFront();
    await inputPage.evaluate(
      ({ id, msg }) => { (window as any).updateClaudeResponseError(id, msg); },
      { id: entryId, msg: err.message }
    );
    return;
  }

  // ② 送信
  const sendBtn = claudePage.locator(SELECTORS.claude.sendBtn).first();
  await sendBtn.click();
  // 次の画面（一括調べもの画面）に切り替わる前に0.5秒待機する
  await new Promise(r => setTimeout(r, 500));
  console.log(`Claude 送信完了 (送信前応答数: ${previousCount})`);

  await inputPage.bringToFront();

  // ③ 回答待ちをバックグラウンドで実行（fire-and-forget）
  const capturedClaudeCount = previousCount;
  void (async () => {
    try {
      const answer = await waitForClaudeResponse(capturedClaudeCount);
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
  })();
  // sendToClaude はここで return。回答待ちは非同期で継続。
});

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
      SELECTORS.perplexity.response
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
    }, { sel: SELECTORS.perplexity.response, prev: previousCount });

    if (currentText.length > 0 && currentText === lastText) {
      stableCount++;
      if (stableCount >= stableThreshold) {
        const html: string = await perplexityPage.evaluate(({ sel, prev }) => {
          const responses = document.querySelectorAll(sel);
          const newResponses = Array.from(responses).slice(prev);
          if (newResponses.length === 0) return '';
          const last = newResponses[newResponses.length - 1];
          return last?.innerHTML ?? '';
        }, { sel: SELECTORS.perplexity.response, prev: previousCount });
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
  console.log(`Perplexity へ送信: ${text.length}文字 (entryId: ${entryId})`);

  await perplexityPage.bringToFront();

  // 新規チャット画面に遷移（毎回クリーンな状態で送信）
  await perplexityPage.goto(PERPLEXITY_URL, { waitUntil: 'domcontentloaded' });

  try {
    await perplexityPage.waitForSelector(SELECTORS.perplexity.input, { timeout: 15000 });
  } catch {
    await inputPage.evaluate(
      ({ id, msg }) => { (window as any).updatePerplexityResponseError(id, msg); },
      { id: entryId, msg: 'Perplexity の入力欄が見つかりません。ログインしているか確認してください。' }
    );
    return;
  }

  const previousCount: number = await perplexityPage.evaluate(
    (sel) => document.querySelectorAll(sel).length,
    SELECTORS.perplexity.response
  );
  lastPreviousPerplexityCount = previousCount;

  // ① 入力チェック＆リトライ付きタイピング
  try {
    await typeWithRetry(
      perplexityPage,
      SELECTORS.perplexity.input,
      text,
      async () => await perplexityPage.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return '';
        return ((el as HTMLInputElement).value ?? el.textContent ?? '').trim();
      }, SELECTORS.perplexity.input)
    );
  } catch (err: any) {
    console.error(`Perplexity 入力失敗: ${err.message}`);
    await inputPage.bringToFront();
    await inputPage.evaluate(
      ({ id, msg }) => { (window as any).updatePerplexityResponseError(id, msg); },
      { id: entryId, msg: err.message }
    );
    return;
  }

  // ② 送信（Perplexity は Enter キーで送信）
  await perplexityPage.keyboard.press('Enter');
  // 次の画面（一括調べもの画面）に切り替わる前に0.5秒待機する
  await new Promise(r => setTimeout(r, 500));
  console.log(`Perplexity 送信完了 (送信前応答数: ${previousCount})`);

  await inputPage.bringToFront();

  // ③ 回答待ちをバックグラウンドで実行（fire-and-forget）
  const capturedPerplexityCount = previousCount;
  void (async () => {
    try {
      const answer = await waitForPerplexityResponse(capturedPerplexityCount);
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
  })();
  // sendToPerplexity はここで return。回答待ちは非同期で継続。
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
