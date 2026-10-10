// "Ventana de paciencia": cuánto tiempo lleva la cotización frente al tiempo habitual del cliente.
// Un solo valor sobre una pista: no necesita leyenda; el texto dice qué es.
export default function PatienceMeter({ openedAt, windowEnd, nowIso, typicalHours }) {
  if (!openedAt || !windowEnd || !nowIso) return null;
  const total = (new Date(windowEnd) - new Date(openedAt)) / 3600000;
  const elapsed = Math.max(0, (new Date(nowIso) - new Date(openedAt)) / 3600000);
  const pct = Math.max(0, Math.min(100, (elapsed / total) * 100));
  const typicalPct = typicalHours ? Math.max(0, Math.min(100, (typicalHours / total) * 100)) : null;
  const over = elapsed >= total;
  return (
    <div className="meter" role="img" aria-label={`Lleva ${Math.round(elapsed)} de ${Math.round(total)} horas de su ventana de espera`}>
      <div className="meter-head">
        <span>Lleva <strong>{Math.round(elapsed)} h</strong> de <strong>{Math.round(total)} h</strong> de espera</span>
        <span className={over ? 'meter-state meter-over' : 'meter-state'}>{over ? 'Ya pasó su tiempo habitual' : 'Dentro de su tiempo habitual'}</span>
      </div>
      <div className="meter-track">
        <div className={`meter-fill ${over ? 'meter-fill-over' : ''}`} style={{ width: `${pct}%` }} />
        {typicalPct !== null && <div className="meter-mark" style={{ left: `${typicalPct}%` }} title={`Tiempo típico: ${Math.round(typicalHours)} h`} />}
      </div>
      {typicalPct !== null && (
        <div className="meter-foot muted small">
          La marca es su tiempo típico ({Math.round(typicalHours)} h); la ventana agrega {Math.max(0, Math.round((total / typicalHours - 1) * 100))}% de margen.
        </div>
      )}
    </div>
  );
}
