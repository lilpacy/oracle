import { CONVERSATION_TURN_CONTAINER_SELECTOR, CONVERSATION_TURN_SELECTOR } from "./constants.js";

/** Build a browser-context expression that returns one DOM node per conversation turn. */
export function buildConversationTurnListExpression(rootExpression = "document"): string {
  const containerSelector = JSON.stringify(CONVERSATION_TURN_CONTAINER_SELECTOR);
  const fallbackSelector = JSON.stringify(CONVERSATION_TURN_SELECTOR);
  return `(() => {
    const root = ${rootExpression};
    const containers = Array.from(root.querySelectorAll(${containerSelector}));
    if (containers.length > 0) return containers;
    return Array.from(root.querySelectorAll(${fallbackSelector})).map((turn) => {
      const assistantKey = '[data-chatgpt-search-unit-key$=":assistant"]';
      if (!turn.matches?.(assistantKey)) return turn;
      // The current UI renders the completed-turn actions beside the message body.
      // Never cross into another assistant turn or the page-wide composer/history.
      for (let parent = turn.parentElement; parent && !parent.matches('main, [role="main"], body'); parent = parent.parentElement) {
        if (parent.querySelectorAll(assistantKey).length !== 1) break;
        if (parent.querySelector('button[aria-label="Copy"]:not([data-markdown-text-style="assistant-message"] button)')) return parent;
      }
      return turn;
    });
  })()`;
}

export function buildConversationTurnCountExpression(rootExpression = "document"): string {
  return `(${buildConversationTurnListExpression(rootExpression)}).length`;
}
