import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const API_VERSION = '2024-11-30'
const MODEL_ID = 'prebuilt-invoice'

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

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function endpointBase(raw: string) {
  return raw.trim().replace(/\/+$/, '')
}

function dataUrlToBytes(dataUrl: string) {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/s)
  if (!m) throw new Error('Image de facture invalide.')
  const mime = m[1]
  const bin = atob(m[2])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { mime, bytes }
}

function pct(v: unknown) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n * 100))) : 0
}

function fieldContent(field: any): string | null {
  if (!field) return null
  if (typeof field.valueString === 'string') return field.valueString
  if (typeof field.valueDate === 'string') return field.valueDate
  if (typeof field.valueTime === 'string') return field.valueTime
  if (typeof field.valuePhoneNumber === 'string') return field.valuePhoneNumber
  if (typeof field.valueNumber === 'number') return String(field.valueNumber)
  if (typeof field.valueInteger === 'number') return String(field.valueInteger)
  if (field.valueCurrency && Number.isFinite(Number(field.valueCurrency.amount))) return String(field.valueCurrency.amount)
  if (typeof field.content === 'string' && field.content.trim()) return field.content.trim()
  return null
}

function numberValue(field: any): number | null {
  if (!field) return null
  if (field.valueCurrency && Number.isFinite(Number(field.valueCurrency.amount))) return Number(field.valueCurrency.amount)
  if (Number.isFinite(Number(field.valueNumber))) return Number(field.valueNumber)
  if (Number.isFinite(Number(field.valueInteger))) return Number(field.valueInteger)
  const raw = String(field.content || '').replace(/\u00a0/g, ' ')
  const m = raw.match(/-?\d[\d .]*[,.]\d{1,2}/)
  if (!m) return null
  const n = Number(m[0].replace(/\s/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function isoFromFrenchDate(raw: string | null) {
  if (!raw) return null
  const s = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/)
  if (!m) return null
  return `${m[3]}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`
}

function firstItem(fields: any) {
  const items = fields?.Items?.valueArray
  if (!Array.isArray(items)) return { description: null, confidence: 0 }
  const candidates = items.map((item: any) => {
    const obj = item?.valueObject || {}
    const desc = fieldContent(obj.Description)
    const amount = numberValue(obj.Amount) ?? numberValue(obj.UnitPrice) ?? 0
    const confidence = pct(obj.Description?.confidence || item?.confidence || 0)
    return { description: desc, amount, confidence }
  }).filter((x: any) => x.description && !/frais de port|eco[- ]?part|remise|livraison|shipping|taxe?\b/i.test(x.description))
  candidates.sort((a: any, b: any) => (b.amount - a.amount) || (b.description.length - a.description.length))
  return candidates[0] || { description: null, confidence: 0 }
}

function classify(vendor: string | null, product: string | null, content: string) {
  const s = `${vendor || ''} ${product || ''} ${content.slice(0, 5000)}`.toLowerCase()
  if (/orange|sfr|bouygues telecom|free mobile|forfait|fibre|abonnement mobile/.test(s)) return 'Télécom'
  if (/edf|engie|totalenergies|electricit[eé]|gaz|\bkwh\b/.test(s)) return 'Énergie'
  if (/assurance|cotisation|sinistre/.test(s)) return 'Assurance'
  if (/garage|immatriculation|vidange|pneu|kilom[eè]trage/.test(s)) return 'Automobile'
  if (/hotel|hôtel|booking|chambre|nuit[eé]e/.test(s)) return 'Hôtel'
  if (/sncf|air france|billet|train|vol\b/.test(s)) return 'Transport'
  return 'Achat'
}

function extractSiret(content: string) {
  const m = content.match(/\bSIRET\s*[:.]?\s*((?:\d[ .]?){14,18})/i)
  if (!m) return null
  const digits = m[1].replace(/\D/g, '').slice(0, 14)
  return digits.length === 14 ? digits : null
}

function extractAsin(content: string) {
  const m = content.match(/\bASIN\s*[:：]?\s*([A-Z0-9]{10})\b/i)
  return m ? m[1].toUpperCase() : null
}

function warrantyFields(content: string) {
  const commercial = content.match(/garantie\s+(?:r[eé]paration|commerciale)[^\n]{0,60}?(\d{1,2}[./-]\d{1,2}[./-]\d{4})/i)
  const legal = content.match(/garantie\s+l[eé]gale\s+de\s+conformit[eé][^\n]{0,120}(?:\n[^\n]{0,120})?/i)
  return {
    commercialWarrantyEnd: commercial ? isoFromFrenchDate(commercial[1]) : null,
    legalWarrantyText: legal ? legal[0].replace(/\s+/g, ' ').trim().slice(0, 220) : null,
  }
}

function taxDetails(fields: any, subtotal: number | null, totalTax: number | null) {
  let rate: number | null = null
  let amount = totalTax
  const arr = fields?.TaxDetails?.valueArray
  if (Array.isArray(arr) && arr.length) {
    const obj = arr[0]?.valueObject || {}
    const r = numberValue(obj.Rate)
    const a = numberValue(obj.Amount)
    if (r != null) rate = r > 1 ? r : r * 100
    if (a != null) amount = a
  }
  if (rate == null && subtotal != null && amount != null && subtotal !== 0) {
    const derived = amount / subtotal * 100
    if (derived >= 0 && derived <= 100) rate = Math.round(derived * 100) / 100
  }
  return { rate, amount }
}

async function azureAnalyze(endpoint: string, key: string, dataUrl: string) {
  const { mime, bytes } = dataUrlToBytes(dataUrl)
  const analyzeUrl = `${endpointBase(endpoint)}/documentintelligence/documentModels/${MODEL_ID}:analyze?api-version=${API_VERSION}&locale=fr-FR`
  const start = await fetch(analyzeUrl, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': mime,
    },
    body: bytes,
  })
  if (start.status !== 202) {
    const detail = await start.text()
    throw new Error(`Azure Document Intelligence ${start.status}: ${detail.slice(0, 600)}`)
  }
  const operationLocation = start.headers.get('operation-location') || start.headers.get('Operation-Location')
  if (!operationLocation) throw new Error('Azure n’a pas renvoyé Operation-Location.')

  for (let i = 0; i < 25; i++) {
    await sleep(i < 2 ? 700 : 1000)
    const r = await fetch(operationLocation, {
      headers: { 'Ocp-Apim-Subscription-Key': key },
    })
    const data = await r.json().catch(() => null)
    if (!r.ok) throw new Error(`Azure Document Intelligence ${r.status}: ${JSON.stringify(data).slice(0, 600)}`)
    const status = String(data?.status || '').toLowerCase()
    if (status === 'succeeded') return data
    if (status === 'failed') throw new Error(`Analyse Azure échouée: ${JSON.stringify(data?.error || data).slice(0, 600)}`)
  }
  throw new Error('Azure Document Intelligence a dépassé le délai d’analyse.')
}

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

    const azureEndpoint = Deno.env.get('AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT')
    const azureKey = Deno.env.get('AZURE_DOCUMENT_INTELLIGENCE_KEY')
    if (!azureEndpoint || !azureKey) {
      return json({ error: 'Azure Document Intelligence n’est pas configuré dans les secrets Supabase.' }, 503)
    }

    const body = await req.json()
    const images = Array.isArray(body?.images) ? body.images : []
    const firstImage = images.find((x: unknown) => typeof x === 'string' && String(x).startsWith('data:image/'))
    if (!firstImage) return json({ error: 'Aucune image de facture reçue.' }, 400)

    const localAnalysis = body?.localAnalysis || {}
    const result = await azureAnalyze(azureEndpoint, azureKey, firstImage)
    const analyzeResult = result?.analyzeResult || {}
    const doc = analyzeResult?.documents?.[0] || {}
    const fields = doc?.fields || {}
    const content = String(analyzeResult?.content || '')

    const get = (name: string) => fields?.[name] || null
    const vendor = fieldContent(get('VendorName'))
    const invoiceDate = fieldContent(get('InvoiceDate'))
    const invoiceId = fieldContent(get('InvoiceId'))
    const customerId = fieldContent(get('CustomerId'))
    const purchaseOrder = fieldContent(get('PurchaseOrder'))
    const dueDate = fieldContent(get('DueDate'))
    const subtotal = numberValue(get('SubTotal'))
    const totalTax = numberValue(get('TotalTax'))
    const invoiceTotal = numberValue(get('InvoiceTotal')) ?? numberValue(get('AmountDue'))
    const vendorTaxId = fieldContent(get('VendorTaxId'))
    const item = firstItem(fields)
    const tax = taxDetails(fields, subtotal, totalTax)
    const warranties = warrantyFields(content)
    const category = classify(vendor, item.description, content)

    const resolvedInvoiceDate = invoiceDate ? isoFromFrenchDate(invoiceDate) || invoiceDate : null
    const localPurchaseDate = localAnalysis?.purchaseDate || null

    const analysis = {
      merchant: vendor,
      seller: vendor,
      product: item.description,
      category,
      documentType: 'Facture',
      price: invoiceTotal,
      purchaseDate: localPurchaseDate ? null : resolvedInvoiceDate,
      orderNumber: purchaseOrder,
      invoiceDate: resolvedInvoiceDate,
      deliveryDate: null,
      shippingDate: null,
      dueDate: dueDate ? isoFromFrenchDate(dueDate) || dueDate : null,
      invoiceNumber: invoiceId,
      clientNumber: customerId,
      contractNumber: null,
      ht: subtotal,
      vatRate: tax.rate,
      vatAmount: tax.amount,
      vatNumber: vendorTaxId ? vendorTaxId.replace(/\s+/g, '') : null,
      paymentReference: null,
      asin: extractAsin(content),
      siret: extractSiret(content),
      commercialWarrantyEnd: warranties.commercialWarrantyEnd,
      legalWarrantyText: warranties.legalWarrantyText,
      confidence: {
        merchant: pct(get('VendorName')?.confidence),
        seller: pct(get('VendorName')?.confidence),
        product: item.confidence,
        category: 82,
        documentType: 98,
        price: pct(get('InvoiceTotal')?.confidence || get('AmountDue')?.confidence),
        purchaseDate: localPurchaseDate ? 0 : pct(get('InvoiceDate')?.confidence),
        orderNumber: pct(get('PurchaseOrder')?.confidence),
        invoiceDate: pct(get('InvoiceDate')?.confidence),
        deliveryDate: 0,
        shippingDate: 0,
        dueDate: pct(get('DueDate')?.confidence),
        invoiceNumber: pct(get('InvoiceId')?.confidence),
        clientNumber: pct(get('CustomerId')?.confidence),
        contractNumber: 0,
        ht: pct(get('SubTotal')?.confidence),
        vatRate: tax.rate != null ? 85 : 0,
        vatAmount: pct(get('TotalTax')?.confidence),
        vatNumber: pct(get('VendorTaxId')?.confidence),
        paymentReference: 0,
        asin: extractAsin(content) ? 90 : 0,
        siret: extractSiret(content) ? 94 : 0,
        commercialWarrantyEnd: warranties.commercialWarrantyEnd ? 88 : 0,
        legalWarrantyText: warranties.legalWarrantyText ? 88 : 0,
      },
      evidence: {
        merchant: get('VendorName')?.content || vendor,
        product: item.description,
        price: get('InvoiceTotal')?.content || get('AmountDue')?.content || null,
        invoiceDate: get('InvoiceDate')?.content || null,
        invoiceNumber: get('InvoiceId')?.content || null,
        orderNumber: get('PurchaseOrder')?.content || null,
        vat: get('TotalTax')?.content || null,
        warranty: warranties.commercialWarrantyEnd || warranties.legalWarrantyText || null,
      },
    }

    return json({ analysis, model: `azure-document-intelligence/${MODEL_ID}`, provider: 'azure' })
  } catch (error) {
    console.error(error)
    return json({ error: error instanceof Error ? error.message : 'Erreur interne Azure Document Intelligence.' }, 502)
  }
})
