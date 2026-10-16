import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from 'playwright';
import { fillChatGPTPrompt, waitForChatGPTResponse } from '../chatgpt.ts';
import { SELECTORS } from '../selectors.ts';

let browser: Browser;
before(async () => { browser = await chromium.launch({ channel: 'chrome', headless: true }); });
after(async () => { await browser?.close(); });

async function fixture(html: string, run: (page: Page) => Promise<void>) {
  const page = await browser.newPage();
  try {
    await page.setContent(html);
    await run(page);
  } finally {
    await page.close();
  }
}

for (const [label, markup] of [
  ['新UIのtextarea', '<textarea id="mobile-composer-prompt" data-mobile-composer-prompt></textarea>'],
  ['従来のcontenteditable', '<div id="prompt-textarea" contenteditable="true"></div>'],
  ['非表示の旧入力欄が共存する画面', '<textarea id="prompt-textarea" hidden></textarea><textarea id="mobile-composer-prompt"></textarea>'],
]) {
  test(`${label}に日本語・改行を入力し、inputイベントで送信を有効にする`, async () => {
    await fixture(`${markup}<button data-composer-submit disabled>送信</button>
      <script>document.addEventListener('input', () => document.querySelector('button').disabled = false);</script>`, async page => {
      const text = '検索の動作確認\n二行目も保持する';
      await fillChatGPTPrompt(page, text);
      const input = page.locator(SELECTORS.chatgpt.input).filter({ visible: true }).first();
      assert.equal(await input.evaluate(el => el instanceof HTMLTextAreaElement ? el.value : (el as HTMLElement).innerText), text);
      assert.equal(await page.locator(SELECTORS.chatgpt.sendBtn).isEnabled(), true);
    });
  });
}

test('新UIの生成中ボタンを送信ボタンとして選ばない', async () => {
  await fixture('<button data-composer-submit><span data-composer-stop-icon></span></button>', async page => {
    assert.equal(await page.locator(SELECTORS.chatgpt.sendBtn).count(), 0);
    assert.equal(await page.locator(SELECTORS.chatgpt.stopBtn).count(), 1);
  });
});

test('新UIの完了した回答本文を取得する', async () => {
  await fixture('<li data-message-role="assistant" data-message-complete><h4>ChatGPT:</h4><div data-assistant-markdown><p>確認OK</p></div><button>コピー</button></li>', async page => {
    assert.equal(await waitForChatGPTResponse(page, 0, 5000), '<p>確認OK</p>');
  });
});

test('従来UIで前回の回答を除き、今回の回答を取得する', async () => {
  await fixture('<div data-message-author-role="assistant"><div class="markdown">前回</div></div><div data-message-author-role="assistant"><div class="markdown"><p>今回</p></div></div>', async page => {
    assert.equal(await waitForChatGPTResponse(page, 1, 5000), '<p>今回</p>');
  });
});

test('思考中の文章が変化しなくても完了扱いしない', async () => {
  await fixture('<li data-message-role="assistant"><div data-assistant-markdown>思考中</div></li>', async page => {
    await assert.rejects(waitForChatGPTResponse(page, 0, 2100), /タイムアウト/);
  });
});

test('停止ボタンの表示中は回答を返さず、完了後の本文を取得する', async () => {
  await fixture('<button data-testid="stop-button">停止</button><div data-message-author-role="assistant"><div class="markdown">途中</div></div>', async page => {
    await page.evaluate(() => {
      setTimeout(() => {
        document.querySelector('button')!.remove();
        document.querySelector('.markdown')!.innerHTML = '<p>最終回答</p>';
      }, 2100);
    });
    assert.equal(await waitForChatGPTResponse(page, 0, 6000), '<p>最終回答</p>');
  });
});

test('前回の回答しかない場合は過去の内容を返さない', async () => {
  await fixture('<div data-message-author-role="assistant"><div class="markdown">前回</div></div>', async page => {
    await assert.rejects(waitForChatGPTResponse(page, 1, 700), /タイムアウト/);
  });
});
