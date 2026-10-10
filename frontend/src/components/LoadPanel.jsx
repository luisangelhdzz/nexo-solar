import { useState } from 'react';
import { fmtUtc } from '../format.js';

function UploadResult({ item }) {
  if (item.kind === 'manifest') {
    return (
      <li className="upload-item">
        <strong>{item.file}</strong>
        <span>Hora de evaluación: {fmtUtc(item.evaluation_at)}</span>
      </li>
    );
  }
  return (
    <li className="upload-item">
      <strong>{item.file}</strong>
      <span>
        {item.accepted} aceptados, {item.duplicates?.length ?? 0} duplicados ignorados, {item.errors?.length ?? 0} con error
      </span>
      {item.duplicates?.length > 0 && (
        <ul className="upload-sub">
          {item.duplicates.map((d) => (
            <li key={`${d.event_id}-${d.line}`}>
              Línea {d.line}: {d.event_id} ya existía{d.same_content ? '' : ' (con contenido distinto)'}; se ignoró.
            </li>
          ))}
        </ul>
      )}
      {item.errors?.length > 0 && (
        <ul className="upload-sub upload-errors">
          {item.errors.map((e) => (
            <li key={e.line}>Línea {e.line}: {e.errors.join('; ')}</li>
          ))}
        </ul>
      )}
      {item.evaluation_note && <p className="upload-note">{item.evaluation_note}</p>}
    </li>
  );
}

export default function LoadPanel({ empty, status, uploadLog, onFiles, onKit, onSeed, onReset, busy }) {
  const [over, setOver] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <section className="loader" aria-label="Carga de archivos">
      <div
        className={`dropzone ${over ? 'dropzone-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files);
        }}
      >
        <h2>{empty ? 'Carga los eventos para empezar' : 'Cargar más eventos'}</h2>
        <p>
          Arrastra aquí <code>manifest.json</code> y uno o más archivos <code>.jsonl</code>. Se cargan en orden:
          primero el manifest, luego los eventos y al final las actualizaciones. Los casos afectados se reevalúan solos.
        </p>
        {!status?.evaluation_at && <p className="upload-note">Falta la hora de evaluación: incluye manifest.json.</p>}
      </div>

      <div className="loader-side">
        <h3>Datos de demostración del portal</h3>
        <p className="muted">Seis empresas ficticias con historial de compras y cotizaciones activas. Activa el reloj en vivo.</p>
        <div className="kit-buttons">
          <button type="button" className="btn btn-small btn-primary" disabled={Boolean(busy)} onClick={onSeed}>Cargar datos de demostración</button>
          <a className="btn btn-small" href="/portal" target="_blank" rel="noreferrer">Abrir el portal</a>
        </div>

        <h3>Kit público del reto</h3>
        <p className="muted">Atajo para la demostración con los archivos de la carpeta <code>kit/</code>.</p>
        <div className="kit-buttons">
          <button type="button" className="btn btn-small" disabled={Boolean(busy)} onClick={() => onKit('manifest.json')}>1. manifest.json</button>
          <button type="button" className="btn btn-small" disabled={Boolean(busy)} onClick={() => onKit('events.jsonl')}>2. events.jsonl</button>
          <button type="button" className="btn btn-small" disabled={Boolean(busy)} onClick={() => onKit('updates.jsonl')}>3. updates.jsonl</button>
        </div>

        {uploadLog.length > 0 && (
          <>
            <h3>Últimas cargas</h3>
            <ul className="upload-list">
              {uploadLog.map((item, i) => (
                <UploadResult key={`${item.file}-${i}`} item={item} />
              ))}
            </ul>
          </>
        )}

        {!empty && (
          <div className="reset">
            {confirmReset ? (
              <>
                <span>Se borrarán eventos y decisiones.</span>
                <button type="button" className="btn btn-small btn-danger" onClick={() => { setConfirmReset(false); onReset(); }}>Borrar todo</button>
                <button type="button" className="link" onClick={() => setConfirmReset(false)}>Cancelar</button>
              </>
            ) : (
              <button type="button" className="link" onClick={() => setConfirmReset(true)}>Borrar todos los datos</button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
