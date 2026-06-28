import { chromium, type BrowserContext, type Page } from 'playwright';
import * as path from 'path';
import * as url from 'url';
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';

// このスクリプトが置かれているディレクトリ（プロジェクトフォルダ）
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────
// ツール専用の Chrome プロファイルフォルダ（プロジェクト直下に自動作成）
//
// 【なぜ専用フォルダを使うのか】
//   Chrome 127+ に導入された App-Bound Encryption（アプリバインド暗号化）の影響で、
//   通常の「User Data」ディレクトリに --remote-debugging-port を付けて接続すると
//   Cookie が暗号化されたまま読み取れず、すべてのサイトでログアウト状態になる。
//
// 【専用フォルダのメリット】
//   ・パスが常に一定（プロジェクトフォルダ内）のため App-Bound Encryption に引っかからない
//   ・普段使いの Chrome（メインプロファイル）とは完全に分離され互いに影響しない
//   ・初回起動時に各AIサービスへ手動ログインするだけで、以降はログイン状態が維持される
//
// 【GitHub 公開時の注意】
//   chrome-profile/ は .gitignore に登録済みのため、Cookie・ログイン情報が
//   誤って GitHub にアップロードされることはない。
// ─────────────────────────────────────────────────────────────────────────
const USER_DATA_DIR = path.join(__dirname, 'chrome-profile');

