# Recover — IA visuelle de secours

Recover utilise d'abord son analyse locale (PDF/OCR + parseur). Si des champs importants sont manquants ou douteux, le site peut appeler une vraie IA visuelle via une **Supabase Edge Function**.

## Architecture

Navigateur (GitHub Pages) → Supabase Edge Function `recover-visual-ai` → API Gemini

Conservez la clé Gemini dans les secrets Supabase.

## 1. Créer la fonction dans Supabase

Dans le tableau de bord Supabase :

1. Ouvrez **Edge Functions**.
2. Créez une fonction nommée exactement `recover-visual-ai`.
3. Mettez à jour les deux fichiers de la fonction et de sa validation partagée.
   Conservez le chemin relatif de l’import dans `index.ts`.
4. Déployez la fonction avec tous ses fichiers.

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
`recover-visual-ai` avec ces deux fichiers du même commit.

- `supabase/functions/recover-visual-ai/index.ts`
- `supabase/functions/_shared/invoice-validation.js`

Depuis une copie à jour du dépôt, la commande suivante inclut l’import partagé.

```sh
supabase functions deploy recover-visual-ai --project-ref otzlvluymgiepodlgsie
```

Le projet et la connexion Supabase doivent être configurés dans la CLI.
Le tableau de bord reste utilisable si les deux fichiers sont ajoutés avec les
mêmes chemins relatifs. Copier uniquement le nouveau `index.ts` laisse un import manquant.

Le fichier `.nojekyll` permet à GitHub Pages de publier aussi le dossier
`_shared` utilisé par le navigateur. Vérifiez que son fichier JavaScript est
accessible après publication.

Relancez ensuite **Vérifier avec l’IA visuelle** sur un document de test.

En cas d’échec, Recover conserve l’analyse locale et affiche le statut HTTP
ainsi que le détail disponible. Dans Supabase, consultez **Edge Functions →
recover-visual-ai → Invocations** et **Logs** à l’heure de l’essai pour
distinguer une erreur de la passerelle d’un échec signalé par Gemini.

Le statut 429 interrompt les appels supplémentaires pour éviter une rafale
sur un quota atteint. Les erreurs temporaires 503 sont réessayées dans les
limites des délais par modèle et du délai global. Un en-tête Retry-After long
est affiché pour permettre un nouvel essai ultérieur.

## 6. Vérifications reproductibles

Avec Node.js 24 ou ultérieur, lancez `node --test` à la racine du dépôt.
Les tests exécutent le parseur, la fusion, l’état du bouton et la fonction serveur
avec des réponses simulées. Les tests serveur utilisent le retrait des types
TypeScript de Node.

Amazon et Boulanger sont représentés par des textes reconstruits à partir des
valeurs de référence, et Promovap par un extrait anonymisé représentatif. Ces tests
ne vérifient pas le rendu ni l’OCR des PDF originaux. Un extrait de texte Promovap
conservé de l’essai précédent a également été contrôlé localement. Il ne contient
pas de preuve du fonctionnement actuel de Gemini en production.

Avant une ouverture publique, refaire un essai réel dans Recover après le
déploiement Supabase, puis contrôler la connexion, la sauvegarde cloud et les
parcours de garanties, retours et remboursements sur un compte de test.
