/**
 * Export a game as an Android APK: the static web build of `export-game.mjs`
 * inside a one-screen WebView app.
 *
 * The app is built with the Android SDK's own tools (`aapt2`, `javac`, `d8`,
 * `zipalign`, `apksigner`), not Gradle, so a build needs the SDK and a JDK and
 * no download. The WebView serves the bundled files from the fake origin
 * `https://game.local/`, because module scripts and `fetch` do not run from
 * `file://`. The APK is signed with a debug key kept in `.engine/`, so an
 * update installs over an earlier build.
 *
 * `game.json` may hold `"android": { "package": "com.you.game", "orientation": "landscape" }`.
 * Orientation is `landscape`, `portrait` or `unspecified` (the default).
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { exportGame } from './export-game.mjs'

const run = promisify(execFile)

const MIN_SDK = 24
const TARGET_SDK = 34

const ORIENTATIONS = { landscape: 'sensorLandscape', portrait: 'sensorPortrait', unspecified: 'unspecified' }

/** The WebView host: serves `assets/www/` as `https://game.local/` and shows the game full screen. */
const ACTIVITY_SOURCE = `package PACKAGE;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.webkit.MimeTypeMap;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.InputStream;

public class MainActivity extends Activity {
  private static final String ORIGIN = "https://game.local/";
  private WebView view;

  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);
    view = new WebView(this);
    WebSettings settings = view.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setMediaPlaybackRequiresUserGesture(false);
    view.setWebViewClient(new WebViewClient() {
      @Override
      public WebResourceResponse shouldInterceptRequest(WebView webView, WebResourceRequest request) {
        String url = request.getUrl().toString();
        if (!url.startsWith(ORIGIN)) return null;
        String path = request.getUrl().getPath();
        if (path == null || path.equals("/")) path = "/index.html";
        try {
          InputStream stream = getAssets().open("www" + path);
          return new WebResourceResponse(mimeOf(path), "utf-8", stream);
        } catch (Exception missing) {
          return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null);
        }
      }
    });
    setContentView(view);
    view.loadUrl(ORIGIN);
  }

  private static String mimeOf(String path) {
    if (path.endsWith(".js") || path.endsWith(".mjs")) return "text/javascript";
    if (path.endsWith(".wasm")) return "application/wasm";
    String extension = MimeTypeMap.getFileExtensionFromUrl(path);
    String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
    return mime == null ? "application/octet-stream" : mime;
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (!hasFocus) return;
    view.setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
      | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
      | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
  }

  @Override
  protected void onPause() {
    super.onPause();
    view.onPause();
  }

  @Override
  protected void onResume() {
    super.onResume();
    view.onResume();
  }
}
`

/** The Android application id for a game: its `android.package`, else `com.engine.<name>` with only letters and digits. */
export function packageName(game, project) {
  if (game.android?.package) return game.android.package
  const slug = path.basename(project).toLowerCase().replace(/[^a-z0-9]/g, '')
  return `com.engine.${/^[a-z]/.test(slug) ? slug : `game${slug}`}`
}

/** The manifest text. The activity handles rotation itself, so the game is not reloaded by it. */
export function manifestText({ id, title, orientation }) {
  if (!ORIENTATIONS[orientation]) throw new Error(`android.orientation "${orientation}" is not landscape, portrait or unspecified`)
  const escaped = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
  return `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${id}">
  <uses-permission android:name="android.permission.INTERNET" />
  <application android:label="${escaped}" android:hardwareAccelerated="true">
    <activity android:name=".MainActivity" android:exported="true"
        android:theme="@android:style/Theme.NoTitleBar.Fullscreen"
        android:screenOrientation="${ORIENTATIONS[orientation]}"
        android:configChanges="orientation|screenSize|keyboardHidden|smallestScreenSize|screenLayout">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
    </activity>
  </application>
</manifest>
`
}

/** The SDK folder from the environment or the usual install places, or an error saying what to set. */
async function findSdk() {
  const candidates = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, '/usr/local/lib/android/sdk'].filter(Boolean)
  for (const candidate of candidates) {
    if (await fs.stat(path.join(candidate, 'build-tools')).catch(() => null)) return candidate
  }
  throw new Error('no Android SDK found: install one and set ANDROID_HOME to it')
}

/** The highest-numbered entry of a folder. */
async function newestIn(directory) {
  const names = await fs.readdir(directory)
  const [newest] = names.sort((first, second) => second.localeCompare(first, undefined, { numeric: true }))
  if (!newest) throw new Error(`nothing installed in ${directory}`)
  return newest
}

