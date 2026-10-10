import { useCallback, useEffect, useRef, useState } from 'react';
import { api, adminPassword } from './api.js';
import { ACTION_LABEL } from './format.js';
import TopBar from './components/TopBar.jsx';
import LoadPanel from './components/LoadPanel.jsx';
import CaseList from './components/CaseList.jsx';
import CaseView from './components/CaseView.jsx';
import Dashboard from './components/Dashboard.jsx';
import Customers from './components/Customers.jsx';
import Login from './components/Login.jsx';
import Learning from './components/Learning.jsx';

// Ordena los archivos para cargarlos bien: primero el manifest, luego events y al final updates.
function sortFiles(files) {
  const rank = (f) => {
    const n = f.name.toLowerCase();
    if (n.endsWith('.json') && !n.endsWith('.jsonl')) return 0;
    if (n.includes('event')) return 1;
    if (n.includes('update')) return 3;
    return 2;
  };
  return [...files].sort((a, b) => rank(a) - rank(b));
}

function describeChanges(evaluated = []) {
  return evaluated
    .filter((r) => r.changes.some((c) => c.before !== null && c.field !== 'reason'))
    .map((r) => {
      const a = r.changes.find((x) => x.field === 'action');
      if (a) return `${r.case_id}: ${ACTION_LABEL[a.before]} pasó a ${ACTION_LABEL[a.after]}`;
      if (r.changes.some((x) => x.field === 'scheduled_for')) return `${r.case_id}: sigue en ${ACTION_LABEL[r.action]}, con nueva fecha de reevaluación`;
      return `${r.case_id}: se actualizó la recomendación`;
    });
}

const TAB_FROM_HASH = () => {
  const h = window.location.hash.replace('#/', '');
  return ['resumen', 'casos', 'clientes', 'aprendizaje'].includes(h) ? h : 'resumen';
};

