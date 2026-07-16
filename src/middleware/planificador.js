// Gates del planificador (hogar, despensa, platos, plan de comidas).
//
// requierePlanificador -> el plan del usuario incluye la funcion (403 upgrade si no).
// requiereHogar        -> ademas, el hogar ya esta configurado (409 si no).
//
// Se separan porque hogar.routes SOLO necesita el primero: si exigiera el segundo,
// no habria forma de configurar el hogar (gallina y huevo).

function requierePlanificador(req, res, next) {
  if (!req.usuario.incluye_planificador) {
    return res.status(403).json({
      error: 'Tu plan no incluye el plan de comidas.',
      upgrade: true,
      redirect: '/mi-plan.html',
    });
  }
  next();
}

// Sin hogar configurado la IA no puede proponer nada (no sabe cuantos son, ni sus
// condiciones, ni la region). 409 = falta un paso previo, no es un error de permisos.
function requiereHogar(req, res, next) {
  if (!req.usuario.hogar_configurado) {
    return res.status(409).json({
      error: 'Configura tu hogar antes de continuar.',
      necesita_hogar: true,
      redirect: '/hogar.html',
    });
  }
  next();
}

module.exports = { requierePlanificador, requiereHogar };
