# Recover — Azure Document Intelligence

Recover utilise maintenant Azure Document Intelligence comme moteur de secours pour les factures difficiles.

## 1. Créer la ressource Azure

1. Ouvrez le portail Azure.
2. Créez une ressource **Document Intelligence**.
3. Choisissez le niveau tarifaire **F0 (Free)** pour les tests.
4. Une fois la ressource créée, ouvrez **Keys and Endpoint**.
5. Copiez :
   - l’**Endpoint** ;
   - **KEY 1** ou **KEY 2**.

## 2. Ajouter les secrets dans Supabase

Dans **Supabase > Edge Functions > Secrets**, ajoutez :

- `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` = endpoint Azure complet, par exemple `https://xxxx.cognitiveservices.azure.com/`
- `AZURE_DOCUMENT_INTELLIGENCE_KEY` = clé Azure Document Intelligence

L’ancienne variable `OPENAI_API_KEY` n’est plus utilisée par Recover et peut être supprimée.

## 3. Redéployer la fonction Supabase

La fonction garde le même nom :

`recover-visual-ai`

Dans l’éditeur Supabase, remplacez son contenu par le fichier :

`supabase/functions/recover-visual-ai/index.ts`

Puis cliquez sur **Deploy function**.

## 4. Fonctionnement

Recover :

1. analyse localement le PDF / l’image ;
2. détecte les champs incertains ;
3. envoie une image réduite de la première page à la fonction Supabase ;
4. Supabase appelle Azure Document Intelligence avec le modèle `prebuilt-invoice` ;
5. les champs Azure sont comparés à l’analyse locale avant affichage.

Le secret Azure reste uniquement côté Supabase.

## Limites du niveau F0

Le niveau gratuit est destiné aux essais. Azure limite notamment le nombre de pages analysées par document et la taille des fichiers. Recover envoie actuellement une image réduite de la première page au moteur de secours, ce qui convient à la majorité des factures d’achat testées.
