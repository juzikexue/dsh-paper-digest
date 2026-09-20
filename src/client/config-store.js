/**
 * Config store for the browser half: the plugin's own JSON config, reached over
 * its host routes. (The DSH settings service is scope-isolated away from
 * out-of-tree plugins, so the plugin persists its own config host-side.)
 */

const BASE = '/dsh-paper-digest';

export function createConfigStore() {
  let state = null;
  let status = null;
  let listeners = [];

  function notify() {
    for (const fn of listeners) {
      try {
        fn();
      } catch (error) {
        console.debug('[dsh-paper-digest:store]', error);
      }
    }
  }

  function get() {
    return state;
  }

  function getStatus() {
    return status;
  }

  function subscribe(fn) {
    listeners.push(fn);
    return () => {
      listeners = listeners.filter((x) => x !== fn);
    };
  }

  function load() {
    return fetch(`${BASE}/config`)
      .then((r) => r.json())
      .then((data) => {
        if (data && data.config) state = data.config;
        if (data && data.status) status = data.status;
        notify();
        return state;
      })
      .catch((error) => {
        console.debug('[dsh-paper-digest:store]', error);
        return null;
      });
  }

  function refreshStatus() {
    return fetch(`${BASE}/status`)
      .then((r) => r.json())
      .then((data) => {
        if (data && data.status) status = data.status;
        notify();
        return status;
      })
      .catch((error) => {
        console.debug('[dsh-paper-digest:store]', error);
        return null;
      });
  }

  /** Optimistically apply the patch, then persist; the server echo wins. */
  function save(patch) {
    if (state) state = { ...state, ...patch };
    notify();
    return fetch(`${BASE}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data && data.config) state = data.config;
        if (data && data.status) status = data.status;
        if (data && data.ok === false) return { error: data.error || '保存失败' };
        notify();
        return data;
      })
      .catch((error) => {
        console.debug('[dsh-paper-digest:store]', error);
        return { error: String((error && error.message) || error) };
      });
  }

  function runNow() {
    return fetch(`${BASE}/run`, { method: 'POST' })
      .then((r) => r.json().then((data) => ({ status: r.status, data })))
      .catch((error) => ({ status: 0, data: { ok: false, error: String((error && error.message) || error) } }));
  }

  /** Create a session for the most recent digest without re-running collection. */
  function openSession() {
    return fetch(`${BASE}/open-session`, { method: 'POST' })
      .then((r) => r.json())
      .catch((error) => ({ ok: false, error: String((error && error.message) || error) }));
  }

  function loadCoreList() {
    return fetch(`${BASE}/core-list`)
      .then((r) => r.json())
      .catch(() => ({ ok: false, content: '', file: '' }));
  }

  function saveCoreList(content) {
    return fetch(`${BASE}/core-list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
      .then((r) => r.json())
      .catch((error) => ({ ok: false, error: String((error && error.message) || error) }));
  }

  return { get, getStatus, subscribe, load, refreshStatus, save, runNow, openSession, loadCoreList, saveCoreList };
}
