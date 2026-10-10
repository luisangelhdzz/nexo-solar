import { useState } from 'react';

export default function Login({ onSubmit, error }) {
  const [value, setValue] = useState('');
  return (
    <main className="login">
      <form
        className="login-card"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(value);
        }}
      >
        <span className="brand-mark" aria-hidden="true" />
        <h1>Consola de Nexo Solar</h1>
        <p className="muted">Solo para el equipo comercial. El portal del cliente está en <a href="/portal">/portal</a>.</p>
        <label htmlFor="admin-pass">Contraseña</label>
        <input id="admin-pass" type="password" autoComplete="current-password" value={value} onChange={(e) => setValue(e.target.value)} required />
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary">Entrar</button>
      </form>
    </main>
  );
}
