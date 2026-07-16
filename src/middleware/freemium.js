// El "candado freemium" del escaner de productos: controla el consumo de IA segun el plan.
//
//  - ilimitado (admin o plan sin tope) -> paso libre, sin descuento.
//  - plan con tope -> revisa analisis_restantes.
//        > 0  : permite (el descuento se aplica SOLO si el analisis tuvo exito).
//        == 0 : bloquea con 402 (Payment Required) -> redirige al paywall.
//
// Importante: NO se descuenta aqui. Se adjunta req.consumirAnalisis(), que la ruta llama
// unicamente cuando la IA respondio bien, para no cobrar analisis fallidos.
const { db } = require('../db');

// Descuento atomico de un analisis. Devuelve los restantes. No toca a ilimitados/admin.
function descontarAnalisis(usuario) {
  if (usuario.ilimitado) return usuario.analisis_restantes;
  db.prepare('UPDATE usuarios SET analisis_restantes = analisis_restantes - 1 WHERE id = ? AND analisis_restantes > 0').run(usuario.id);
  const fila = db.prepare('SELECT analisis_restantes FROM usuarios WHERE id = ?').get(usuario.id);
  return fila ? fila.analisis_restantes : 0;
}

function candadoFreemium(req, res, next) {
  const usuario = req.usuario;

  if (usuario.ilimitado) {
    req.consumirAnalisis = () => usuario.analisis_restantes;
    return next();
  }

  if (usuario.analisis_restantes <= 0) {
    return res.status(402).json({
      error: 'Has agotado tus analisis gratuitos.',
      paywall: true,
      redirect: '/mi-plan.html',
    });
  }

  req.consumirAnalisis = () => descontarAnalisis(usuario);
  next();
}

module.exports = { candadoFreemium, descontarAnalisis };
