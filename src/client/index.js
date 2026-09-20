/**
 * Browser half of dsh-paper-digest (bundled to lib/client.js by
 * scripts/build-client.mjs — do not edit the bundle).
 *
 * Registers the "论文日报" page in DSH Settings and injects its styles with
 * light/dark tokens. All side effects are owned by ctx.effect so stopping or
 * updating the plugin removes them.
 */
import { createConfigStore } from './config-store.js';
import { PaperDigestPanel, PANEL_CSS } from './settings-panel.js';

export const inject = ['slots'];

export function apply(ctx) {
  const store = createConfigStore();

  ctx.effect(() => {
    store.load();
  }, 'dsh-paper-digest: initial config load');

  // Styles + theme tokens in one <style> tag, namespaced `dshpd-`.
  ctx.effect(() => {
    const el = document.createElement('style');
    el.setAttribute('data-dsh-paper-digest', 'panel');
    const light = [
      '--dshpd-card: #ffffff; --dshpd-surface: #f4f4f5; --dshpd-text: #1c1c1f;',
      '--dshpd-text-2: #5f6066; --dshpd-text-3: #9b9ca3;',
      '--dshpd-border: rgba(28,28,31,0.12); --dshpd-hairline: rgba(28,28,31,0.07);',
      '--dshpd-accent: #0f766e; --dshpd-accent-1: rgba(15,118,110,0.08);',
      '--dshpd-accent-2: rgba(15,118,110,0.18); --dshpd-ok: #15803d; --dshpd-err: #b91c1c;',
      '--dshpd-track: rgba(28,28,31,0.16); --dshpd-btn-bg: #1c1c1f;',
      '--dshpd-btn-fg: #ffffff; --dshpd-btn-hover: #333338;',
    ].join('');
    const dark = [
      '--dshpd-card: #17171a; --dshpd-surface: #1f1f23; --dshpd-text: #ececee;',
      '--dshpd-text-2: #a2a3aa; --dshpd-text-3: #6c6d75;',
      '--dshpd-border: rgba(236,236,238,0.14); --dshpd-hairline: rgba(236,236,238,0.08);',
      '--dshpd-accent: #2dd4bf; --dshpd-accent-1: rgba(45,212,191,0.10);',
      '--dshpd-accent-2: rgba(45,212,191,0.22); --dshpd-ok: #4ade80; --dshpd-err: #f87171;',
      '--dshpd-track: rgba(236,236,238,0.20); --dshpd-btn-bg: #ececee;',
      '--dshpd-btn-fg: #17171a; --dshpd-btn-hover: #d6d6da;',
    ].join('');
    el.textContent =
      `:root, [data-theme="light"] {${light}}\n` +
      `@media (prefers-color-scheme: dark) {\n:root:not([data-theme="light"]) {${dark}}\n}\n` +
      PANEL_CSS;
    document.head.appendChild(el);
    return () => {
      try {
        el.remove();
      } catch (error) {
        console.debug('[dsh-paper-digest:client]', error);
      }
    };
  }, 'dsh-paper-digest: panel styles');

  // The settings page itself.
  ctx.effect(() => {
    return ctx.slots.inject('settings.section', () => {
      return ctx.slots.register(
        {
          name: 'settings.section',
          id: 'paper-digest',
          order: 55,
          label: () => '论文日报',
          inject: () => ({ store }),
        },
        PaperDigestPanel,
      );
    });
  }, 'dsh-paper-digest: settings panel');
}
