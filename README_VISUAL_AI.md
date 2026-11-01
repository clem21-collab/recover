# Recover — IA visuelle de secours

Recover utilise d'abord son analyse locale (PDF/OCR + parseur). Si des champs importants sont manquants ou douteux, le site peut appeler une vraie IA visuelle via une **Supabase Edge Function**.

## Architecture

Navigateur (GitHub Pages) → Supabase Edge Function `recover-visual-ai` → OpenAI Responses API

La clé OpenAI ne doit jamais être placée dans GitHub Pages, `cloud.js`, `app.js` ou `setup.html`.

## 1. Créer la fonction dans Supabase

Dans le tableau de bord Supabase :

1. Ouvrez **Edge Functions**.
2. Créez une fonction nommée exactement `recover-visual-ai`.
3. Remplacez son code par le contenu de :
   `supabase/functions/recover-visual-ai/index.ts`
4. Déployez la fonction.

## 2. Ajouter la clé OpenAI dans Supabase

Dans **Edge Functions → Secrets**, ajoutez :

- `OPENAI_API_KEY` = votre clé API OpenAI

Optionnel :

- `OPENAI_MODEL` = `gpt-4.1-mini`

La clé API OpenAI est un secret serveur. Ne la commitez jamais dans GitHub.

## 3. Fonctionnement dans Recover

- Recover analyse d'abord le fichier localement.
- Si le résultat paraît incohérent ou incomplet, Recover propose / déclenche la vérification visuelle.
- Au premier usage, Recover demande le consentement avant d'envoyer une copie réduite des premières pages de la facture à l'IA.
- L'IA reçoit au maximum les 2 premières pages rendues en JPEG, le texte extrait et le résultat local à vérifier.
- L'IA doit renvoyer `null` lorsqu'un champ n'apparaît pas dans le document.
- Les résultats sont fusionnés avec l'analyse locale en privilégiant les champs visuellement confirmés avec une forte confiance.

## 4. Confidentialité

Les factures peuvent contenir nom, adresse, téléphone et détails d'achat. Recover n'envoie donc pas une facture à l'IA sans consentement préalable dans le navigateur.

Pour retirer le consentement enregistré, effacez les données du site dans le navigateur. Une option dédiée pourra être ajoutée plus tard dans Mon compte.

## 5. Coût

L'utilisation de l'API OpenAI est facturée séparément d'un abonnement ChatGPT. La fonction n'appelle l'IA que comme solution de secours afin de limiter le coût.
