import { type Page } from 'playwright';
import { SELECTORS } from './selectors.ts';

const normalize = (text: string) => text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();

/** textarea と contenteditable の両方に対応し、画面に表示された入力欄だけを操作する。 */
export async function fillChatGPTPrompt(page: Page, text: string): Promise<void> {
  const input = page.locator(SELECTORS.chatgpt.input).filter({ visible: true }).first();
  try {
    await input.waitFor({ state: 'visible', timeout: 15_000 });
  } catch {
    throw new Error('ChatGPT の入力欄が見つかりません。ログイン状態と画面を確認してください。');
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    // fill は input イベントも発火するため、textarea の値とアプリ側の状態が同期する。
    await input.fill(text);
    const actual = await input.evaluate(el =>
      el instanceof HTMLTextAreaElement ? el.value : (el as HTMLElement).innerText
    );
    if (normalize(actual) === normalize(text)) return;
    await page.waitForTimeout(500);
  }
  throw new Error('ChatGPT の入力内容を確認できませんでした。再度お試しください。');
}

/** 通常検索・再取得・まとめで共通の回答完了判定。過去の回答は返さない。 */
export async function waitForChatGPTResponse(
  page: Page,
  previousCount: number,
  timeoutMs = 90_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastText = '';
  let stableSince = 0;

  while (Date.now() < deadline) {
    const state = await page.evaluate(({ response, content, stopBtn, previousCount }) => {
      const responses = Array.from(document.querySelectorAll(response)).slice(previousCount);
      const last = responses[responses.length - 1];
      const body = last?.querySelector(content);
      const generating = Array.from(document.querySelectorAll(stopBtn)).some(el =>
        (el as HTMLElement).getClientRects().length > 0
      );
      return {
        text: body?.textContent?.trim() ?? '',
        html: body?.innerHTML ?? '',
        generating,
        // 新UIでは完了属性を確認する。未完了の思考テキストを安定と誤認しない。
        pending: !!last?.matches('[data-message-role="assistant"]:not([data-message-complete])'),
      };
    }, { ...SELECTORS.chatgpt, previousCount });

    if (!state.text || state.generating || state.pending) {
      lastText = '';
      stableSince = 0;
    } else if (state.text !== lastText) {
      lastText = state.text;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= 1500) {
      return state.html;
    }
    await page.waitForTimeout(Math.min(500, Math.max(0, deadline - Date.now())));
  }
  throw new Error(`ChatGPT の応答がタイムアウトしました（${timeoutMs / 1000}秒）。ChatGPT タブの生成状態を確認して「再取得」を押してください。`);
}
