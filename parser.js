(function(){
const monthMap={janvier:1,janv:1,jan:1,'février':2,fevrier:2,'févr':2,fevr:2,mar:3,mars:3,avril:4,avr:4,mai:5,juin:6,juillet:7,juil:7,'août':8,aout:8,septembre:9,sept:9,octobre:10,oct:10,novembre:11,nov:11,'décembre':12,decembre:12,'déc':12,dec:12};
const clean=s=>(s||'').replace(/\u00a0/g,' ').replace(/[ ]+/g,' ').trim();
const norm=s=>clean(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const escRe=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function parseDate(v){if(!v)return'';let s=clean(v).replace(/[,]/g,' ');let m=s.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/);if(m){let y=+m[3];if(y<100)y+=2000;return `${y.toString().padStart(4,'0')}-${(+m[2]).toString().padStart(2,'0')}-${(+m[1]).toString().padStart(2,'0')}`;}m=s.match(/\b(\d{1,2})\s+(jan(?:vier|v)?|f[ée]vr(?:ier)?|mars?|avr(?:il)?|mai|juin|juil(?:let)?|ao[uû]t|sept(?:embre)?|oct(?:obre)?|nov(?:embre)?|d[ée]c(?:embre)?)\.?\s+(\d{4})\b/i);if(m){let mm=monthMap[norm(m[2])]||monthMap[norm(m[2]).replace(/\.$/,'')];if(mm)return `${m[3]}-${String(mm).padStart(2,'0')}-${String(+m[1]).padStart(2,'0')}`;}return''}
function amount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  const text = String(value ?? '')
    .replace(/[\u00a0\u202f ]/g, '')
    .replace(/(?:EUR|€)$/i, '');
  if (!/^-?\d+(?:[.,]\d{3})*(?:[.,]\d{1,2})?$/.test(text)) return null;
  const decimal = text.match(/[.,]\d{1,2}$/)?.[0];
  const integer = decimal ? text.slice(0, -decimal.length) : text;
  const number = Number(integer.replace(/[.,]/g, '') + (decimal ? '.' + decimal.slice(1) : ''));
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
}
function splitRows(text) {
  return (text || '')
    .replace(/\r/g, '\n')
    .split(/\n+/)
    .map((raw) => ({ raw: raw.trim(), cells: raw.split('\t').map(clean) }))
    .filter((r) => r.raw && r.cells.length);
}
function afterLabel(cell,label){let re=new RegExp(escRe(label).replace(/\\ /g,'\\s+'),'i');let m=cell.match(re);if(!m)return'';return clean(cell.slice((m.index||0)+m[0].length).replace(/^[\s:：#\-–—/]+/,''))}
function valueFromRow(rows,labels,parser=x=>clean(x),distance=1){for(let i=0;i<rows.length;i++){let row=rows[i];for(let c=0;c<row.cells.length;c++){let cell=row.cells[c],nc=norm(cell);for(const lab of labels){if(!nc.includes(norm(lab)))continue;let inline=afterLabel(cell,lab);let v=parser(inline);if(v)return{value:v,row:i,cell:c,raw:row.raw,label:lab};for(let k=c+1;k<row.cells.length;k++){v=parser(row.cells[k]);if(v)return{value:v,row:i,cell:k,raw:row.raw,label:lab};}for(let d=1;d<=distance;d++){let nr=rows[i+d];if(!nr)break;if(nr.cells.length<=2){for(const nc2 of nr.cells){v=parser(nc2);if(v)return{value:v,row:i+d,cell:0,raw:nr.raw,label:lab};}}}}
}}
return null}
function dateValue(rows, labels) {
  return labeledField(rows, labels, validDateValue);
}
function moneyValue(rows, labels) {
  return labeledField(rows, labels, (value) => {
    const text = clean(value)
      .replace(/^\d{1,2}(?:[,.]\d+)?\s*%\s*[:：]?\s*/, '')
      .replace(/\s*(?:EUR|€)\s*$/i, '');
    return /^-?\d[\d .\u202f]*(?:[,.]\d{2})?$/.test(text) ? amount(text) : null;
  });
}
function idValue(rows, labels) {
  return labeledField(rows, labels, identifier);
}
const orderLabels = ['numéro de la commande', 'numéro de commande', 'n° de commande', 'n° commande', 'commande n°', 'order number', 'order #'];
const purchaseLabels = ['date de la commande', 'date de commande', 'date commande', 'commande passée le', 'order date', 'date d’achat', "date d'achat", 'date achat'];
const invoiceLabels = ['numéro de la facture', 'numéro de facture', 'n° de facture', 'n° facture', 'facture n°', 'invoice no', 'invoice #'];
const paymentLabels = ['moyen de paiement', 'mode de paiement'];

function labeledField(rows, labels, parseValue) {
  const ordered = [...labels].sort((a, b) => b.length - a.length);
  const usable = (value) => value !== '' && value !== null && value !== undefined;
  for (const [index, row] of rows.entries())
    for (const [column, cell] of row.cells.entries()) {
      const normalized = norm(cell).replace(/’/g, "'");
      const label = ordered.find((value) => {
        const key = norm(value).replace(/’/g, "'");
        return (
          normalized.startsWith(key) &&
          (!normalized[key.length] || /[\s:：#–—-]/.test(normalized[key.length]))
        );
      });
      if (!label) continue;
      const remainder = clean(cell.slice(label.length)).replace(/^[:：\s]+/, '');
      const inline = parseValue(remainder);
      if (usable(inline)) return { value: inline, row: index, source: 'label' };
      if (remainder) continue;
      const adjacent = column === 0 && row.cells.length === 2 ? parseValue(row.cells[1]) : null;
      if (usable(adjacent)) return { value: adjacent, row: index, source: 'label' };
      const next = rows[index + 1];
      if (!next || next.cells.length !== row.cells.length) continue;
      const below = parseValue(next.cells[column]);
      if (usable(below)) return { value: below, row: index + 1, source: 'column' };
    }
  return null;
}
function identifier(value = '') {
  const id = clean(value).replace(/^#\s*/, '');
  return !/^(?:commande|facture|reference|référence|client)$/i.test(id) &&
    !/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(id) &&
    /^[A-Z0-9][A-Z0-9_./-]{2,39}$/i.test(id) &&
    (/\d/.test(id) || /^[A-Z]{5,}$/.test(id)) ? id : '';
}

function orderNumber(rows) {
  const labeled = labeledField(rows, orderLabels, value => identifier(value.replace(/\s*-\s*/g, '-')));
  if (labeled) return labeled.value;
  for (const row of rows) {
    const match = row.raw.match(/\b\d{3}\s*-\s*\d{7}\s*-\s*\d{7}\b/);
    if (match) return match[0].replace(/\s/g, '');
  }
  return '';
}

function invoiceHeader(rows) {
  for (let index = 0; index < Math.min(rows.length, 8); index++) {
    const match = rows[index].raw.match(/^#\s*([A-Z]{1,5}\d{3,})$/i);
    if (!match) continue;
    const date = [rows[index - 1], rows[index + 1]]
      .map(row => row && /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(row.raw) ? isoDate(row.raw) : '')
      .find(Boolean);
    if (date) return { number: '#' + match[1], date };
  }
  return null;
}

function detectMerchant(rows) {
  const explicit = labeledField(
    rows,
    ['marchand', 'plateforme', 'merchant', 'émetteur', 'emetteur', 'fournisseur'],
    companyName,
  );
  if (explicit) return { value: explicit.value, confidence: 85 };
  const brands = [
    'Amazon',
    'Orange',
    'SFR',
    'Free',
    'Bouygues Telecom',
    'Engie',
    'EDF',
    'TotalEnergies',
    'Promovap',
    'Boulanger',
    'Darty',
    'Fnac',
    'Cdiscount',
    'IKEA',
    'Leroy Merlin',
    'Castorama',
    'Carrefour',
    'Auchan',
    'E.Leclerc',
    'Intermarché',
    'Decathlon',
    'Booking.com',
    'Air France',
    'SNCF',
    'Apple',
    'Samsung',
    'Google',
    'Microsoft',
  ];
  for (const row of rows.slice(0, 8)) {
    if (row.cells.length !== 1) continue;
    const line = norm(row.cells[0]);
    for (const brand of brands) {
      const key = norm(brand);
      if (
        line === key ||
        line.startsWith(key + ' eu ') ||
        line.startsWith(key + ' sas') ||
        line.startsWith(key + ' france') ||
        line.startsWith('www.' + key + '.')
      )
        return { value: brand, confidence: 88 };
    }
  }
  const first = rows[0]?.cells;
  return first?.length === 1 && companyName(first[0])
    ? { value: companyName(first[0]), confidence: 50 }
    : { value: 'Prestataire non identifié', confidence: 0 };
}
function docType(text){let n=norm(text);if(/\bdevis\b|quotation/.test(n))return'Devis';if(/ticket de caisse|\bticket\b/.test(n))return'Ticket';if(/releve|statement/.test(n))return'Relevé';if(/confirmation de commande/.test(n)&&!/facture/.test(n))return'Commande';return'Facture'}
function category(text){let n=norm(text);if(/telecom|forfait|mobile|internet|fibre|orange|sfr|bouygues|free/.test(n))return'Télécom';if(/electricite|gaz|kwh|engie|edf|totalenergies/.test(n))return'Énergie';if(/assurance|cotisation|sinistre/.test(n))return'Assurance';if(/garage|vehicule|immatriculation|kilometrage|pneu|vidange/.test(n))return'Automobile';if(/hotel|booking|nuit|chambre/.test(n))return'Hôtel';if(/train|sncf|vol|air france|billet/.test(n))return'Transport';if(/abonnement|mensuel|subscription/.test(n))return'Abonnement';return'Achat'}
function findVatSummary(rows){for(let i=0;i<rows.length;i++){let n=norm(rows[i].cells.join(' '));if(n.includes('taux tva')&&n.includes('total ht')&&/\btva\b/.test(n)){for(let j=i+1;j<=Math.min(i+4,rows.length-1);j++){let s=rows[j].cells.join(' ');let rate=(s.match(/(\d{1,2}(?:[,.]\d+)?)\s*%/)||[])[1];let monies=(s.match(/\d[\d .]*[,.]\d{2}\s*€/g)||[]).map(amount).filter(v=>v!==null);if(rate&&monies.length>=2)return{vatRate:+rate.replace(',','.'),ht:monies[0],vatAmount:monies[monies.length-1]};}}
}return null}
function productHeading(value) {
  return /^(?:produit(?: \/ reference)?|reference|description|designation|article|qte|quantite|prix.*|total.*|ht|ttc)$/.test(norm(value));
}

function tableItems(rows) {
  const items = [];
  for (const [index, row] of rows.entries()) {
    const description = row.cells.findIndex((cell) =>
      /^(?:produit(?: \/ reference)?|description|designation|article|prestation|libelle)$/.test(norm(cell)),
    );
    const total = row.cells.findIndex((cell) => /^(?:total|montant)(?: \(?ttc\)?)?$/.test(norm(cell)));
    const quantity = row.cells.findIndex((cell) => /^(?:qte|quantite)$/.test(norm(cell)));
    if (description < 0 || total < 0) continue;
    for (const next of rows.slice(index + 1)) {
      const text = clean(next.cells[description] || '');
      if (items.length && next.cells.length === 1 && description === 0 && validProduct(text)) {
        items[items.length - 1].description = clean(items[items.length - 1].description + ' ' + text);
        continue;
      }
      if (next.cells.length !== row.cells.length || !validProduct(text)) break;
      const count = quantity < 0 ? null : amount(next.cells[quantity]);
      items.push({
        description: text,
        quantity: count > 0 ? count : null,
        totalTTC: amount(next.cells[total]),
      });
      if (items.length >= 12) break;
    }
    if (items.length) return items;
  }
  return items;
}
function extractProduct(rows) {
  const items = tableItems(rows);
  if (items.length) return { value: items[0].description, confidence: 90 };
  for (const [index, row] of rows.entries()) {
    const column = row.cells.findIndex((cell) =>
      /^(?:produit(?: \/ reference)?|description|designation|article|prestation|libelle)$/.test(norm(cell)),
    );
    if (column < 0 || !row.cells.some((cell) => /^(?:prix|qte|quantite|total|montant)\b/.test(norm(cell))))
      continue;
    const parts = [];
    for (const next of rows.slice(index + 1, index + 7)) {
      if (!parts.length && next.cells.length !== row.cells.length) break;
      const candidate = clean(next.cells[column] || '');
      if (!validProduct(candidate)) break;
      if (parts.length && next.cells.length > 1) break;
      parts.push(candidate);
      if (column !== 0) break;
    }
    if (parts.length) return { value: clean(parts.join(' ')), confidence: 90 };
  }
  const labeled = labeledField(
    rows,
    ['produit / référence', 'désignation', 'description', 'article', 'produit', 'prestation', 'libellé'],
    (value) => (validProduct(value) ? clean(value) : ''),
  );
  if (labeled) return { value: labeled.value, confidence: 85 };
  const candidate = rows
    .slice(1)
    .filter((row) => row.cells.length === 1)
    .map((row) => row.cells[0])
    .find((value) => validProduct(value) && /\d/.test(value));
  return { value: candidate || 'Achat / service', confidence: candidate ? 50 : 0 };
}
function safeGenericFields(rows) {
  const fields = new Map();
  const extraLabels = /^(?:devise|currency|conditions de paiement|conditions de reglement|incoterm|code promotionnel|code promo)$/;
  for (const row of rows) {
    for (const [column, cell] of row.cells.entries()) {
      const [label, ...rest] = cell.split(/[:：]/);
      const key = norm(label);
      if (!extraLabels.test(key) || fields.has(key)) continue;
      const value = clean(rest.join(':') || (row.cells.length === 2 ? row.cells[column + 1] : ''));
      if (value && value.length <= 140 && !/^https?:/i.test(value)) fields.set(key, { label: clean(label), value });
    }
  }
  return [...fields.values()];
}
function isoDate(value) {
  return validDateValue(value);
}
function validDateValue(value) {
  const text = String(value || '');
  const iso = text.match(/\b\d{4}-\d{2}-\d{2}\b/);
  const result = iso ? iso[0] : parseDate(text);
  if (!result) return '';
  const date = new Date(result + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === result ? result : '';
}
function companyName(value) {
  const text = clean(value);
  return text.length >= 3 &&
    text.length <= 100 &&
    /\p{L}/u.test(text) &&
    !/facture|invoice|client|adresse|commande|total|tva|paiement|livraison|^\d|@|https?:/i.test(text)
    ? text
    : '';
}
function validProduct(value) {
  return (
    typeof value === 'string' &&
    value.length >= 5 &&
    value.length <= 300 &&
    /\p{L}/u.test(value) &&
    !productHeading(value) &&
    !/facture|commande|client|adresse|total|tva|date|paiement|livraison|siret|siren|mentions legales|conditions generales|https?:|@|^\d+\s+(?:rue|avenue|boulevard|route|impasse)|^\d{5}\b/i.test(
      norm(value),
    )
  );
}
function parse(text){let rows=splitRows(text),all=rows.map(r=>r.raw.replace(/\t+/g,' ')).join('\n'),merchantResult=detectMerchant(rows),merchant=merchantResult.value;
const header = invoiceHeader(rows);
let purchase = labeledField(rows, purchaseLabels, validDateValue);
let invoice = labeledField(rows, ['date de la facture','date de facture','date facture','invoice date','émise le'], validDateValue)
  || (header && { value: header.date });
let shipping=dateValue(rows,['date d’expédition',"date d'expédition",'date de l’expédition','date expedition','expédié le','expedie le','shipped']);
let delivery=dateValue(rows,['date de la livraison','date de livraison','date de réception','date reception','livré le','livre le','reçu le','recu le']);
let due=dateValue(rows,['date d’échéance','date echeance','échéance','echeance','due date']);
let total=moneyValue(rows,['facture total','total ttc','net à payer','net a payer','montant total','total à payer','total a payer','total de la commande','total facture','grand total','amount due']);
// Ne jamais prendre « Total Produits HT » ou « Total Taxes » pour le montant à payer.
if(!total){for(const row of rows){let t=row.cells.join(' ');if(/^\s*total\s*[:：]\s*-?\d/i.test(t)||/^\s*total\s+-?\d/i.test(t)){let vals=t.match(/-?\d[\d .]*[,.]\d{2}\s*€?/g)||[];if(vals.length){total={value:amount(vals[vals.length-1])};break}}}}
if(!total)total=moneyValue(rows,['total']);
let ht=moneyValue(rows,['total ht','montant ht','hors taxe']);
let vatAmount=moneyValue(rows,['tva','montant tva','total taxes','total taxe','tva à payer','tva a payer','tax amount']);
let vatRate=null;for(const r of rows){let s=r.cells.join(' '),m=s.match(/(?:taux\s+(?:de\s+)?)?tva\s*[:：]?\s*(\d{1,2}(?:[,.]\d+)?)\s*%/i);if(m){vatRate=+m[1].replace(',','.');break}m=s.match(/(\d{1,2}(?:[,.]\d+)?)\s*%\s*(?:tva|taxe)/i);if(m){vatRate=+m[1].replace(',','.');break}}
let summary=findVatSummary(rows);if(summary){if(ht==null||ht.value===null)ht={value:summary.ht};if(vatAmount==null||vatAmount.value===null)vatAmount={value:summary.vatAmount};if(vatRate==null)vatRate=summary.vatRate}
let vatNumber='';for(const r of rows){let s=r.cells.join(' '),m=s.match(/(?:n(?:um[ée]ro)?\s*)?(?:de\s*)?tva\s*(?:intracommunautaire)?\s*[:：]?\s*([A-Z]{2}[A-Z0-9 .-]{6,20})/i);if(m){let v=m[1].replace(/\s/g,'').replace(/[.,;:]$/,'');if(/[A-Z]/i.test(v)&&/\d/.test(v)){vatNumber=v;break}}}
let invoiceNo = labeledField(rows, invoiceLabels, identifier) || (header && { value: header.number });
let clientNo=idValue(rows,['numéro client','numero client','n° client','référence client','reference client'],2);
let contractNo=idValue(rows,['numéro de contrat','numero de contrat','n° contrat','contrat n°'],3);
let seller=labeledField(rows,['vendu par','seller','vendeur'],companyName);
let paymentReference=idValue(rows,['référence de paiement','reference de paiement','payment reference'],5);
let asin=valueFromRow(rows,['asin'],v=>{let m=String(v||'').match(/\b[A-Z0-9]{8,14}\b/i);return m?m[0]:''},0);
let siret='';let ms=all.match(/\bSIRET\s*[:：]?\s*(\d[\d ]{12,18})/i);if(ms)siret=ms[1].replace(/\s/g,'').slice(0,14);let siren='';ms=all.match(/\bSIREN\s*[:：]?\s*(\d[\d ]{7,12})/i);if(ms)siren=ms[1].replace(/\s/g,'').slice(0,9);
// Sous-totaux explicites de produits : à ne pas confondre avec le total HT global.
let itemsHT=moneyValue(rows,['total produits ht','sous-total produits ht','total articles ht']);
let itemsTTC=moneyValue(rows,['total produits ttc','sous-total produits ttc','total articles ttc']);
let shippingTTC=moneyValue(rows,["frais d'expédition","frais d’expédition","frais de livraison","frais de port","livraison ttc"]);
let discountTTC=moneyValue(rows,['remise commerciale','remise appliquée','réduction totale','remise','réduction']);
const paymentMethod = labeledField(rows, paymentLabels, value =>
  value?.match(/\b(e-Transactions|PayPal|Carte bancaire|Carte bleue|Virement|Prélèvement|Apple Pay|Google Pay)\b/i)?.[1]
)?.value || '';
let carrier='';
const carrierMatch=all.match(/\b(Colissimo(?: Domicile(?: sans signature)?)?|Chronopost|Mondial Relay|Colis Privé|DHL|UPS|DPD|GLS|La Poste)\b/i);
if(carrierMatch)carrier=carrierMatch[1];
let billingPeriod='';
const periodMatch=all.match(/\b(?:période|periode)\s+(?:de facturation\s+)?du\s+(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})\s+au\s+(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})/i);
if(periodMatch)billingPeriod=periodMatch[1]+' au '+periodMatch[2];
if(itemsHT&&shippingTTC&&shippingTTC.value>0&&ht&&Math.abs(ht.value-itemsHT.value)<0.02)ht=null;
const extractedProduct=extractProduct(rows);
let product=extractedProduct.value,ord=orderNumber(rows);
const warranty=labeledField(rows,['garantie réparation jusqu’au',"garantie réparation jusqu'au",'garantie commerciale jusqu’au'],validDateValue);
const fieldConfidence={product:extractedProduct.confidence,merchant:merchantResult.confidence};

let confidence={merchant:merchantResult.confidence,product:extractedProduct.confidence,price:total?92:35,date:purchase?94:invoice?82:35,order:ord?98:35};
if(total&&ht&&vatAmount&&Math.abs((ht.value+vatAmount.value)-total.value)<0.03)confidence.price=99;else if(total&&vatRate!=null&&ht&&Math.abs(ht.value*(1+vatRate/100)-total.value)<0.08)confidence.price=98;
const detected={seller:seller?.value,invoiceNumber:invoiceNo?.value,clientNumber:clientNo?.value,contractNumber:contractNo?.value,
 purchaseDate:purchase?.value||invoice?.value,invoiceDate:invoice?.value,shippingDate:shipping?.value,deliveryDate:delivery?.value,
 dueDate:due?.value,price:total?.value,ht:ht?.value,vatAmount:vatAmount?.value,vatRate,
 commercialWarrantyEnd:warranty?.value,orderNumber:ord};
for(const[key,value]of Object.entries(detected))if(value!==undefined&&value!==null&&value!=='')fieldConfidence[key]=85;
let generic = safeGenericFields(rows);
return{fieldConfidence,commercialWarrantyEnd:warranty?.value||'',merchant,product,price:total?total.value:null,purchaseDate:purchase?purchase.value:(invoice?invoice.value:''),orderNumber:ord,documentType:docType(all),category:category(all),invoiceDate:invoice?invoice.value:'',shippingDate:shipping?shipping.value:'',deliveryDate:delivery?delivery.value:'',dueDate:due?due.value:'',invoiceNumber:invoiceNo?invoiceNo.value:'',clientNumber:clientNo?clientNo.value:'',contractNumber:contractNo?contractNo.value:'',ht:ht?ht.value:null,itemsSubtotalHT:itemsHT?itemsHT.value:null,itemsSubtotalTTC:itemsTTC?itemsTTC.value:null,shippingTTC:shippingTTC?shippingTTC.value:null,discountTTC:discountTTC?Math.abs(discountTTC.value):null,lineItems:tableItems(rows),paymentMethod,carrier,billingPeriod,vatAmount:vatAmount?vatAmount.value:null,vatRate,vatNumber,siret,siren,seller:seller?seller.value:'',paymentReference:paymentReference?paymentReference.value:'',asin:asin?asin.value:'',confidence,genericFields:generic,rawText:all};}
window.RecoverParser={parse,isoDate,amount};
})();