/** The SDK tools a build calls: the build-tools binaries and the platform's `android.jar`. */
async function findTools(sdk) {
  const buildTools = path.join(sdk, 'build-tools', await newestIn(path.join(sdk, 'build-tools')))
  const platforms = (await fs.readdir(path.join(sdk, 'platforms'))).filter(name => /^android-\d+$/.test(name))
  const platform = platforms.filter(name => Number(name.slice(8)) >= TARGET_SDK).sort()[0]
  if (!platform) throw new Error(`the SDK needs platform android-${TARGET_SDK} or newer`)
  return {
    aapt2: path.join(buildTools, 'aapt2'),
    d8: path.join(buildTools, 'd8'),
    zipalign: path.join(buildTools, 'zipalign'),
    apksigner: path.join(buildTools, 'apksigner'),
    androidJar: path.join(sdk, 'platforms', platform, 'android.jar')
  }
}

/** Every `.class` file under a folder. */
async function classFiles(directory) {
  const entries = await fs.readdir(directory, { recursive: true })
  return entries.filter(name => name.endsWith('.class')).map(name => path.join(directory, name))
}

/** The debug keystore, made once and kept. Answers its path. */
async function debugKeystore(checkout) {
  const keystore = path.join(checkout, '.engine/android-debug.keystore')
  if (await fs.stat(keystore).catch(() => null)) return keystore
  await fs.mkdir(path.dirname(keystore), { recursive: true })
  await run('keytool', [
    '-genkeypair', '-keystore', keystore, '-storepass', 'android', '-keypass', 'android',
    '-alias', 'debug', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
    '-dname', 'CN=Engine Debug,O=Engine,C=US'
  ])
  return keystore
}

/**
 * Build one project into an APK at `out`. Answers `{ apk, id, title, bytes,
 * plugins }`. Throws a message that names the missing tool when a build step
 * cannot run.
 */
export async function exportAndroid({ checkout, project, out }) {
  const game = JSON.parse(await fs.readFile(path.join(project, 'game.json'), 'utf8').catch(() => '{}'))
  const title = game.title ?? path.basename(project)
  const id = packageName(game, project)
  const manifest = manifestText({ id, title, orientation: game.android?.orientation ?? 'unspecified' })
  const tools = await findTools(await findSdk())

  const work = path.join(checkout, '.engine/android-build', path.basename(project))
  await fs.rm(work, { recursive: true, force: true })
  const web = path.join(work, 'assets/www')
  const webResult = await exportGame({ checkout, project, out: web })

  const sourceFile = path.join(work, 'java', ...id.split('.'), 'MainActivity.java')
  await fs.mkdir(path.dirname(sourceFile), { recursive: true })
  await fs.writeFile(sourceFile, ACTIVITY_SOURCE.replace('PACKAGE', id))
  await fs.writeFile(path.join(work, 'AndroidManifest.xml'), manifest)

  const step = (file, args) => run(file, args, { cwd: work, maxBuffer: 1 << 26 })
  const unsigned = path.join(work, 'unsigned.apk')
  await step(tools.aapt2, [
    'link', '--manifest', 'AndroidManifest.xml', '-I', tools.androidJar, '-A', 'assets',
    '--min-sdk-version', String(MIN_SDK), '--target-sdk-version', String(TARGET_SDK), '-o', unsigned
  ])
  await fs.mkdir(path.join(work, 'classes'))
  await step('javac', ['--release', '8', '-Xlint:-options', '-cp', tools.androidJar, '-d', 'classes', sourceFile])
  await fs.mkdir(path.join(work, 'dex'))
  await step(tools.d8, ['--lib', tools.androidJar, '--min-api', String(MIN_SDK), '--output', 'dex', ...(await classFiles(path.join(work, 'classes')))])
  await step('jar', ['--update', '--file', unsigned, '-C', 'dex', 'classes.dex'])

  const aligned = path.join(work, 'aligned.apk')
  await step(tools.zipalign, ['-f', '-p', '4', unsigned, aligned])
  await fs.mkdir(path.dirname(path.resolve(out)), { recursive: true })
  await step(tools.apksigner, [
    'sign', '--ks', await debugKeystore(checkout), '--ks-pass', 'pass:android', '--key-pass', 'pass:android',
    '--out', path.resolve(out), aligned
  ])
  await fs.rm(work, { recursive: true, force: true })
  return { apk: path.resolve(out), id, title, bytes: (await fs.stat(out)).size, plugins: webResult.plugins }
}
