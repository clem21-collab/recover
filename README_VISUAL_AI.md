# Recover — IA visuelle de secours

Recover utilise d'abord son analyse locale (PDF/OCR + parseur). Si des champs importants sont manquants ou douteux, le site peut appeler une vraie IA visuelle via une **Supabase Edge Function**.

## Architecture

Navigateur (GitHub Pages) → Supabase Edge Function `recover-visual-ai` → API Gemini

Conservez la clé Gemini dans les secrets Supabase.

## 1. Créer la fonction dans Supabase

Dans le tableau de bord Supabase :

1. Ouvrez **Edge Functions**.
2. Créez une fonction nommée exactement `recover-visual-ai`.
3. Remplacez son code par le contenu de :
   `supabase/functions/recover-visual-ai/index.ts`
4. Déployez la fonction.

## 2. Configurer Gemini dans Supabase

Dans **Edge Functions → Secrets**, ajoutez :

- `GEMINI_API_KEY` = votre clé API Gemini. Réutilisez le secret existant s’il est déjà configuré.

Optionnel :

- `GEMINI_MODEL` permet de choisir le premier modèle essayé.

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

## 5. Mise à jour et diagnostic

Après la publication du site, rechargez Recover. Dans Supabase, redéployez
`recover-visual-ai` à partir de `supabase/functions/recover-visual-ai/index.ts`.
Relancez ensuite **Vérifier avec l’IA visuelle** sur un document de test.

En cas d’échec, Recover conserve l’analyse locale et affiche le statut HTTP
ainsi que le détail disponible. Dans Supabase, consultez **Edge Functions →
recover-visual-ai → Invocations** et **Logs** à l’heure de l’essai pour
distinguer une erreur de la passerelle d’un échec signalé par Gemini.