export default function App() {
  const [auth, setAuth] = useState({ checked: false, required: false, ok: true, error: null });
  const [tab, setTab] = useState(TAB_FROM_HASH());
  const [status, setStatus] = useState(null);
  const [cases, setCases] = useState([]);
  const [summary, setSummary] = useState(null);
  const [insights, setInsights] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerDetail, setCustomerDetail] = useState(null);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [uploadLog, setUploadLog] = useState([]);
  const [showLoader, setShowLoader] = useState(false);
  const sel = useRef({ caseId: null, customerId: null, tab: 'resumen' });
  sel.current = { caseId: selected, customerId: selectedCustomer, tab };

  const say = (kind, text) => setNotice({ kind, text, at: Date.now() });

  const refresh = useCallback(async ({ focusCase, focusCustomer } = {}) => {
    const c = await api.cases(); // primero: en modo en vivo reevalúa y deja todo al día
    const [s, sum, cus, ins] = await Promise.all([api.status(), api.summary(), api.customers(), api.insights()]);
    setStatus(s);
    setCases(c.cases);
    setSummary(sum);
    setCustomers(cus.customers);
    setInsights(ins);

    const firstOpen = c.cases.find((x) => x.status !== 'closed')?.case_id ?? c.cases[0]?.case_id ?? null;
    const caseTarget = focusCase ?? sel.current.caseId ?? firstOpen;
    const caseId = c.cases.some((x) => x.case_id === caseTarget) ? caseTarget : c.cases[0]?.case_id ?? null;
    setSelected(caseId);
    setDetail(caseId ? await api.caseDetail(caseId) : null);

    const cusTarget = focusCustomer ?? sel.current.customerId ?? cus.customers[0]?.customer_id ?? null;
    const cusId = cus.customers.some((x) => x.customer_id === cusTarget) ? cusTarget : cus.customers[0]?.customer_id ?? null;
    setSelectedCustomer(cusId);
    setCustomerDetail(cusId ? await api.customer(cusId) : null);
  }, []);

  const handleError = (e) => {
    if (e.status === 401) {
      setAuth((a) => ({ ...a, required: true, ok: false, error: adminPassword.get() ? 'Contraseña incorrecta.' : null }));
      return;
    }
    say('error', e.message);
  };

  // Verifica si la consola pide contraseña.
  useEffect(() => {
    api.auth()
      .then((a) => setAuth({ checked: true, required: a.required, ok: a.ok, error: null }))
      .catch((e) => {
        setAuth({ checked: true, required: false, ok: true, error: null });
        say('error', `No se pudo conectar con el backend: ${e.message}`);
      });
  }, []);

  useEffect(() => {
    if (auth.checked && auth.ok) refresh().catch(handleError);
  }, [auth.checked, auth.ok, refresh]);

  // En modo en vivo la consola se actualiza sola (llegan eventos del portal y vencen esperas).
  useEffect(() => {
    if (status?.clock?.mode !== 'live') return undefined;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible' && !busy) refresh().catch(() => {});
    }, 8000);
    return () => clearInterval(id);
  }, [status?.clock?.mode, busy, refresh]);

  useEffect(() => {
    const onHash = () => setTab(TAB_FROM_HASH());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Al cambiar de pestaña se actualizan los datos (pudieron llegar eventos del portal).
  const goTab = (t) => {
    window.location.hash = `#/${t}`;
    setTab(t);
    refresh().catch(() => {});
  };

  const run = async (label, fn) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(null);
    }
  };

  const openCase = (id) =>
    run('Cargando caso', async () => {
      setSelected(id);
      setDetail(await api.caseDetail(id));
      goTab('casos');
    });

  const selectCustomer = (id) =>
    run('Cargando cliente', async () => {
      setSelectedCustomer(id);
      setCustomerDetail(await api.customer(id));
    });

  const handleFiles = (fileList) =>
    run('Cargando archivos', async () => {
      const log = [];
      const changes = [];
      for (const file of sortFiles(fileList)) {
        const text = await file.text();
        const isManifest = file.name.toLowerCase().endsWith('.json') && !file.name.toLowerCase().endsWith('.jsonl');
        if (isManifest) {
          let obj;
          try {
            obj = JSON.parse(text);
          } catch {
            throw new Error(`${file.name} no es JSON válido.`);
          }
          const r = await api.manifest(obj);
          log.push({ file: file.name, kind: 'manifest', evaluation_at: r.evaluation_at });
        } else {
          const r = await api.uploadEvents(text, file.name);
          log.push({ file: file.name, kind: 'events', ...r });
          changes.push(...describeChanges(r.evaluated));
        }
      }
      setUploadLog((prev) => [...log.reverse(), ...prev].slice(0, 8));
      await refresh();
      say('ok', changes.length ? `Reevaluado. ${changes.join('. ')}.` : 'Archivos cargados y casos evaluados.');
    });

  const loadKitFile = (file) =>
    run(`Cargando ${file}`, async () => {
      const r = await api.loadKitFile(file);
      setUploadLog((prev) => [{ file: `kit/${file}`, kind: file === 'manifest.json' ? 'manifest' : 'events', ...r }, ...prev].slice(0, 8));
      const changes = describeChanges(r.evaluated);
      await refresh({ focusCase: changes.length ? r.evaluated.find((x) => x.changes.length)?.case_id : undefined });
      say('ok', changes.length ? `Reevaluado. ${changes.join('. ')}.` : `${file} cargado.`);
    });

  const loadWholeKit = () =>
    run('Cargando kit', async () => {
      await api.loadKitFile('manifest.json');
      await api.loadKitFile('events.jsonl');
      await refresh();
      goTab('casos');
      say('ok', 'Kit cargado con la hora del manifest. Para ver el cambio de P06, carga updates.jsonl desde "Carga de datos".');
    });

  const seedDemo = () =>
    run('Cargando datos de demostración', async () => {
      const r = await api.seedDemo();
      await refresh();
      say('ok', r.seeded ? `Datos de demostración listos: ${r.customers} clientes con su historial. El reloj está en vivo.` : r.reason);
    });

  const evaluateAll = () =>
    run('Evaluando', async () => {
      const r = await api.evaluate();
      const created = r.results.filter((x) => x.created).length;
      const changes = describeChanges(r.results.filter((x) => x.created));
      await refresh();
      say('ok', created ? `Se evaluaron ${created} casos.${changes.length ? ` ${changes.join('. ')}.` : ''}` : 'Sin cambios: ninguna decisión necesitaba actualizarse.');
    });

  const afterClockChange = async (label) => {
    const r = await api.evaluate();
    const changes = describeChanges(r.results.filter((x) => x.created));
    await refresh();
    say('ok', `${label}${changes.length ? ` ${changes.join('. ')}.` : ' Ninguna recomendación cambió.'}`);
  };

  const setFixed = (iso) => run('Cambiando la hora', async () => {
    await api.setEvaluationAt(iso);
    await afterClockChange('Hora de evaluación actualizada.');
  });
  const setClock = (body) => run('Cambiando el reloj', async () => {
    await api.setClock(body);
    await afterClockChange(body.mode === 'live' ? 'Reloj en vivo.' : body.mode === 'manifest' ? 'Se usa la hora del manifest.' : 'Reloj actualizado.');
  });
  const advance = (hours) => run('Adelantando el reloj', async () => {
    await api.advanceClock(hours);
    await afterClockChange(`Se simularon ${hours} h más.`);
  });

  const exportJson = () =>
    run('Exportando', async () => {
      const data = await api.exportJson();
      const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'recomendaciones.json';
      a.click();
      URL.revokeObjectURL(url);
      await refresh();
      say('ok', `Se exportaron ${data.length} recomendaciones.`);
    });

  const simulate = (event) =>
    run('Simulando evento', async () => {
      const r = await api.addEvent(selected, event);
      const changes = describeChanges(r.evaluated);
      await refresh({ focusCase: selected });
      say('ok', changes.length ? `Evento agregado. ${changes.join('. ')}.` : 'Evento agregado y caso reevaluado.');
    });

  const saveCustomer = (id, patch) =>
    run('Guardando ficha', async () => {
      const r = await api.updateCustomer(id, patch);
      const changes = describeChanges(r.evaluated);
      await refresh({ focusCustomer: id });
      say('ok', `Ficha guardada.${changes.length ? ` ${changes.join('. ')}.` : ' Ninguna recomendación cambió.'}`);
    });

  const setLearningMode = (mode) =>
    run('Cambiando el aprendizaje', async () => {
      await api.setLearning(mode);
      await refresh();
      say('ok', mode === 'off' ? 'Aprendizaje apagado: se usan los valores predeterminados.' : mode === 'on' ? 'Aprendizaje siempre activo.' : 'Aprendizaje automático: activo con el reloj en vivo.');
    });

  const reset = () =>
    run('Borrando datos', async () => {
      await api.reset();
      setUploadLog([]);
      setDetail(null);
      setSelected(null);
      setCustomerDetail(null);
      setSelectedCustomer(null);
      await refresh();
      say('ok', 'Se borraron todos los datos.');
    });

  const login = (pass) => {
    adminPassword.set(pass);
    api.auth().then((a) => {
      if (a.ok) setAuth({ checked: true, required: a.required, ok: true, error: null });
      else {
        adminPassword.set(null);
        setAuth({ checked: true, required: true, ok: false, error: 'Contraseña incorrecta.' });
      }
    }).catch((e) => setAuth((x) => ({ ...x, error: e.message })));
  };
  const logout = () => {
    adminPassword.set(null);
    setAuth({ checked: true, required: true, ok: false, error: null });
  };

  if (!auth.checked) return null;
  if (auth.required && !auth.ok) return <Login onSubmit={login} error={auth.error} />;

  const empty = cases.length === 0;
  const now = status?.clock?.evaluation_at;

  return (
    <div className="app">
      <TopBar
        status={status}
        busy={busy}
        tab={tab}
        onTab={goTab}
        onFiles={handleFiles}
        onEvaluate={evaluateAll}
        onExport={exportJson}
        onSetFixed={setFixed}
        onSetClock={setClock}
        onAdvance={advance}
        onToggleLoader={() => setShowLoader((v) => !v)}
        loaderOpen={showLoader}
        canAct={!empty}
        authRequired={auth.required}
        onLogout={logout}
      />

      {notice && (
        <div className={`notice notice-${notice.kind}`} role="status" aria-live="polite">
          <span>{notice.text}</span>
          <button type="button" className="link" onClick={() => setNotice(null)}>Cerrar</button>
        </div>
      )}

      {showLoader && (
        <LoadPanel
          empty={empty}
          status={status}
          uploadLog={uploadLog}
          onFiles={handleFiles}
          onKit={loadKitFile}
          onSeed={seedDemo}
          onReset={reset}
          busy={busy}
        />
      )}

      {tab === 'resumen' && (
        <main className="page">
          <Dashboard summary={summary} onOpenCase={openCase} onSeed={seedDemo} onKit={loadWholeKit} busy={busy} />
        </main>
      )}

      {tab === 'casos' && (empty ? (
        <main className="page">
          <Dashboard summary={summary} onOpenCase={openCase} onSeed={seedDemo} onKit={loadWholeKit} busy={busy} />
        </main>
      ) : (
        <main className="workspace">
          <CaseList cases={cases} selected={selected} onSelect={openCase} />
          {detail ? (
            <CaseView
              key={detail.case_id}
              detail={detail}
              evaluationAt={now}
              clockMode={status?.clock?.mode}
              onSimulate={simulate}
              onEvaluate={evaluateAll}
              busy={busy}
            />
          ) : (
            <section className="case-empty">Elige un caso de la lista.</section>
          )}
        </main>
      ))}

      {tab === 'aprendizaje' && (
        <main className="page">
          <Learning insights={insights} onSetMode={setLearningMode} onOpenCase={openCase} busy={busy} />
        </main>
      )}

      {tab === 'clientes' && (
        <Customers
          customers={customers}
          selectedId={selectedCustomer}
          detail={customerDetail}
          onSelect={selectCustomer}
          onSave={saveCustomer}
          onOpenCase={openCase}
          now={now}
          busy={busy}
        />
      )}
    </div>
  );
}
