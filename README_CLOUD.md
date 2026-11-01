# Recover V3.2 — mise en route du cloud

Recover V3.2 utilise Supabase pour :
- l'inscription et la connexion par e-mail / mot de passe ;
- la synchronisation des achats, dossiers et montants récupérés ;
- le stockage privé des factures et justificatifs.

## 1. Créer un projet Supabase
1. Créez un projet sur https://supabase.com/.
2. Ouvrez **SQL Editor**.
3. Copiez tout le contenu de `supabase_setup.sql` et exécutez-le une seule fois.

Ce script crée :
- la table `recover_states` ;
- les règles RLS pour isoler les utilisateurs ;
- le bucket privé `recover-documents` ;
- les règles qui limitent chaque utilisateur à son propre dossier de documents.

## 2. Récupérer les deux informations publiques du projet
Dans le tableau de bord Supabase, copiez :
- le **Project URL** ;
- la **Publishable key** (ou l'ancienne clé `anon`).

N'utilisez JAMAIS une clé `service_role` / secret key dans Recover côté navigateur.

## 3. Ouvrir Recover depuis un vrai serveur web
Pour le cloud, évitez d'ouvrir directement les fichiers à l'intérieur du ZIP avec une URL `file://`.
Publiez le dossier sur GitHub Pages / Netlify / Vercel, ou servez-le avec un petit serveur HTTP local.
Toutes les pages doivent être sous la même origine web pour partager correctement la configuration et la session.

## 4. Configurer Recover
1. Ouvrez `setup.html` depuis votre site.
2. Collez le Project URL et la clé publishable / anon.
3. Cliquez sur **Enregistrer la configuration**.
4. Ouvrez `auth.html` et créez un compte.

Selon les réglages Supabase Auth, un e-mail de confirmation peut être demandé. Pour un test local, vous pouvez adapter temporairement ce réglage dans Supabase ; pour une mise en production, configurez plutôt l'URL de votre vrai site.

## 5. Synchronisation
Une fois connecté :
- Recover charge les données cloud au démarrage ;
- chaque modification est gardée localement puis synchronisée automatiquement ;
- le bouton **Synchroniser** force une synchronisation immédiate ;
- les factures importées sont envoyées au bucket privé ;
- le bouton **Voir le justificatif** crée un lien temporaire.

## 6. Migration depuis Recover V3.1
Lors de la première connexion V3.2 :
- si le cloud est vide ;
- et que Recover retrouve les données locales V3.1 correspondant au même e-mail ;
- elles sont reprises puis envoyées dans le cloud automatiquement.

## Sécurité
La clé publique Supabase peut être présente dans le navigateur : la protection réelle des données repose sur les politiques RLS.
Ne mettez jamais une clé secrète / `service_role` dans `setup.html`, `cloud.js` ou tout autre fichier livré au navigateur.
