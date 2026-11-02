import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const DEFAULT_MODEL = 'gemini-3.8-flash'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function publishableKey() {
  const modern = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')
  if (modern) {
    try {
      const parsed = JSON.parse(modern)
      if (parsed?.default) return parsed.default
    } catch {}
  }
  return Deno.env.get('SUPABASE_ANON_KEY') || ''
}

function parseDataUrl(value: string) {
  const m = String(value || '').match(/^data:([^;]+);base64,(.+)$/s)
  if (!m) throw new Error('Image de facture invalide.')
  return { mimeType: m[1], data: m[2] }
}

function parseJsonOnly(text: string) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
  try { return JSON.parse(cleaned) } catch {}
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1))
  throw new Error('Gemini n’a pas renvoyé un JSON exploitable.')
}

function responseText(data: any) {
  const parts = data?.candidates?.[0]?.content?.parts || []
  return parts.map((p: any) => typeof p?.text === 'string' ? p.text : '').join('').trim()
}

const prompt = `Tu es le moteur d'analyse visuelle de Recover, une application française de suivi de factures, achats, garanties et remboursements.

Analyse DIRECTEMENT les images de la facture. Le texte OCR et l'analyse locale fournis ensuite peuvent être désordonnés ou faux : utilise-les seulement comme aide.

Règles impératives :
- N'invente JAMAIS une information absente du document. Si elle n'est pas explicitement présente, mets null.
- Distingue date de commande, date de facture, date d'expédition, date de livraison/réception et date d'échéance.
- Distingue Total TTC, Total HT, taux de TVA, montant de TVA et numéro de TVA intracommunautaire.
- Un numéro de TVA comme FR78347384570 ou EE102465501 n'est jamais un montant.
- Le produit/service doit être la vraie ligne d'article ou prestation, jamais des conditions de vente, mentions légales, adresse, service client ou texte publicitaire.
- S'il n'y a pas de numéro de commande, orderNumber = null.
- S'il n'y a pas de date de livraison, deliveryDate = null.
- Pour une facture de magasin, ne transforme pas le numéro de facture en numéro de commande.
- Les montants sont des nombres JSON avec un point décimal, sans symbole monétaire.
- Les dates sont au format YYYY-MM-DD.
- category doit être l'une de : Achat, Télécom, Énergie, Assurance, Automobile, Hôtel, Transport, Abonnement, Service, Autre.
- documentType doit être l'un de : Facture, Ticket, Commande, Relevé, Devis, Autre.
- confidence contient un score entier de 0 à 100 pour chaque champ. Mets 95+ seulement si le champ est clairement lisible.
- evidence contient une preuve textuelle courte issue du document pour les champs principaux.
- Si plusieurs articles existent, product doit représenter l'article principal, généralement le plus important par montant, hors frais de port, éco-participation et remise.
- Pour une garantie, distingue garantie commerciale/réparation et garantie légale.

Retourne UNIQUEMENT un objet JSON valide ayant exactement ces clés :
{
  "merchant": string|null,
  "seller": string|null,
  "product": string|null,
  "category": string|null,
  "documentType": string|null,
  "price": number|null,
  "purchaseDate": string|null,
  "orderNumber": string|null,
  "invoiceDate": string|null,
  "deliveryDate": string|null,
  "shippingDate": string|null,
  "dueDate": string|null,
  "invoiceNumber": string|null,
  "clientNumber": string|null,
  "contractNumber": string|null,
  "ht": number|null,
  "vatRate": number|null,
  "vatAmount": number|null,
  "vatNumber": string|null,
  "paymentReference": string|null,
  "asin": string|null,
  "siret": string|null,
  "commercialWarrantyEnd": string|null,
  "legalWarrantyText": string|null,
  "confidence": {
    "merchant": number,
    "seller": number,
    "product": number,
    "category": number,
    "documentType": number,
    "price": number,
    "purchaseDate": number,
    "orderNumber": number,
    "invoiceDate": number,
    "deliveryDate": number,
    "shippingDate": number,
    "dueDate": number,
    "invoiceNumber": number,
    "clientNumber": number,
    "contractNumber": number,
    "ht": number,
    "vatRate": number,
    "vatAmount": number,
    "vatNumber": number,
    "paymentReference": number,
    "asin": number,
    "siret": number,
    "commercialWarrantyEnd": number,
    "legalWarrantyText": number
  },
  "evidence": {
    "merchant": string|null,
    "product": string|null,
    "price": string|null,
    "invoiceDate": string|null,
    "invoiceNumber": string|null,
    "orderNumber": string|null,
    "vat": string|null,
    "warranty": string|null
  }
}`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405)

  try {
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Authentification requise.' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const pubKey = publishableKey()
    if (!supabaseUrl || !pubKey) return json({ error: 'Configuration Supabase incomplète.' }, 500)

    const supabase = createClient(supabaseUrl, pubKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData?.user) return json({ error: 'Session Recover invalide.' }, 401)

    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) return json({ error: 'GEMINI_API_KEY n’est pas configurée dans Supabase Secrets.' }, 503)

    const body = await req.json()
    const images = Array.isArray(body?.images) ? body.images.slice(0, 2) : []
    if (!images.length) return json({ error: 'Aucune image de facture reçue.' }, 400)

    const extractedText = String(body?.extractedText || '').slice(0, 24000)
    const localAnalysis = body?.localAnalysis || {}
    const fileName = String(body?.fileName || 'document')

    const parts: any[] = [{
      text: [
        prompt,
        `\nNom du fichier : ${fileName}`,
        `\nAnalyse locale Recover (peut être fausse) :\n${JSON.stringify(localAnalysis)}`,
        `\nTexte extrait du document (peut être désordonné) :\n${extractedText}`,
      ].join('\n')
    }]

    for (const image of images) {
      if (typeof image !== 'string' || !image.startsWith('data:image/')) continue
      const parsed = parseDataUrl(image)
      parts.push({
        inlineData: {
          mimeType: parsed.mimeType,
          data: parsed.data,
        }
      })
    }

    if (parts.length < 2) return json({ error: 'Aucune image valide à analyser.' }, 400)

    const model = Deno.env.get('GEMINI_MODEL') || DEFAULT_MODEL
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0,
          maxOutputTokens: 3500,
        },
      }),
    })

    const responseData = await response.json().catch(() => null)
    if (!response.ok) {
      console.error('Gemini error', response.status, responseData)
      const detail = responseData?.error?.message || `Erreur Gemini ${response.status}`
      return json({ error: detail }, 502)
    }

    const text = responseText(responseData)
    if (!text) return json({ error: 'Gemini n’a renvoyé aucun résultat exploitable.' }, 502)

    const analysis = parseJsonOnly(text)
    return json({ analysis, model: `google/${model}`, provider: 'gemini' })
  } catch (error) {
    console.error(error)
    return json({ error: error instanceof Error ? error.message : 'Erreur interne Gemini.' }, 500)
  }
})
