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
    /**
     * テキスト入力欄。
     * 現在の ChatGPT は Lexical エディタ (data-lexical-editor="true") を使用しており、
     * #prompt-textarea は存在しない。
     */
    input:    '[data-lexical-editor="true"], div[contenteditable="true"][role="textbox"], .ProseMirror[contenteditable="true"]',
    /** 送信ボタン（テキスト入力後に表示される） */
    sendBtn:  'button[data-testid="send-button"], [data-testid="composer-submit-button"], button[aria-label*="送信"], button[aria-label*="Send message"]',
    /**
     * 生成中に表示される「停止」ボタン。
     * 新UIでは data-testid="stop-button" または aria-label で判定する。
     */
    stopBtn:  'button[data-testid="stop-button"], button[aria-label*="Stop"], button[aria-label*="停止"]',
    /** AI 回答コンテナ（カウント・取得に使用） */
    response: '[data-message-author-role="assistant"], [data-message-role="assistant"]',
    /** 回答本文（新旧UI） */
    content:  '.markdown, [data-assistant-markdown], .prose, [class*="markdown"]',
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
