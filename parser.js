(function(){
const monthMap={janvier:1,janv:1,jan:1,'février':2,fevrier:2,'févr':2,fevr:2,mar:3,mars:3,avril:4,avr:4,mai:5,juin:6,juillet:7,juil:7,'août':8,aout:8,septembre:9,sept:9,octobre:10,oct:10,novembre:11,nov:11,'décembre':12,decembre:12,'déc':12,dec:12};
const clean=s=>(s||'').replace(/\u00a0/g,' ').replace(/[ ]+/g,' ').trim();
const norm=s=>clean(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const escRe=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function isoDate(v){if(!v)return'';let s=clean(v).replace(/[,]/g,' ');let m=s.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/);if(m){let y=+m[3];if(y<100)y+=2000;return `${y.toString().padStart(4,'0')}-${(+m[2]).toString().padStart(2,'0')}-${(+m[1]).toString().padStart(2,'0')}`;}m=s.match(/\b(\d{1,2})\s+(jan(?:vier|v)?|f[ée]vr(?:ier)?|mars?|avr(?:il)?|mai|juin|juil(?:let)?|ao[uû]t|sept(?:embre)?|oct(?:obre)?|nov(?:embre)?|d[ée]c(?:embre)?)\.?\s+(\d{4})\b/i);if(m){let mm=monthMap[norm(m[2])]||monthMap[norm(m[2]).replace(/\.$/,'')];if(mm)return `${m[3]}-${String(mm).padStart(2,'0')}-${String(+m[1]).padStart(2,'0')}`;}return''}
function amount(v){if(v===null||v===undefined)return null;let s=String(v).replace(/\u00a0/g,' ').replace(/[^\d,.-]/g,'').replace(/\.(?=\d{3}\b)/g,'').replace(',','.');let n=parseFloat(s);return Number.isFinite(n)?Math.round(n*100)/100:null}
function splitRows(text){return (text||'').replace(/\r/g,'\n').split(/\n+/).map(raw=>({raw:raw.trim(),cells:raw.split(/\t+/).map(clean).filter(Boolean)})).filter(r=>r.raw&&r.cells.length)}
function afterLabel(cell,label){let re=new RegExp(escRe(label).replace(/\\ /g,'\\s+'),'i');let m=cell.match(re);if(!m)return'';return clean(cell.slice((m.index||0)+m[0].length).replace(/^[\s:：#\-–—/]+/,''))}
function valueFromRow(rows,labels,parser=x=>clean(x),distance=1){for(let i=0;i<rows.length;i++){let row=rows[i];for(let c=0;c<row.cells.length;c++){let cell=row.cells[c],nc=norm(cell);for(const lab of labels){if(!nc.includes(norm(lab)))continue;let inline=afterLabel(cell,lab);let v=parser(inline);if(v)return{value:v,row:i,cell:c,raw:row.raw,label:lab};for(let k=c+1;k<row.cells.length;k++){v=parser(row.cells[k]);if(v)return{value:v,row:i,cell:k,raw:row.raw,label:lab};}for(let d=1;d<=distance;d++){let nr=rows[i+d];if(!nr)break;if(nr.cells.length<=2){for(const nc2 of nr.cells){v=parser(nc2);if(v)return{value:v,row:i+d,cell:0,raw:nr.raw,label:lab};}}}}
}}
return null}
function dateValue(rows,labels){return valueFromRow(rows,labels,isoDate,1)}
function moneyValue(rows,labels){return valueFromRow(rows,labels,v=>{let m=String(v||'').match(/-?\d[\d .]*[,.]\d{2}\s*€?|\b\d+\s*€/g)||[];if(!m.length)return null;return amount(m[m.length-1]);},1)}
function idValue(rows,labels,min=3){return valueFromRow(rows,labels,v=>{let m=String(v||'').match(new RegExp(`[A-Z0-9][A-Z0-9\\-_/]{${min},}`,'i'));return m?m[0]:''},1)}
const orderLabels = ['numéro de la commande', 'numéro de commande', 'n° de commande', 'n° commande', 'commande n°', 'order number', 'order #'];
const purchaseLabels = ['date de la commande', 'date de commande', 'date commande', 'commande passée le', 'order date', 'date d’achat', 'date achat'];
const invoiceLabels = ['numéro de la facture', 'numéro de facture', 'n° de facture', 'n° facture', 'facture n°', 'invoice no', 'invoice #'];
const paymentLabels = ['moyen de paiement', 'mode de paiement'];

function labeledField(rows, labels, parseValue) {
  for (const [index, row] of rows.entries()) {
    for (const [column, cell] of row.cells.entries()) {
      const label = labels.find(value => norm(cell).startsWith(norm(value)));
      if (!label) continue;
      const remainder = clean(cell.slice(label.length));
      if (remainder && !/^[\s:：#–—-]/.test(cell.slice(label.length))) continue;
      const inline = parseValue(remainder.replace(/^[:：\s]+/, ''));
      if (inline) return { value: inline };
      if (!/^[:：\s]*$/.test(remainder)) continue;
      const nextRow = rows[index + 1];
      // A row of labels maps to the same columns in the following row.
      const adjacent = row.cells.length === 2 && column === 0 ? parseValue(row.cells[1]) : '';
      const below = nextRow?.cells.length === row.cells.length ? parseValue(nextRow.cells[column]) : '';
      const value = adjacent || below;
      if (value) return { value };
    }
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

function detectMerchant(rows){let lines=rows.map(r=>clean(r.cells.join(' ')));const known=[['amazon','Amazon'],['orange','Orange'],['sfr','SFR'],['free','Free'],['bouygues telecom','Bouygues Telecom'],['engie','Engie'],['edf','EDF'],['totalenergies','TotalEnergies'],['promovap','Promovap'],['boulanger','Boulanger'],['darty','Darty'],['fnac','Fnac'],['cdiscount','Cdiscount'],['ikea','IKEA'],['leroy merlin','Leroy Merlin'],['castorama','Castorama'],['carrefour','Carrefour'],['auchan','Auchan'],['leclerc','E.Leclerc'],['intermarché','Intermarché'],['decathlon','Decathlon'],['booking.com','Booking.com'],['air france','Air France'],['sncf','SNCF'],['apple','Apple'],['samsung','Samsung'],['google','Google'],['microsoft','Microsoft'],['paypal','PayPal']];let joined=norm(lines.slice(0,45).join(' '));for(const [k,name] of known)if(joined.includes(norm(k)))return name;let candidates=lines.slice(0,16).filter(x=>x.length>=3&&x.length<55&&!/facture|invoice|date|client|adresse|total|tva|payé|paye|référence|reference/i.test(x)&&!/^[\d€]/.test(x));return candidates[0]||'Prestataire non identifié'}
function docType(text){let n=norm(text);if(/\bdevis\b|quotation/.test(n))return'Devis';if(/ticket de caisse|\bticket\b/.test(n))return'Ticket';if(/releve|statement/.test(n))return'Relevé';if(/confirmation de commande/.test(n)&&!/facture/.test(n))return'Commande';return'Facture'}
function category(text){let n=norm(text);if(/telecom|forfait|mobile|internet|fibre|orange|sfr|bouygues|free/.test(n))return'Télécom';if(/electricite|gaz|kwh|engie|edf|totalenergies/.test(n))return'Énergie';if(/assurance|cotisation|sinistre/.test(n))return'Assurance';if(/garage|vehicule|immatriculation|kilometrage|pneu|vidange/.test(n))return'Automobile';if(/hotel|booking|nuit|chambre/.test(n))return'Hôtel';if(/train|sncf|vol|air france|billet/.test(n))return'Transport';if(/abonnement|mensuel|subscription/.test(n))return'Abonnement';return'Achat'}
function findVatSummary(rows){for(let i=0;i<rows.length;i++){let n=norm(rows[i].cells.join(' '));if(n.includes('taux tva')&&n.includes('total ht')&&/\btva\b/.test(n)){for(let j=i+1;j<=Math.min(i+4,rows.length-1);j++){let s=rows[j].cells.join(' ');let rate=(s.match(/(\d{1,2}(?:[,.]\d+)?)\s*%/)||[])[1];let monies=(s.match(/\d[\d .]*[,.]\d{2}\s*€/g)||[]).map(amount).filter(v=>v!==null);if(rate&&monies.length>=2)return{vatRate:+rate.replace(',','.'),ht:monies[0],vatAmount:monies[monies.length-1]};}}
}return null}
function productHeading(value) {
  return /^(?:produit(?: \/ reference)?|reference|description|designation|article|qte|quantite|prix.*|total.*|ht|ttc)$/.test(norm(value));
}

function extractProduct(rows){
  for (const [index, row] of rows.entries()) {
    const column = row.cells.findIndex(cell => /^(?:produit(?: \/ reference)?|description|designation|article)$/.test(norm(cell)));
    if (column < 0 || !row.cells.some(cell => /^(?:prix|qte|quantite|total)\b/.test(norm(cell)))) continue;
    const next = rows[index + 1]?.cells;
    const product = next?.[column];
    if (next?.length === row.cells.length && product && !productHeading(product) && /\p{L}/u.test(product)) return product;
  }
let start=-1;for(let i=0;i<rows.length;i++){let n=norm(rows[i].cells.join(' '));if(/details de la facture|détails de la facture/.test(n)){start=i;break}}if(start>=0){let header=-1;for(let i=start;i<Math.min(rows.length,start+6);i++){let n=norm(rows[i].cells.join(' '));if(/description|designation|article|produit/.test(n)){header=i;break}}if(header>=0){let parts=[];for(let i=header+1;i<Math.min(rows.length,header+8);i++){let row=rows[i],n=norm(row.cells.join(' '));if(/asin\s*:|frais d'expedition|facture total|sous-total|total ttc/.test(n))break;let first=clean(row.cells[0]||'');if(!first)continue;if(/^\d+[,.]?\d*\s*€?$/.test(first))continue;if(productHeading(first))continue;parts.push(first)}let product=clean(parts.join(' '));if(product.length>6)return product}}
let anchor=labeledField(rows,['produit / référence','désignation','description','article','produit'],value=>{
  const candidate = clean(value);
  return candidate && !productHeading(candidate) && /\p{L}/u.test(candidate) ? candidate : '';
});if(anchor&&anchor.value.length>5)return anchor.value;
let candidates=rows.map(r=>clean(r.cells[0]||'')).filter(x=>x.length>8&&x.length<180&&!/facture|commande|client|adresse|total|tva|date|paiement|livraison|amazon|siret|siren|référence|reference/i.test(norm(x))&&!/^\d+[,.]?\d*\s*€?$/.test(x));return candidates.find(x=>/\d|[A-Z]{2,}/.test(x))||candidates[0]||'Achat / service'}
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
function parse(text){let rows=splitRows(text),all=rows.map(r=>r.raw.replace(/\t+/g,' ')).join('\n'),merchant=detectMerchant(rows);
const header = invoiceHeader(rows);
let purchase = labeledField(rows, purchaseLabels, isoDate);
let invoice = labeledField(rows, ['date de la facture','date de facture','date facture','invoice date','émise le'], isoDate)
  || (header && { value: header.date });
let shipping=dateValue(rows,['date d’expédition','date expedition','expédié le','expedie le','shipped']);
let delivery=dateValue(rows,['date de la livraison','date de livraison','date de réception','date reception','livré le','livre le','reçu le','recu le']);
let due=dateValue(rows,['date d’échéance','date echeance','échéance','echeance','due date']);
let total=moneyValue(rows,['facture total','total ttc','net à payer','net a payer','montant total','total à payer','total a payer','total de la commande','total facture','grand total','amount due']);
// Ne jamais prendre « Total Produits HT » ou « Total Taxes » pour le montant à payer.
if(!total){for(const row of rows){let t=row.cells.join(' ');if(/^\s*total\s*[:：]\s*-?\d/i.test(t)||/^\s*total\s+-?\d/i.test(t)){let vals=t.match(/-?\d[\d .]*[,.]\d{2}\s*€?/g)||[];if(vals.length){total={value:amount(vals[vals.length-1])};break}}}}
if(!total)total=moneyValue(rows,['total']);
let ht=moneyValue(rows,['total ht','montant ht','hors taxe']);
let vatAmount=moneyValue(rows,['montant tva','total taxes','total taxe','tva à payer','tva a payer','tax amount']);
let vatRate=null;for(const r of rows){let s=r.cells.join(' '),m=s.match(/(?:taux\s+(?:de\s+)?)?tva\s*[:：]?\s*(\d{1,2}(?:[,.]\d+)?)\s*%/i);if(m){vatRate=+m[1].replace(',','.');break}m=s.match(/(\d{1,2}(?:[,.]\d+)?)\s*%\s*(?:tva|taxe)/i);if(m){vatRate=+m[1].replace(',','.');break}}
let summary=findVatSummary(rows);if(summary){if(ht==null||ht.value===null)ht={value:summary.ht};if(vatAmount==null||vatAmount.value===null)vatAmount={value:summary.vatAmount};if(vatRate==null)vatRate=summary.vatRate}
let vatNumber='';for(const r of rows){let s=r.cells.join(' '),m=s.match(/(?:n(?:um[ée]ro)?\s*)?(?:de\s*)?tva\s*(?:intracommunautaire)?\s*[:：]?\s*([A-Z]{2}[A-Z0-9 .-]{6,20})/i);if(m){let v=m[1].replace(/\s/g,'').replace(/[.,;:]$/,'');if(/[A-Z]/i.test(v)&&/\d/.test(v)){vatNumber=v;break}}}
let invoiceNo = labeledField(rows, invoiceLabels, identifier) || (header && { value: header.number });
let clientNo=idValue(rows,['numéro client','numero client','n° client','référence client','reference client'],2);
let contractNo=idValue(rows,['numéro de contrat','numero de contrat','n° contrat','contrat n°'],3);
let seller=valueFromRow(rows,['vendu par','seller','vendeur'],v=>{let x=clean(v);return x&&!/^tva\b/i.test(x)?x:''},0);
let paymentReference=idValue(rows,['référence de paiement','reference de paiement','payment reference'],5);
let asin=valueFromRow(rows,['asin'],v=>{let m=String(v||'').match(/\b[A-Z0-9]{8,14}\b/i);return m?m[0]:''},0);
let siret='';let ms=all.match(/\bSIRET\s*[:：]?\s*(\d[\d ]{12,18})/i);if(ms)siret=ms[1].replace(/\s/g,'').slice(0,14);let siren='';ms=all.match(/\bSIREN\s*[:：]?\s*(\d[\d ]{7,12})/i);if(ms)siren=ms[1].replace(/\s/g,'').slice(0,9);
// Sous-totaux explicites de produits : à ne pas confondre avec le total HT global.
let itemsHT=moneyValue(rows,['total produits ht','sous-total produits ht','total articles ht']);
let itemsTTC=moneyValue(rows,['total produits ttc','sous-total produits ttc','total articles ttc']);
let shippingTTC=moneyValue(rows,["frais d'expédition","frais d’expédition","frais de livraison","frais de port","livraison ttc"]);
let discountTTC=moneyValue(rows,['remise commerciale','remise appliquée','réduction totale']);
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
let product=extractProduct(rows),ord=orderNumber(rows);
let confidence={merchant:merchant==='Prestataire non identifié'?38:88,product:product==='Achat / service'?35:92,price:total?92:35,date:purchase?94:invoice?82:35,order:ord?98:35};
if(total&&ht&&vatAmount&&Math.abs((ht.value+vatAmount.value)-total.value)<0.03)confidence.price=99;else if(total&&vatRate!=null&&ht&&Math.abs(ht.value*(1+vatRate/100)-total.value)<0.08)confidence.price=98;
let generic = safeGenericFields(rows);
return{merchant,product,price:total?total.value:null,purchaseDate:purchase?purchase.value:(invoice?invoice.value:''),orderNumber:ord,documentType:docType(all),category:category(all),invoiceDate:invoice?invoice.value:'',shippingDate:shipping?shipping.value:'',deliveryDate:delivery?delivery.value:'',dueDate:due?due.value:'',invoiceNumber:invoiceNo?invoiceNo.value:'',clientNumber:clientNo?clientNo.value:'',contractNumber:contractNo?contractNo.value:'',ht:ht?ht.value:null,itemsSubtotalHT:itemsHT?itemsHT.value:null,itemsSubtotalTTC:itemsTTC?itemsTTC.value:null,shippingTTC:shippingTTC?shippingTTC.value:null,discountTTC:discountTTC?Math.abs(discountTTC.value):null,lineItems:[],paymentMethod,carrier,billingPeriod,vatAmount:vatAmount?vatAmount.value:null,vatRate,vatNumber,siret,siren,seller:seller?seller.value:'',paymentReference:paymentReference?paymentReference.value:'',asin:asin?asin.value:'',confidence,genericFields:generic,rawText:all};}
window.RecoverParser={parse,isoDate,amount};
})();
