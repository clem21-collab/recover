import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MODEL = 'mistral-ocr-latest'

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

function clamp(v: unknown) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0
}

function cleanJsonText(raw: unknown) {
  const s = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  try { return JSON.parse(s) } catch {}
  const a = s.indexOf('{'), b = s.lastIndexOf('}')
  if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1))
  throw new Error('Mistral n’a pas renvoyé de JSON exploitable.')
}

function normalizeAnalysis(a: any, pageConfidence = 0) {
  const confidence = a?.confidence || {}
  const cap = pageConfidence > 0 ? Math.round(pageConfidence * 100) : 100
  const c = (name: string) => Math.min(cap, clamp(confidence[name]))
  const nullable = (v: unknown) => v === '' || v === undefined ? null : v
  const num = (v: unknown) => {
    if (v === null || v === undefined || v === '') return null
    const n = Number(String(v).replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  return {
    merchant: nullable(a?.merchant),
    seller: nullable(a?.seller),
    product: nullable(a?.product),
    category: nullable(a?.category) || 'Achat',
    documentType: nullable(a?.documentType) || 'Facture',
    price: num(a?.price),
    purchaseDate: nullable(a?.purchaseDate),
    orderNumber: nullable(a?.orderNumber),
    invoiceDate: nullable(a?.invoiceDate),
    deliveryDate: nullable(a?.deliveryDate),
    shippingDate: nullable(a?.shippingDate),
    dueDate: nullable(a?.dueDate),
    invoiceNumber: nullable(a?.invoiceNumber),
    clientNumber: nullable(a?.clientNumber),
    contractNumber: nullable(a?.contractNumber),
    ht: num(a?.ht),
    vatRate: num(a?.vatRate),
    vatAmount: num(a?.vatAmount),
    vatNumber: nullable(a?.vatNumber),
    paymentReference: nullable(a?.paymentReference),
    asin: nullable(a?.asin),
    siret: nullable(a?.siret),
    commercialWarrantyEnd: nullable(a?.commercialWarrantyEnd),
    legalWarrantyText: nullable(a?.legalWarrantyText),
    confidence: {
      merchant: c('merchant'), seller: c('seller'), product: c('product'),
      category: c('category'), documentType: c('documentType'), price: c('price'),
      purchaseDate: c('purchaseDate'), orderNumber: c('orderNumber'),
      invoiceDate: c('invoiceDate'), deliveryDate: c('deliveryDate'),
      shippingDate: c('shippingDate'), dueDate: c('dueDate'),
      invoiceNumber: c('invoiceNumber'), clientNumber: c('clientNumber'),
      contractNumber: c('contractNumber'), ht: c('ht'), vatRate: c('vatRate'),
      vatAmount: c('vatAmount'), vatNumber: c('vatNumber'),
      paymentReference: c('paymentReference'), asin: c('asin'), siret: c('siret'),
      commercialWarrantyEnd: c('commercialWarrantyEnd'), legalWarrantyText: c('legalWarrantyText')
    },
    evidence: a?.evidence || {}
  }
}

const annotationPrompt = `Analyse cette facture ou ce justificatif d'achat en français.
Retourne UNIQUEMENT un objet JSON valide. N'invente jamais une donnée absente : utilise null.

Règles :
- Le produit doit être la vraie ligne d'article/prestation, jamais des conditions de vente, une adresse ou une mention légale.
- Distingue Total TTC, Total HT, taux de TVA, montant de TVA et numéro de TVA.
- Un numéro de TVA n'est jamais un montant.
- Distingue date de facture, date de commande, date d'expédition, date de livraison/réception et échéance.
- S'il n'y a pas de numéro de commande ou de date de livraison, renvoie null.
- Les dates sont YYYY-MM-DD et les montants sont des nombres sans symbole monétaire.
- category: Achat, Télécom, Énergie, Assurance, Automobile, Hôtel, Transport, Abonnement, Service ou Autre.
- documentType: Facture, Ticket, Commande, Relevé, Devis ou Autre.
- confidence contient des scores de 0 à 100. 95+ uniquement si le champ est clairement lisible.
- evidence contient de courtes preuves textuelles visibles dans le document.

Structure exacte :
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
    "merchant": number, "seller": number, "product": number, "category": number,
    "documentType": number, "price": number, "purchaseDate": number,
    "orderNumber": number, "invoiceDate": number, "deliveryDate": number,
    "shippingDate": number, "dueDate": number, "invoiceNumber": number,
    "clientNumber": number, "contractNumber": number, "ht": number,
    "vatRate": number, "vatAmount": number, "vatNumber": number,
    "paymentReference": number, "asin": number, "siret": number,
    "commercialWarrantyEnd": number, "legalWarrantyText": number
  },
  "evidence": {
    "merchant": string|null, "product": string|null, "price": string|null,
    "invoiceDate": string|null, "invoiceNumber": string|null,
    "orderNumber": string|null, "vat": string|null, "warranty": string|null
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

    const mistralKey = Deno.env.get('MISTRAL_API_KEY')
    if (!mistralKey) return json({ error: 'MISTRAL_API_KEY n’est pas configurée dans les secrets Supabase.' }, 503)

    const body = await req.json()
    const images = Array.isArray(body?.images) ? body.images : []
    const firstImage = images.find((x: unknown) => typeof x === 'string' && String(x).startsWith('data:image/'))
    if (!firstImage) return json({ error: 'Aucune image de facture reçue.' }, 400)

    const response = await fetch('https://api.mistral.ai/v1/ocr', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${mistralKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        document: { type: 'image_url', image_url: firstImage },
        document_annotation_format: { type: 'json_object' },
        document_annotation_prompt: annotationPrompt,
        confidence_scores_granularity: 'page',
        include_blocks: true,
        extract_header: true,
        extract_footer: true
      })
    })

    const data = await response.json().catch(() => null)
    if (!response.ok) {
      console.error('Mistral OCR error', response.status, data)
      return json({ error: data?.message || data?.detail || `Erreur Mistral OCR ${response.status}` }, 502)
    }

    if (!data?.document_annotation) return json({ error: 'Mistral n’a pas renvoyé d’analyse structurée.' }, 502)
    const raw = cleanJsonText(data.document_annotation)
    const pageConfidence = Number(data?.pages?.[0]?.confidence_scores?.average_page_confidence_score || 0)
    const analysis = normalizeAnalysis(raw, pageConfidence)

    return json({ analysis, model: data?.model || MODEL, provider: 'mistral' })
  } catch (error) {
    console.error(error)
    return json({ error: error instanceof Error ? error.message : 'Erreur interne Mistral OCR.' }, 500)
  }
})
