# Mes Courses — Comparateur Carrefour vs Monoprix

Application web **Next.js (App Router) + PostgreSQL (Drizzle ORM)** pour centraliser vos **tickets de caisse Carrefour** et vos **factures PDF Monoprix Courses** afin de comparer vos prix réels (remises immédiates, -10% Club Carrefour et -10% remise abonnement M+ inclus).

## Fonctionnalités

- **Import PDF auto-détecté (Carrefour & Monoprix)** :
  - **Carrefour** : extraction du magasin, articles, poids vrac (`€/kg`), remises immédiates, cagnotte -10% Club et masquage automatique du numéro de carte de fidélité.
  - **Monoprix.fr Courses** : extraction du tableau multi-lignes, promos unitaires, répartition au prorata de la **remise abonnement M+ (-10%)** sur chaque produit, calcul des prix au kg/L, frais de préparation/consignes séparés, et masquage des données personnelles.
  - Déduplication automatique pour ne jamais réimporter un ticket ou une facture déjà en base.
- **Duel Carrefour vs Monoprix** :
  - Associez les produits équivalents entre enseignes (avec suggestions automatiques en 1 clic), comparez à l'unité ou au **kg / litre**, et voyez instantanément où chaque produit coûte le moins cher.
- **Catalogue & Recherche unifiée** :
  - Recherche instantanée multi-mots insensible aux accents et abréviations Carrefour (`ORAN` → `ORANGE`, `S/LACT` → `SANS LACTOSE`, `DCH` → `DOUCHE`, etc.) avec filtre par enseigne.
- **Mes Tickets & Factures** :
  - Historique chronologique par magasin (Carrefour Market, Carrefour City, Paris Auteuil, Monoprix.fr Courses...) avec détail complet.
- **Sauvegarde & Restauration compressée (`.json.gz`)** :
  - Export complet de la base (tickets, articles, notes, duels, suggestions ignorées, texte masqué) compressé en `.json.gz`.
  - Import avec aperçu préalable (*dry-run*), mode **Fusion** (sans perte) ou **Remplacement complet**.

## Démarrage en local

```bash
npm install
npm run dev
```

Sans variable `DATABASE_URL`, l'application démarre automatiquement avec **PGlite** (PostgreSQL embarqué) et importe les éventuels fichiers `.pdf` présents à la racine (ignorés par `.gitignore`).

## Déploiement sur Vercel Hobby + Neon PostgreSQL

1. Créez une base **Neon Postgres** (depuis l'onglet *Storage* sur Vercel ou sur neon.tech).
2. Configurez les variables d'environnement sur Vercel :
   - `DATABASE_URL` : votre URL PostgreSQL Neon (`postgresql://...`).
   - `APP_PASSWORD` : mot de passe pour verrouiller l'accès à l'interface web.
   - `AUTH_SECRET` *(optionnel)* : chaîne aléatoire pour signer les cookies de session.
3. Déployez sur Vercel : les tables PostgreSQL sont créées/migrées automatiquement au premier démarrage.

## Vérification

```bash
npm run verify:parser
```
