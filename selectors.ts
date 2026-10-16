/**
 * 各 AI サービスのセレクタ定数
 *
 * AI サービスの UI が変更された際は、このファイルのみを修正すること。
 * @lastChecked 2026-10-16 (ChatGPT)
 */
export const SELECTORS = {

  /** Gemini (https://gemini.google.com) */
  gemini: {
    /** テキスト入力欄 */
    input:    'rich-textarea div[contenteditable="true"], rich-textarea div.ql-editor',
    /** 送信ボタン */
    sendBtn:  'div.send-button-container button',
    /** AI 回答コンテナ（カウント・取得に使用） */
    response: 'model-response',
    /** 回答本文（テキスト比較・HTML 取得に使用） */
    content:  'message-content',
  },

  /** ChatGPT (https://chatgpt.com) */
  chatgpt: {
    /** テキスト入力欄 */
    input:    '#prompt-textarea, #mobile-composer-prompt, textarea[data-mobile-composer-prompt]',
    /** 送信ボタン（テキスト入力後に表示される） */
    sendBtn:  'button[data-testid="send-button"], button[data-composer-submit]:not(:has([data-composer-stop-icon]:not([hidden])))',
    /**
     * 生成中に表示される「停止」ボタン。
     * 新UIでは送信ボタン内の停止アイコンの表示で判定する。
     * 回答の完了属性と本文の安定も併せて確認する。
     */
    stopBtn:  'button[data-testid="stop-button"], button[data-composer-submit]:has([data-composer-stop-icon]:not([hidden]))',
    /** AI 回答コンテナ（カウント・取得に使用） */
    response: '[data-message-author-role="assistant"], [data-message-role="assistant"]',
    /** 回答本文（新旧UI） */
    content:  '.markdown, [data-assistant-markdown]',
  },

  /** Claude (https://claude.ai) */
  claude: {
    /** テキスト入力欄（ProseMirror / tiptap） */
    input:      '[data-testid="chat-input"], .tiptap.ProseMirror, [role="textbox"]',
    /** 送信ボタン */
    sendBtn:    'button[aria-label*="Send"], button[aria-label*="送信"], button[aria-label*="メッセージを送信"]',
    /** AI 回答コンテナ（data-is-streaming 属性でカウント・完了判定） */
    response:   '[data-is-streaming]',
    /** ストリーミング中の要素（true の間は生成中） */
    streaming:  '[data-is-streaming="true"]',
    /** 回答本文（ClaudeのUIが変更された場合でもヒットしやすいよう複数候補を列挙） */
    content:    '.font-claude-message-content, .font-claude-response, [data-is-streaming] .prose',
  },

  /** Perplexity (https://www.perplexity.ai) */
  perplexity: {
    /** テキスト入力欄 */
    input:    'textarea[placeholder], div[contenteditable="true"]',
    /** AI 回答コンテナ（カウント・取得に使用） */
    response: '.prose',
  },

} as const;
