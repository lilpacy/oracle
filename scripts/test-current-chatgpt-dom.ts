#!/usr/bin/env tsx
import assert from "node:assert/strict";
import { launch } from "chrome-launcher";
import puppeteer from "puppeteer-core";
import { buildConversationTurnCountExpression } from "../src/browser/conversationTurns.js";
import { __test__ as composer } from "../src/browser/actions/promptComposer.js";
import {
  readAssistantSnapshot,
  buildCompletionVisibilityExpressionForTest,
  captureAssistantMarkdown,
} from "../src/browser/actions/assistantResponse.js";
import { ensureThinkingTime } from "../src/browser/actions/thinkingTime.js";
import { ensureModelSelection } from "../src/browser/actions/modelSelection.js";

// Sanitized structural fixture from the September 2026 ChatGPT browser UI.
const chrome = await launch({ chromeFlags: ["--headless=new", "--disable-gpu"] });
const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${chrome.port}` });
try {
  const page = await browser.newPage();
  await page.setContent(`
    <aside data-chatgpt-search-unit-key="history:assistant">unrelated history</aside>
    <main><div data-fixture-turn-group>
      <div data-chatgpt-search-unit-key="turn-0:user">
        <div data-content-search-unit-key="turn-0:user" data-user-message-bubble="true">Reply with ORACLE_OK</div>
      </div>
      <div data-chatgpt-search-unit-key="turn-1:assistant">
        <h4 data-conversation-role="assistant">ChatGPT said:</h4>
        <div data-markdown-text-style="assistant-message"><p>ORACLE_OK</p><pre><button aria-label="Copy"></button></pre></div>
      </div>
      <div><button aria-label="Copy">Copy</button><button aria-label="Share">Share</button></div>
      </div><form><div id="prompt-textarea" role="textbox" contenteditable="true"></div>
        <button type="button" aria-label="Select ChatGPT model" data-codex-intelligence-trigger="true"
          aria-haspopup="menu" onclick="document.querySelector('[role=menu]').hidden=false">Medium</button>
      </form>
    </main>
    <div role="menu" hidden>
      <div data-model-picker-view="simple">
        <div role="menuitem" aria-label="Select model" data-model-picker-view-toggle="true"
          onclick="document.querySelector('[data-model-picker-view]').dataset.modelPickerView='models';document.querySelector('#options').hidden=false">Medium</div>
        <div id="options" hidden>
          <div role="menuitemradio" aria-checked="true">Latest</div>
          <div role="menuitemradio" aria-checked="false" onclick="document.querySelectorAll('[role=menuitemradio]').forEach(e=>e.setAttribute('aria-checked',String(e===this)))">GPT-5.6 Sol</div>
        </div>
      </div>
    </div>
  `);
  const expectedMarkdown = "- ORACLE_OK\n\n```python\nprint(42)\n```";
  await page.evaluate(`
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async () => {} }, configurable: true
    });
    document.querySelector('button[aria-label="Copy"]:not(pre button)').addEventListener(
      "click", () => navigator.clipboard.writeText(${JSON.stringify(expectedMarkdown)})
    );
  `);
  const cdp = await page.createCDPSession();
  const Runtime = {
    evaluate: (params: { expression: string; returnByValue?: boolean; awaitPromise?: boolean }) =>
      cdp.send("Runtime.evaluate", params),
  };
  // The CDP client interfaces are structurally equivalent at this boundary.
  const runtime = Runtime as unknown as Parameters<typeof readAssistantSnapshot>[0];
  const selection = await ensureModelSelection(runtime, "GPT-5.6 Sol", console.log);
  assert.equal(selection.resolvedLabel, "GPT-5.6 Sol");
  assert.equal(selection.verified, true);
  const turns = await Runtime.evaluate({
    expression: buildConversationTurnCountExpression(),
    returnByValue: true,
  });
  assert.equal(turns.result.value, 2, "正常系: 履歴や入れ子を重複せず会話を数える");
  assert.equal(
    await composer.verifyPromptCommitted(runtime, "Reply with ORACLE_OK", 100, undefined, 0),
    2,
  );
  const answer = await readAssistantSnapshot(runtime, 1);
  assert.equal(answer?.text, "ORACLE_OK", "正常系: 見出しやプロンプトを混ぜず応答を取得する");
  assert.equal(
    await readAssistantSnapshot(runtime, 2),
    null,
    "異常系: 古い応答を新しい応答として返さない",
  );
  const terminal = await Runtime.evaluate({
    expression: buildCompletionVisibilityExpressionForTest({}, 1),
    returnByValue: true,
  });
  assert.equal(terminal.result.value, true, "正常系: 本文の外にある完了操作を同じ応答に対応付ける");
  assert.equal(
    await captureAssistantMarkdown(runtime, {}, console.log),
    expectedMarkdown,
    "正常系: 同じ応答のCopy操作からMarkdownを保持する",
  );
  await page.setContent(`
    <form><button type="button" data-codex-intelligence-trigger="true" aria-haspopup="menu"
      aria-label="Select ChatGPT model" onclick="document.querySelector('[role=menu]').hidden=false">Medium</button></form>
    <div role="menu" hidden><div data-model-picker-view="simple">
      <div role="menuitem" tabindex="0" style="min-height:24px" data-reasoning-slider="true" aria-label="Power" aria-describedby="effort-description"
        onkeydown="const t=this.querySelector('[role=slider]');const i=Number(t.getAttribute('aria-valuenow'))+(event.key==='ArrowRight'?1:-1);t.setAttribute('aria-valuenow',String(i));document.querySelector('#effort-description').textContent=['Light','Medium','High','Extra High','Pro'][i]+', '+(i+1)+' of 5.'">
        <span role="slider" aria-hidden="true" aria-valuemin="0" aria-valuemax="4" aria-valuenow="1"></span>
      </div><span id="effort-description">Medium, 2 of 5.</span>
    </div></div>
  `);
  const effort = await ensureThinkingTime(runtime, "extra-high", console.log, "GPT-5.6 Sol");
  assert.equal(effort.verified, true, "正常系: 新しい思考量スライダーの選択を確認する");
  assert.equal(effort.resolvedLabel, "Extra High");
  console.log("PASS: モデル選択・送信確認・応答取得（現在のChatGPT DOM）");
} finally {
  await browser.disconnect();
  await chrome.kill();
}
