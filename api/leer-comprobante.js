// Cordova - Area de Caja
// Funcion serverless (Vercel) que lee una foto de comprobante de transferencia
// usando la API de Claude (vision) y devuelve los datos extraidos.
// La clave ANTHROPIC_API_KEY se configura como variable de entorno en Vercel,
// nunca se expone en el HTML ni en el navegador.
//
// IMPORTANTE: este archivo debe subirse a GitHub dentro de una carpeta
// llamada "api", con el nombre api/leer-comprobante.js (Vercel detecta
// automaticamente cualquier archivo dentro de /api como una funcion).

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Metodo no permitido" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Falta configurar ANTHROPIC_API_KEY en Vercel" });
    return;
  }

  try {
    const { imageBase64, mediaType } = req.body || {};
    if (!imageBase64) {
      res.status(400).json({ error: "Falta la imagen" });
      return;
    }

    const prompt = `Eres un asistente experto leyendo fotos de comprobantes de transferencias bancarias colombianas (Nequi, Daviplata, Bancolombia, Davivienda, BBVA, Banco de Bogota, etc.), tomadas por meseros con el celular en un restaurante, muchas veces con afan.
Analiza la imagen y responde UNICAMENTE con un objeto JSON valido, sin texto antes ni despues, exactamente con esta forma:
{"legible": true, "monto": 45000, "entidad": "Nequi", "fecha": "2026-08-01", "referencia": "123456"}

Esfuerzate al maximo por leer el monto aunque la foto no sea perfecta: borrosa, inclinada, con reflejos de luz, mal encuadrada, con el dedo tapando una esquina, con poca luz, o con la pantalla del celular fotografiada en angulo. Usa el contexto de la imagen (formato tipico de estos comprobantes, simbolo $, la palabra "Enviaste"/"Pagaste"/"Transferiste"/"Monto", cuantos digitos tiene, separadores de miles) para inferir el monto con la mayor confianza posible, igual que lo haria una persona mirando la foto con atencion. No te rindas solo porque la imagen no sea perfecta.

Reglas:
- "legible" solo debe ser false si de verdad es imposible determinar el monto: la imagen esta completamente negra, no es un comprobante de transferencia, o el numero del monto esta totalmente tapado/cortado/ilegible incluso haciendo el mejor esfuerzo.
- Si tienes duda razonable pero puedes leer el monto con bastante confianza, responde "legible": true con ese monto (no seas excesivamente estricto).
- Si "legible" es false, los demas campos deben ir en null.
- "monto" debe ser solo el numero en pesos colombianos, sin simbolos, sin puntos ni comas (ejemplo: 45000).
- "fecha" en formato AAAA-MM-DD si aparece en el comprobante, si no, null.
- "referencia" es el numero de referencia o comprobante si aparece, si no, null.
- No expliques nada, no agregues texto fuera del JSON.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        // Se usa Sonnet (no Haiku) porque lee mucho mejor fotos imperfectas
        // (borrosas, inclinadas, con reflejo), que es el caso mas comun aqui.
        model: "claude-sonnet-5",
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: imageBase64 } },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      res.status(response.status).json({ error: (data && data.error && data.error.message) || "Error llamando a Claude" });
      return;
    }

    const textOut = (data.content && data.content[0] && data.content[0].text) || "";
    let parsed;
    try {
      const match = textOut.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match ? match[0] : textOut);
    } catch (e) {
      parsed = { legible: false, monto: null, entidad: null, fecha: null, referencia: null };
    }

    res.status(200).json({
      legible: parsed.legible === true,
      monto: typeof parsed.monto === "number" ? parsed.monto : null,
      entidad: parsed.entidad || null,
      fecha: parsed.fecha || null,
      referencia: parsed.referencia || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Error inesperado" });
  }
}
