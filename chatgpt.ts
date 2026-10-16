import { type Page } from 'playwright';
import { SELECTORS } from './selectors.ts';

const normalize = (text: string) => text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();

/**
 * ChatGPT の入力欄にテキストを入力する。
 * 新 UI は ProseMirror (contenteditable div) を使用しているため、
 * Playwright の fill() が React 状態と同期しない問題がある。
 * click() → 全選択 → execCommand('insertText') の順で入力する。
 */
export async function fillChatGPTPrompt(page: Page, text: string): Promise<void> {
  // contenteditable div を優先し、なければ textarea にフォールバック
  const input = page.locator(SELECTORS.chatgpt.input).filter({ visible: true }).first();
  try {
    await input.waitFor({ state: 'visible', timeout: 15_000 });
  } catch {
    throw new Error('ChatGPT の入力欄が見つかりません。ログイン状態と画面を確認してください。');
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    // ① フォーカスを当てる
    await input.click();
    await page.waitForTimeout(200);

    // ② 既存テキストを全選択して削除
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(300);

    // ③ Lexical / ProseMirror 対応: ClipboardEvent を直接 dispatch してペーストを模倣する
    //    これは Lexical の onPaste ハンドラを呼び出すため最も確実。
    const pasted = await input.evaluate((el, txt) => {
      try {
        el.focus();
        const dt = new DataTransfer();
        dt.setData('text/plain', txt);
        const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
        el.dispatchEvent(ev);
        return true;
      } catch {
        return false;
      }
    }, text);
    await page.waitForTimeout(500);

    // ④ 入力内容を検証
    const actual = await input.evaluate(el =>
      el instanceof HTMLTextAreaElement ? el.value : (el as HTMLElement).innerText ?? (el as HTMLElement).textContent ?? ''
    );
    if (normalize(actual) === normalize(text)) return;

    // ClipboardEvent が失敗した場合は keyboard.type() にフォールバック
    console.warn(`[ChatGPT 入力チェック失敗] attempt ${attempt + 1}/3 paste方式${pasted ? '失敗' : 'エラー'}、keyboard.type()を試みます`);
    await input.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);
    await page.keyboard.type(text, { delay: 0 });
    await page.waitForTimeout(500);

    const actual2 = await input.evaluate(el =>
      el instanceof HTMLTextAreaElement ? el.value : (el as HTMLElement).innerText ?? (el as HTMLElement).textContent ?? ''
    );
    if (normalize(actual2) === normalize(text)) return;

    console.warn(`[ChatGPT 入力チェック失敗] attempt ${attempt + 1}/3 keyboard方式も失敗: 期待=${text.length}文字 / 実際=${actual2.length}文字`);
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
  let debugLogged = false;

  while (Date.now() < deadline) {
    const state = await page.evaluate(({ response, content, stopBtn, previousCount }) => {
      const allResponses = Array.from(document.querySelectorAll(response));
      const responses = allResponses.slice(previousCount);
      const last = responses[responses.length - 1];
      const body = last?.querySelector(content);

      // stopBtn は data-testid="stop-button" のみに限定（aria-label は誤マッチしやすいため除外）
      const stopBtnEl = document.querySelector('button[data-testid="stop-button"]');
      const generating = stopBtnEl !== null && (stopBtnEl as HTMLElement).getClientRects().length > 0;

      // body が見つからない場合は last コンテナ自体のテキストをフォールバックにする
      const textContent = body?.textContent?.trim() ?? last?.textContent?.trim() ?? '';
      const htmlContent = body?.innerHTML ?? (last ? `<div style="white-space:pre-wrap">${last.textContent?.trim()}</div>` : '');

      return {
        text: textContent,
        html: htmlContent,
        generating,
        allResponseCount: allResponses.length,
        newResponseCount: responses.length,
        hasBody: !!body,
        stopBtnFound: stopBtnEl !== null,
      };
    }, { ...SELECTORS.chatgpt, previousCount });

    // 初回のみデバッグログ出力
    if (!debugLogged) {
      console.log(`[ChatGPT 回答待機] 全応答数=${state.allResponseCount}, 新規応答数=${state.newResponseCount}, body有=${state.hasBody}, stopBtn=${state.stopBtnFound}, text長=${state.text.length}`);
      debugLogged = true;
    }

    if (state.generating) {
      // 生成中: テキストが変化していたらstableSinceリセット
      if (state.text !== lastText) {
        lastText = state.text;
        stableSince = Date.now();
      }
    } else if (!state.text) {
      // テキストなし: まだ応答が来ていない
      lastText = '';
      stableSince = 0;
    } else if (state.text !== lastText) {
      // テキスト更新
      lastText = state.text;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= 1500) {
      // 1.5秒間テキストが安定 → 完了とみなす
      console.log(`[ChatGPT 回答取得] テキスト安定完了 (${state.text.length}文字)`);
      return state.html || `<div style="white-space:pre-wrap">${state.text}</div>`;
    }

    await page.waitForTimeout(Math.min(500, Math.max(0, deadline - Date.now())));
  }
  throw new Error(`ChatGPT の応答がタイムアウトしました（${timeoutMs / 1000}秒）。ChatGPT タブの生成状態を確認して「再取得」を押してください。`);
}