// Chrome 本体のパス（代表的なインストール先を順に探索し、最初に見つかったものを使用）
const CHROME_CANDIDATES = [
  // 1. ユーザーローカルインストール（最も一般的）
  path.join(process.env['LOCALAPPDATA'] ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  // 2. システム全体インストール（64bit）
  path.join('C:\\', 'Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  // 3. システム全体インストール（32bit）
  path.join('C:\\', 'Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
];

const CHROME_EXE_FOUND = CHROME_CANDIDATES.find(p => fs.existsSync(p));
if (!CHROME_EXE_FOUND) {
  throw new Error(
    'Chrome が見つかりませんでした。\n' +
    '以下のパスを確認してください:\n' +
    CHROME_CANDIDATES.map(p => `  - ${p}`).join('\n')
  );
}
const CHROME_EXE = CHROME_EXE_FOUND;

// リモートデバッグポート
const REMOTE_DEBUGGING_PORT = 9222;

export type LaunchChromeResult = {
  context: BrowserContext;
  page: Page;
  /** 新規に起動した Chrome プロセス。既存セッションに接続した場合は null。 */
  chromeProcess: ChildProcess | null;
};

/**
 * CDP エンドポイントが起動するまでポーリングして待機する。
 */
async function waitForCDP(port: number, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${port}/json/version`);
      if (res.ok) return;
    } catch {
      // まだ起動していないので待機
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `CDP エンドポイントへの接続がタイムアウトしました (port: ${port})。` +
      'Chrome が起動しているか確認してください。'
  );
}

/**
 * 既に CDP エンドポイントが待ち受けているか確認する。
 * ツールを二重起動した際に既存セッションを再利用するために使用する。
 */
async function isCDPAlreadyRunning(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/json/version`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function launchChrome(): Promise<LaunchChromeResult> {
  console.log('Chrome を起動します...');
  console.log(`Chrome 実行ファイル: ${CHROME_EXE}`);
  console.log(`専用プロファイル: ${USER_DATA_DIR}`);

  // ── 既存セッションの確認 ────────────────────────────────────────────
  // ツールを二重起動した場合など、すでに CDP が待ち受けていれば既存セッションを再利用する。
  // （専用プロファイルを使うため、普段の Chrome とポート競合は起きない）
  if (await isCDPAlreadyRunning(REMOTE_DEBUGGING_PORT)) {
    console.log(`ポート ${REMOTE_DEBUGGING_PORT} で既存の Chrome セッションを検出しました。再利用します。`);
    const browser = await chromium.connectOverCDP(
      `http://localhost:${REMOTE_DEBUGGING_PORT}`
    );
    const contexts = browser.contexts();
    const context = contexts[0] ?? (await browser.newContext());
    const pages = context.pages();
    const page = pages.length > 0 ? pages[0]! : await context.newPage();
    return { context, page, chromeProcess: null };
  }

  // ── 初回起動の検出 ──────────────────────────────────────────────────
  // chrome-profile フォルダが存在しない = 一度もログインセットアップをしていない状態。
  // このまま各タブを開いてもすべて未ログイン状態になるため、
  // 生成AI初回設定.bat で先にログインするよう案内して終了する。
  const isFirstRun = !fs.existsSync(USER_DATA_DIR);
  if (isFirstRun) {
    console.log('');
    console.log('════════════════════════════════════════════════════════════');
    console.log('  【初回セットアップが必要です】');
    console.log('');
    console.log('  まず 生成AI初回設定.bat を実行して');
    console.log('  各 AI サービスにログインしてください。');
    console.log('');
    console.log('  ログイン完了後、改めて 生成AI一括検索.bat を実行してください。');
    console.log('  次回以降はログイン状態が自動的に維持されます。');
    console.log('════════════════════════════════════════════════════════════');
    console.log('');
    process.exit(0);
  }

  // ── Chrome を専用プロファイルで起動 ────────────────────────────────
  // ・普段使いの Chrome プロファイル（User Data）とは完全に分離
  // ・メインの Chrome を終了させる必要はなく、同時起動可能
  const chromeProcess = spawn(CHROME_EXE, [
    `--user-data-dir=${USER_DATA_DIR}`,
    `--remote-debugging-port=${REMOTE_DEBUGGING_PORT}`,
    '--disable-blink-features=AutomationControlled', // 自動化検知を無効化
    '--no-first-run',                                // 初回起動ウィザードをスキップ
    '--no-default-browser-check',                    // デフォルトブラウザ確認をスキップ
    '--disable-background-timer-throttling',         // バックグラウンドタブのタイマー制限を無効化
    '--disable-backgrounding-occluded-windows',      // 非表示ウィンドウの処理制限を無効化
    '--disable-renderer-backgrounding',              // バックグラウンドタブのレンダラー制限を無効化
    '--allow-file-access-from-files',                // file:// から外部 CSS・JS の読み込みを許可
    '--hide-crash-restore-bubble',                   // クラッシュ復元バブルを非表示
  ]);

  chromeProcess.on('error', (err) => {
    console.error('Chrome の起動に失敗しました:', err.message);
    console.error(`Chrome のパスを確認してください: ${CHROME_EXE}`);
  });

  // CDP エンドポイントが利用可能になるまで待機
  console.log('Chrome の起動を待機しています...');
  await waitForCDP(REMOTE_DEBUGGING_PORT);

  // Playwright を CDP 経由で接続
  console.log(`CDP で接続中 (port: ${REMOTE_DEBUGGING_PORT})...`);
  const browser = await chromium.connectOverCDP(
    `http://localhost:${REMOTE_DEBUGGING_PORT}`
  );

  console.log('Chrome に接続しました（専用プロファイル）');

  // 既存のコンテキスト/ページを取得（なければ新規作成）
  const contexts = browser.contexts();
  const context = contexts[0] ?? (await browser.newContext());
  const pages = context.pages();
  const page = pages.length > 0 ? pages[0]! : await context.newPage();

  return { context, page, chromeProcess };
}

// --- エントリーポイント ---
// このファイルを直接実行した場合のみ起動する（インポート時は実行しない）
const isMain = import.meta.url.replace(/\\/g, '/') ===
  `file:///${process.argv[1]?.replace(/\\/g, '/')}`;

if (isMain) {
  const { context, chromeProcess } = await launchChrome();

  console.log('ページを待機中... (Ctrl+C で終了)');

  // ブラウザを閉じるまで待機する
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
}
