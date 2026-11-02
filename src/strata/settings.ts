// Where the visitor's own API key is kept, and the dialog for entering it.
//
// By default the key lives in sessionStorage, which the browser clears when
// the tab closes. Only if the visitor ticks "Remember on this device" is it
// kept in localStorage. Either way it stays in this browser: it is only ever
// sent to the AI company the visitor picked.

import { PROVIDERS, type Provider } from './ai';

export interface KeySettings {
  provider: Provider;
  key: string;
  model: string;
  remember: boolean;
}

const STORE_KEY = 'strata:key';

function storage(kind: 'session' | 'local'): Storage | null {
  try {
    const s = kind === 'session' ? window.sessionStorage : window.localStorage;
    const probe = '__zr_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

let memory: KeySettings | null = null;

export function loadKey(): KeySettings | null {
  if (memory) return memory;
  for (const kind of ['session', 'local'] as const) {
    try {
      const raw = storage(kind)?.getItem(STORE_KEY);
      if (!raw) continue;
      const v = JSON.parse(raw) as KeySettings;
      if (v && v.key && v.provider in PROVIDERS) return (memory = { ...v, remember: kind === 'local' });
    } catch {
      /* ignore broken entries */
    }
  }
  return null;
}

export function saveKey(v: KeySettings) {
  memory = v;
  forgetStored();
  const target = storage(v.remember ? 'local' : 'session');
  try {
    target?.setItem(STORE_KEY, JSON.stringify(v));
  } catch {
    /* kept in memory only */
  }
}

function forgetStored() {
  for (const kind of ['session', 'local'] as const) {
    try {
      storage(kind)?.removeItem(STORE_KEY);
    } catch {
      /* ignore */
    }
  }
}

export function forgetKey() {
  memory = null;
  forgetStored();
}

/** Shows the key dialog. Resolves true if a key was saved. */
export function openKeyDialog(dialog: HTMLDialogElement, reason?: string): Promise<boolean> {
  const form = dialog.querySelector('form')!;
  const reasonEl = dialog.querySelector<HTMLElement>('[data-reason]')!;
  const providerInputs = [...dialog.querySelectorAll<HTMLInputElement>('input[name="provider"]')];
  const keyInput = dialog.querySelector<HTMLInputElement>('input[name="key"]')!;
  const modelInput = dialog.querySelector<HTMLInputElement>('input[name="model"]')!;
  const rememberInput = dialog.querySelector<HTMLInputElement>('input[name="remember"]')!;
  const getLink = dialog.querySelector<HTMLAnchorElement>('[data-get-key]')!;
  const forgetBtn = dialog.querySelector<HTMLButtonElement>('[data-forget]')!;
  const error = dialog.querySelector<HTMLElement>('[data-error]')!;

  const current = loadKey();
  reasonEl.textContent = reason ?? '';
  reasonEl.hidden = !reason;
  error.hidden = true;
  const provider: Provider = current?.provider ?? 'anthropic';
  providerInputs.forEach((i) => (i.checked = i.value === provider));
  keyInput.value = current?.key ?? '';
  modelInput.value = current?.model ?? '';
  rememberInput.checked = current?.remember ?? false;
  forgetBtn.hidden = !current;

  const sync = () => {
    const p = (providerInputs.find((i) => i.checked)?.value ?? 'anthropic') as Provider;
    getLink.href = PROVIDERS[p].keyUrl;
    getLink.textContent = `${PROVIDERS[p].keyLabel} ↗`;
    keyInput.placeholder = PROVIDERS[p].keyHint;
    modelInput.placeholder = PROVIDERS[p].model;
  };
  sync();
  providerInputs.forEach((i) => (i.onchange = sync));

  return new Promise((resolve) => {
    let saved = false;
    form.onsubmit = (e) => {
      const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
      if (submitter?.value === 'cancel') return; // method="dialog" closes it
      e.preventDefault();
      const key = keyInput.value.trim();
      if (!key) {
        error.textContent = 'Paste your API key first.';
        error.hidden = false;
        keyInput.focus();
        return;
      }
      const p = (providerInputs.find((i) => i.checked)?.value ?? 'anthropic') as Provider;
      saveKey({ provider: p, key, model: modelInput.value.trim(), remember: rememberInput.checked });
      saved = true;
      dialog.close();
    };
    forgetBtn.onclick = () => {
      forgetKey();
      keyInput.value = '';
      forgetBtn.hidden = true;
      dialog.close();
    };
    dialog.addEventListener(
      'close',
      () => {
        keyInput.value = '';
        resolve(saved);
      },
      { once: true },
    );
    dialog.showModal();
    (keyInput.value ? dialog.querySelector<HTMLButtonElement>('button[value="save"]') : keyInput)?.focus();
  });
}
