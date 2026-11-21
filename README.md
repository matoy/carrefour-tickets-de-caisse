# Carrefour Tickets de Caisse — Comparateur & Historique

Application web **Next.js (App Router) + PostgreSQL (Drizzle ORM)** conçue pour centraliser vos tickets de caisse Carrefour et comparer instantanément vos prix passés lorsque vous faites vos courses en ligne chez Monoprix.

## Fonctionnalités

- **Comparateur Produits (Mode Monoprix)** :
  - Recherche instantanée insensible aux accents et abréviations Carrefour (`ORAN` → `ORANGE`, `S/LACT` → `SANS LACTOSE`, `DCH` → `DOUCHE`, `BQ TOM` → `BARQUETTE TOMATE`, etc.).
  - Affichage du **dernier prix affiché**, du **prix net réel** (remises immédiates et cagnotte -10% Club Carrefour déduites), du **prix au kg / au litre**, et de la tendance par rapport aux achats précédents.
  - Comparateur Monoprix intégré sur chaque fiche produit avec calcul automatique du gain sur le caddie.
- **Mes Tickets de Caisse** :
  - Vue chronologique par magasin (Carrefour Market, Carrefour City) avec détail fidélité, remises et moyens de paiement.
  - Masquage automatique du numéro de carte de fidélité avant stockage.
- **Rapatriement des nouveaux tickets (sans doublons)** :
  - **Bookmarklet 1-clic** directement depuis `carrefour.fr` (compatible Google Auth et contournement anti-bot Cloudflare/DataDome).
  - **Synchronisation serveur** via Cookie / `Copy as cURL` / `.har`.
  - **Import PDF par glisser-déposer** (ou scan du dossier local).

## Démarrage en local

```bash
npm install
npm run dev
```

Sans variable `DATABASE_URL`, l'application démarre automatiquement avec **PGlite** (PostgreSQL embarqué persisté dans `.pgdata/`) et importe les éventuels fichiers `*_ticket.pdf` présents à la racine (ignorés par `.gitignore`).

## Déploiement sur Vercel Hobby + Neon PostgreSQL

1. Créez une base **Neon Postgres** (directement depuis l'onglet *Storage* sur Vercel ou sur neon.tech).
2. Configurez les variables d'environnement sur Vercel :
   - `DATABASE_URL` : votre URL PostgreSQL Neon (`postgresql://...`).
   - `APP_PASSWORD` : mot de passe pour verrouiller l'accès à l'interface web.
   - `AUTH_SECRET` *(optionnel)* : chaîne aléatoire pour signer les cookies de session.
3. Déployez sur Vercel : les tables PostgreSQL sont créées automatiquement au premier démarrage (ou via `npm run db:push`).

## Vérification du parser

```bash
npm run verify:parser
```
