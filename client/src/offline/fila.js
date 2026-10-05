// Fila local (IndexedDB) dos registros feitos sem conexão: apontamentos, cronômetro,
// relatório, fotos e checklists. Cada item guarda a chave de idempotência usada no envio.
import { useEffect, useState } from "react";

const DB_NAME = "sigma-ccm-offline";
const STORE = "pendencias";
export const FILA_ALTERADA = "fila:alterada";
export const FILA_SINCRONIZADA = "fila:sincronizada";

let dbPromise = null;
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("usuario_id", "usuario_id");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

async function run(mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = action(transaction.objectStore(STORE));
    transaction.oncomplete = () => resolve(request?.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

const notify = () => window.dispatchEvent(new Event(FILA_ALTERADA));

export async function adicionarPendencia(item) {
  const id = await run("readwrite", (store) => store.add({ ...item, status: "pendente", tentativas: 0, criado_em: new Date().toISOString() }));
  notify();
  return id;
}

export async function listarPendencias(usuarioId) {
  const items = await run("readonly", (store) => store.getAll());
  return (items || []).filter((item) => item.usuario_id === usuarioId).sort((left, right) => left.id - right.id);
}

export async function atualizarPendencia(id, patch) {
  await run("readwrite", (store) => {
    const request = store.get(id);
    request.onsuccess = () => { if (request.result) store.put({ ...request.result, ...patch }); };
    return request;
  });
  notify();
}

export async function removerPendencia(id) {
  await run("readwrite", (store) => store.delete(id));
  notify();
}

// Hook com as pendências do usuário logado, atualizado a cada mudança na fila.
export function usePendencias(usuarioId) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    let active = true;
    const load = () => listarPendencias(usuarioId).then((list) => { if (active) setItems(list); }).catch(() => { if (active) setItems([]); });
    load();
    window.addEventListener(FILA_ALTERADA, load);
    return () => { active = false; window.removeEventListener(FILA_ALTERADA, load); };
  }, [usuarioId]);
  return items;
}

// Estado da conexão do navegador.
export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  return online;
}

// Momento ISO salvo na pendência → formato do servidor ("AAAA-MM-DD HH:MM:SS", UTC).
export const momentoServidor = (iso) => new Date(iso).toISOString().slice(0, 19).replace("T", " ");
