// JSON con llaves ordenadas: sirve para comparar contenido sin importar el orden de las llaves.
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sameEventContent(a, b) {
  return stableStringify([a.case_id, a.event_type, a.occurred_at, a.data]) === stableStringify([b.case_id, b.event_type, b.occurred_at, b.data]);
}
