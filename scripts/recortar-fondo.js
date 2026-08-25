// Quita el fondo BLANCO de un PNG y lo deja transparente.
//
//   node scripts/recortar-fondo.js public/img/favicon.png public/img/favicon.png
//   node scripts/recortar-fondo.js entrada.png salida.png [umbral]
//
// 🔴 POR QUE INUNDACION DESDE LOS BORDES Y NO "QUITAR TODO LO BLANCO":
// el arte de la marca es un chef con GORRO Y CASACA BLANCOS. Un borrado global del blanco lo
// agujerea. Aqui solo se vuelve transparente el blanco CONECTADO con el borde de la imagen: el
// del gorro esta rodeado por el cuerpo, asi que se conserva.
//
// Va en Node puro (zlib) a proposito: en la maquina de desarrollo no hay ImageMagick, ni sharp,
// ni PIL. Cubre lo que necesita este repo: 8 bits, RGBA o RGB, sin entrelazado.
//
// Los ORIGINALES de marca (con su fondo blanco) viven en archivos/ y se versionan: si hay que
// volver a recortar con otro umbral, se parte de ahi y no de un PNG ya recortado.
const fs = require('fs');
const zlib = require('zlib');

const FIRMA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function leer(buf) {
  if (!buf.subarray(0, 8).equals(FIRMA)) throw new Error('no es un PNG');
  let i = 8, ancho = 0, alto = 0, prof = 0, tipo = 0, entrelazado = 0;
  const idat = [];
  while (i < buf.length) {
    const largo = buf.readUInt32BE(i);
    const nombre = buf.toString('ascii', i + 4, i + 8);
    const datos = buf.subarray(i + 8, i + 8 + largo);
    if (nombre === 'IHDR') {
      ancho = datos.readUInt32BE(0); alto = datos.readUInt32BE(4);
      prof = datos[8]; tipo = datos[9]; entrelazado = datos[12];
    } else if (nombre === 'IDAT') idat.push(datos);
    else if (nombre === 'IEND') break;
    i += 12 + largo;
  }
  if (prof !== 8 || (tipo !== 6 && tipo !== 2)) throw new Error(`PNG no soportado: ${prof} bits, tipo ${tipo}`);
  if (entrelazado) throw new Error('PNG entrelazado, no soportado');

  const canales = tipo === 6 ? 4 : 3;
  const crudo = zlib.inflateSync(Buffer.concat(idat));
  const linea = ancho * canales;
  const px = Buffer.alloc(ancho * alto * 4);
  let ant = Buffer.alloc(linea);
  for (let y = 0; y < alto; y++) {
    const filtro = crudo[y * (linea + 1)];
    const fila = Buffer.from(crudo.subarray(y * (linea + 1) + 1, y * (linea + 1) + 1 + linea));
    for (let x = 0; x < linea; x++) {
      const a = x >= canales ? fila[x - canales] : 0;
      const b = ant[x];
      const c = x >= canales ? ant[x - canales] : 0;
      let v = fila[x];
      if (filtro === 1) v += a;
      else if (filtro === 2) v += b;
      else if (filtro === 3) v += (a + b) >> 1;
      else if (filtro === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      fila[x] = v & 0xff;
    }
    for (let x = 0; x < ancho; x++) {
      const o = (y * ancho + x) * 4, f = x * canales;
      px[o] = fila[f]; px[o + 1] = fila[f + 1]; px[o + 2] = fila[f + 2];
      px[o + 3] = canales === 4 ? fila[f + 3] : 255;
    }
    ant = fila;
  }
  return { ancho, alto, px };
}

function crc32(buf) {
  let tabla = crc32.tabla;
  if (!tabla) {
    tabla = crc32.tabla = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tabla[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = tabla[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function trozo(nombre, datos) {
  const largo = Buffer.alloc(4); largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(nombre, 'ascii'), datos]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}

function escribir({ ancho, alto, px }) {
  const linea = ancho * 4;
  const crudo = Buffer.alloc((linea + 1) * alto);
  for (let y = 0; y < alto; y++) {
    crudo[y * (linea + 1)] = 0;
    px.copy(crudo, y * (linea + 1) + 1, y * linea, (y + 1) * linea);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0); ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([FIRMA, trozo('IHDR', ihdr), trozo('IDAT', zlib.deflateSync(crudo, { level: 9 })), trozo('IEND', Buffer.alloc(0))]);
}

function recortar(entrada, salida, umbral = 236) {
  const SATURACION = 12; // un blanco de verdad tiene los tres canales casi iguales
  const { ancho, alto, px } = leer(fs.readFileSync(entrada));

  const esBlanco = (i) => {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    return r >= umbral && g >= umbral && b >= umbral
      && Math.max(r, g, b) - Math.min(r, g, b) <= SATURACION;
  };

  const fuera = new Uint8Array(ancho * alto);
  const pila = [];
  for (let x = 0; x < ancho; x++) pila.push(x, (alto - 1) * ancho + x);
  for (let y = 0; y < alto; y++) pila.push(y * ancho, y * ancho + ancho - 1);
  while (pila.length) {
    const i = pila.pop();
    if (fuera[i] || !esBlanco(i)) continue;
    fuera[i] = 1;
    const x = i % ancho, y = (i / ancho) | 0;
    if (x > 0) pila.push(i - 1);
    if (x < ancho - 1) pila.push(i + 1);
    if (y > 0) pila.push(i - ancho);
    if (y < alto - 1) pila.push(i + ancho);
  }

  let quitados = 0;
  for (let i = 0; i < ancho * alto; i++) if (fuera[i]) { px[i * 4 + 3] = 0; quitados++; }

  // El halo. Los pixeles del contorno son una mezcla del dibujo con el blanco del fondo
  // (antialiasing): dejarlos opacos pinta un borde blanco sobre cualquier fondo oscuro.
  let suavizados = 0;
  const copia = Buffer.from(px);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const i = y * ancho + x;
      if (fuera[i]) continue;
      const pegado = (x > 0 && fuera[i - 1]) || (x < ancho - 1 && fuera[i + 1])
        || (y > 0 && fuera[i - ancho]) || (y < alto - 1 && fuera[i + ancho]);
      if (!pegado) continue;
      const claro = Math.min(copia[i * 4], copia[i * 4 + 1], copia[i * 4 + 2]);
      if (claro < 200) continue; // ya es color de verdad
      px[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(255 * (255 - claro) / 55)));
      suavizados++;
    }
  }

  fs.writeFileSync(salida, escribir({ ancho, alto, px }));
  return { ancho, alto, quitados, suavizados, total: ancho * alto };
}

if (require.main === module) {
  const [entrada, salida, umbral] = process.argv.slice(2);
  if (!entrada || !salida) {
    console.error('uso: node scripts/recortar-fondo.js entrada.png salida.png [umbral]');
    process.exit(1);
  }
  const r = recortar(entrada, salida, Number(umbral) || 236);
  console.log(`${entrada} -> ${salida}`);
  console.log(`  ${r.ancho}x${r.alto} · ${r.quitados} pixel(es) de fondo a transparente `
    + `(${(100 * r.quitados / r.total).toFixed(1)}%) · ${r.suavizados} del contorno suavizados`);
}

module.exports = { leer, escribir, recortar };
