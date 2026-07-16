# Pruebas

No hay tests unitarios. Lo que hay son **smoke tests de extremo a extremo**: cargan las
páginas reales en un DOM (jsdom) contra el servidor real y las manejan como lo haría una
persona (clics, formularios, tabs). Sirven para responder *"¿la página corre?"*, no
*"¿el JS parsea?"*.

## Cómo correrlos

```bash
npm run dev                    # el servidor DEBE estar arriba en :3002
npm install                    # jsdom es devDependency
npm run smoke                  # hogar + despensa (gratis, ~10s)
npm run smoke:plan             # calendario + generación IA REAL (~$0.014, ~60s)
```

## Qué necesitan

- Servidor en `http://localhost:3002`.
- El usuario de prueba **`fam@test.pe` / `prueba123`** con su hogar configurado y
  despensa con ingredientes (ver CLAUDE.md → "Datos de prueba").
- `smoke-hogar-despensa.js` **resetea** el hogar de prueba a un estado conocido
  (Casa Abanto + Rosa/Luis/Ana) antes de empezar: necesita conteos estables.

## Advertencias

- **`smoke:plan` gasta dinero**: dispara una generación de menú real contra Gemini.
  Usa una semana futura (`SEMANA`, agosto 2026) para tener cupo fresco y no pisar el
  plan de la semana actual; limpia sus casillas al terminar.
- El **cupo de generaciones es por semana del plan**. Si `smoke:plan` falla por 403,
  cambia `SEMANA` a otra fecha o sube `generaciones_max` del plan Free desde el admin.
- **Los tests deben limpiar lo que crean.** Si un ingrediente de prueba se queda en la
  despensa, la IA lo tomará como real y generará platos alrededor de él (ya pasó:
  apareció una "Infusión de Hierba de Prueba 1784060686397" en un menú).
- jsdom **no valida layout ni CSS**. Para eso, abre el navegador.

## Limitaciones conocidas

- No cubren: escáner con imagen, flujo de pago Yape, panel admin.
- Los conteos están hardcodeados (16 condiciones, 51 ingredientes del catálogo…): si
  cambias las semillas de `db.js`, ajústalos.
