# Sistema de login (ensamblado) — sistema propio + Google + Microsoft/Entra + MFA

**Categoría:** auth | **Cuándo usar:** TODA app web (cliente/servidor). OBLIGATORIO. Apps de escritorio
(monopuesto/local) NO llevan login. Este doc ENSAMBLA las piezas; las recetas detalladas de cada proveedor
están en sus ficheros.

## Base SIEMPRE presente (ya en el andamiaje `templates/server-app`)

Login con **sistema propio** (email + contraseña), listo y verificado. No lo recrees:
- `src/auth/tokens.ts` — sesión firmada HMAC-SHA256 con `node:crypto` (sin dependencias), en cookie httpOnly.
- `src/auth/guard.ts` — seguridad **global secure-by-default**: GET fuera de `/api` (la SPA) es público;
  todo `/api/*` exige sesión salvo `config: { publico: true }`; `config: { roles: [...] }` restringe por rol.
- `src/auth/routes.ts` — `/api/auth/login` (público), `/api/auth/me`, `/api/auth/logout`, `/api/auth/registro`
  (solo admin por defecto).
- `src/auth/seed.ts` — siembra el primer admin (bootstrap). Lo usa "Probar".
- `src/audit.ts` (+ tabla `audit_log`) — registra `usuario.login`/`logout`/etc. Ver `library/seguridad/audit-log.md`.
- Tabla `usuarios` con columnas ya previstas para lo demás: `google_id`, `microsoft_id`, `mfa_secret`.
- Front: `web/src/stores/auth.ts`, `web/src/router.ts` (guard), `web/src/views/LoginView.vue` (botones de
  proveedor ya maquetados, desactivados con `proveedoresExternos = false`).

> Regla de oro: la frontera de seguridad es el SERVIDOR (el guard + la cookie). El guard del router del front
> es solo UX. Cada proveedor que añadas debe terminar emitiendo **la MISMA cookie de sesión** (`firmarSesion` +
> `reply.setCookie(COOKIE_SESION, …)`), para que el resto de la app no tenga que distinguir cómo entró el usuario.

Patrón común al final del callback de CUALQUIER proveedor (Google/Microsoft), una vez identificado/creado el usuario:

```ts
// usuario ya resuelto (buscado o creado por google_id / microsoft_id)
const token = firmarSesion({ sub: usuario.id, email: usuario.email, rol: usuario.rol });
reply.setCookie(COOKIE_SESION, token, cookieOpts); // la MISMA cookie que el login local
return reply.redirect("/"); // a la app, ya con sesión
```

## Activar proveedores externos (solo si el ADR del proyecto los pide)

El usuario elige en lenguaje llano qué quiere; queda en el ADR de arquitectura. Para cada uno:

### Google
Sigue `library/auth/auth-google-oauth.md`. Crea `/api/auth/google` (redirige) y `/api/auth/google/callback`
(intercambia el code, busca/crea el usuario por `google_id`, emite la cookie de sesión, redirige a `/`).

### Microsoft / Entra ID
Sigue `library/auth/auth-microsoft-entra.md` (cubre cuentas de trabajo Y personales con tenant `common`).
Crea `/api/auth/microsoft` y `/api/auth/microsoft/callback` (busca/crea por `microsoft_id`, emite la cookie).

### MFA (TOTP)
Sigue `library/auth/auth-mfa-totp.md`. Se añade ENCIMA del login con contraseña: tras validar la contraseña, si
el usuario tiene `mfa_secret`, pide el código de 6 dígitos antes de emitir la cookie. Endpoints de alta
(`/api/auth/mfa/setup`, `/api/auth/mfa/activar`) y verificación.

### Encender los botones en la pantalla de login
Pon `proveedoresExternos = true` en `web/src/views/LoginView.vue` (o usa la versión completa de
`templates/web/login-view.md`). Los botones enlazan a `/api/auth/google` y `/api/auth/microsoft`.

## Gestión de cuentas y roles

- Roles: `admin` | `gestor` | `usuario` (amplía en `guard.ts` y la matriz). Marca el rol de cada endpoint con
  `config: { roles: [...] }`. Matriz de permisos y propietario-del-recurso: `library/auth/roles-middleware.md`.
- Alta de usuarios: por defecto solo admin (`/api/auth/registro`). Si el dominio necesita auto-registro, marca
  esa ruta como `{ publico: true }`.
- Pantalla de administración de usuarios (listar/crear/desactivar) y visor del registro de accesos: planifícalas
  como pantallas de rol admin cuando la app las necesite.

Relacionado: tema `library/ui/tema-tokens.md`, shell `library/ui/app-shell-sidebar.md`, pantalla
`templates/web/login-view.md`, auditoría `library/seguridad/audit-log.md`.
