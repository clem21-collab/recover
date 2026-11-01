import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

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

function extractResponseText(data: any) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim()
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content?.text === 'string') return content.text.trim()
    }
  }
  return ''
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
  throw new Error('La réponse IA ne contient pas de JSON exploitable.')
}

const prompt = `Tu es le moteur de lecture visuelle de Recover, une application française de suivi de factures et remboursements.
Analyse DIRECTEMENT les images du document et utilise le texte OCR fourni seulement comme aide.

Règles impératives :
- N'invente jamais une information absente du document. Si elle n'est pas explicitement présente, renvoie null.
- Distingue soigneusement : date de commande, date de facture, date de livraison/réception, date d'expédition et date d'échéance.
- Distingue : Total TTC, Total HT, taux de TVA, montant de TVA et numéro de TVA intracommunautaire.
- Un numéro de TVA (ex. FR123..., EE123...) n'est JAMAIS un montant.
- Le produit/service doit être la vraie ligne d'article ou prestation, jamais une mention légale, une condition de vente, une adresse ou un texte de service client.
- Si aucun numéro de commande n'est présent, orderNumber doit être null.
- Si aucune date de livraison n'est présente, deliveryDate doit être null.
- Pour les garanties, ne confonds pas garantie légale et garantie commerciale.
- Les montants sont des nombres JSON avec un point décimal, sans symbole €.
- Les dates sont au format YYYY-MM-DD.
- La catégorie peut être : Achat, Télécom, Énergie, Assurance, Automobile, Hôtel, Transport, Abonnement, Service, Autre.
- documentType peut être : Facture, Ticket, Commande, Relevé, Devis, Autre.
- confidence contient un score de 0 à 100 pour chaque champ. 95+ seulement si le champ est clairement visible.
- evidence contient une courte preuve textuelle recopiée du document pour les champs importants, sans inventer.

Retourne UNIQUEMENT un objet JSON valide avec exactement cette structure :
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

    const apiKey = Deno.env.get('OPENAI_API_KEY')
    if (!apiKey) return json({ error: 'OPENAI_API_KEY n’est pas configurée dans les secrets Supabase.' }, 503)

    const body = await req.json()
    const images = Array.isArray(body?.images) ? body.images.slice(0, 2) : []
    if (!images.length) return json({ error: 'Aucune image de facture reçue.' }, 400)

    const extractedText = String(body?.extractedText || '').slice(0, 24000)
    const localAnalysis = body?.localAnalysis || {}
    const contextText = [
      prompt,
      `\nNom du fichier : ${String(body?.fileName || 'document')}`,
      `\nAnalyse locale Recover (peut contenir des erreurs) :\n${JSON.stringify(localAnalysis)}`,
      `\nTexte extrait du document (peut être désordonné) :\n${extractedText}`,
    ].join('\n')

    const content: any[] = [{ type: 'input_text', text: contextText }]
    for (const image of images) {
      if (typeof image === 'string' && image.startsWith('data:image/')) {
        content.push({ type: 'input_image', image_url: image, detail: 'high' })
      }
    }

    const model = Deno.env.get('OPENAI_MODEL') || 'gpt-4.1-mini'
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: [{ role: 'user', content }],
        max_output_tokens: 2200,
      }),
    })

    const responseData = await response.json()
    if (!response.ok) {
      console.error('OpenAI error', response.status, responseData)
      return json({ error: responseData?.error?.message || 'Erreur du service IA.' }, 502)
    }

    const outputText = extractResponseText(responseData)
    if (!outputText) return json({ error: 'L’IA n’a renvoyé aucun résultat exploitable.' }, 502)
    const analysis = parseJsonOnly(outputText)

    return json({ analysis, model })
  } catch (error) {
    console.error(error)
    return json({ error: error instanceof Error ? error.message : 'Erreur interne IA visuelle.' }, 500)
  }
})
