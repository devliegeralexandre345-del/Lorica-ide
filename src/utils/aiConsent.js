// RGPD consent guard for AI features.
//
// Call `ensureAIConsent(state, dispatch)` immediately before any network
// call that sends user data (prompts, code context, file contents) to a
// third-party AI provider (Anthropic, DeepSeek, etc.).
//
// Returns a Promise<boolean>:
//   - Resolves `true` if consent is already on record, or the user accepts.
//   - Resolves `false` if the user declines — the caller MUST abort the
//     network call in that case.
//
// The promise uses a poll on state changes. It's ok here because the modal
// lifecycle is short (user either accepts, declines, or the app closes)
// and this avoids introducing a new event bus just for one flow.

const WAIT_POLL_MS = 50;
const WAIT_TIMEOUT_MS = 5 * 60 * 1000; // 5 min — generous, people read slowly

/**
 * @param {{ aiConsentGiven: boolean, aiConsentModalOpen: boolean }} state
 * @param {(action: any) => void} dispatch
 * @param {() => any} [getLatestState]  Optional: reads the freshest state
 *   on each poll (useful when `state` is a stale closure capture).
 * @returns {Promise<boolean>}
 */
export function ensureAIConsent(state, dispatch, getLatestState = null) {
  if (state.aiConsentGiven) return Promise.resolve(true);

  // Open the modal and wait for user decision.
  dispatch({ type: 'OPEN_AI_CONSENT_MODAL' });

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const tick = () => {
      const s = typeof getLatestState === 'function' ? getLatestState() : null;
      // If a getter was provided, use it. Otherwise fall back to the
      // captured state — less reliable but better than nothing.
      const consent = s?.aiConsentGiven ?? state.aiConsentGiven;
      const modalOpen = s?.aiConsentModalOpen ?? state.aiConsentModalOpen;

      if (consent) {
        resolve(true);
        return;
      }
      if (!modalOpen) {
        // Modal was dismissed without accepting → treat as decline.
        resolve(false);
        return;
      }
      if (Date.now() - startedAt > WAIT_TIMEOUT_MS) {
        dispatch({ type: 'CLOSE_AI_CONSENT_MODAL' });
        resolve(false);
        return;
      }
      setTimeout(tick, WAIT_POLL_MS);
    };
    tick();
  });
}

/**
 * Synchronous version for call sites that can't await. Returns true only
 * if consent is already recorded. If not, opens the modal as a side
 * effect and returns false — the caller aborts and the user retries the
 * action after accepting.
 */
export function hasAIConsentOrPrompt(state, dispatch) {
  if (state.aiConsentGiven) return true;
  dispatch({ type: 'OPEN_AI_CONSENT_MODAL' });
  return false;
}
