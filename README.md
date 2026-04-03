# Koogwe Backend v3 — Fusionné

Backend NestJS unifié pour les apps **passager** et **chauffeur** Koogwe.

## Architecture

```
src/
├── auth/           → OTP email, JWT (access + refresh hashé), logout
├── users/          → Profil, véhicule, lieux sauvegardés, notifications
├── drivers/        → Profil chauffeur, disponibilité, stats, documents
├── rides/          → VTC, livraison, estimation prix, PIN, partage, panique
├── wallet/         → Solde, paiement, retrait, Stripe intent
├── admin/          → Dashboard, validation chauffeurs, documents, finances
├── documents/      → Upload base64, revue admin
├── face-verification/ → AWS Rekognition (liveness + movements)
├── mail/           → SMTP avec fallback non-bloquant
├── common/         → WebSocket gateway (accept_ride, GPS, chat)
└── prisma/         → Client DB global
```

## Bugs corrigés

| Bug | Fichier | Fix |
|-----|---------|-----|
| `ADMIN_DASHBOARD_BYPASS_AUTH` dangereux | auth.guard | **Supprimé** — admin via JWT normal |
| `accept_ride` sans vérif vehicleType | websocket.gateway | **Ajouté** table de compatibilité |
| `approveDriver` sans vérif documents | drivers.service + admin.service | **Ajouté** vérification obligatoire |
| Refresh token en clair | auth.service | **Hashé** avec bcryptjs |
| `MailService` bloquant si SMTP down | mail.service | **try/catch** non-bloquant |
| `RolesGuard` non global | app.module | **APP_GUARD** global + `@Roles` sur controlleur admin |
| `confirmRechargeIntent` userId vide | wallet.service | **Résolu** via mock ID + paramètre userId |
| `compareFaces` échec silencieux | aws-rekognition | **Logger.error** explicite |

## Variables d'environnement

Copier `.env.example` → `.env` et remplir les valeurs.

**Obligatoires :**
- `DATABASE_URL` / `DIRECT_URL`
- `JWT_ACCESS_SECRET` + `JWT_REFRESH_SECRET`
- `ADMIN_EMAIL` + `ADMIN_PASSWORD`

**Optionnelles :**
- `MAIL_*` — si absent, emails loggués en console
- `AWS_*` — si absent, vérification faciale en mode bypass local
- `STRIPE_SECRET_KEY` — si absent, recharge en mode mock

## Déploiement Render

### 1. Base de données PostgreSQL

1. Créer un **PostgreSQL** sur Render (Free tier)
2. Copier `Internal Database URL` → `DATABASE_URL`
3. Copier `External Database URL` → `DIRECT_URL`

### 2. Web Service

1. **New → Web Service** → connecter le repo GitHub
2. **Build Command :** `npm install && npx prisma generate && npx prisma db push && npm run build`
3. **Start Command :** `npm run start`
4. **Environment Variables :** ajouter toutes les variables du `.env.example`

### 3. Variables Render à configurer

```
DATABASE_URL         = (depuis Render PostgreSQL)
DIRECT_URL           = (depuis Render PostgreSQL)
JWT_ACCESS_SECRET    = (générer: openssl rand -hex 32)
JWT_REFRESH_SECRET   = (générer: openssl rand -hex 32)
ADMIN_EMAIL          = admin@votredomaine.com
ADMIN_PASSWORD       = MotDePasseSecure123!
NODE_ENV             = production
PUBLIC_BASE_URL      = https://votre-app.onrender.com
FRONTEND_URL         = https://votre-admin.vercel.app
MAIL_HOST            = smtp-relay.brevo.com
MAIL_PORT            = 587
MAIL_USER            = votre@email.com
MAIL_PASS            = votre-cle-api-brevo
MAIL_FROM            = Koogwe <noreply@koogwe.com>
```

## Endpoints principaux

### Auth
| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/auth/send-otp` | Envoyer code OTP |
| POST | `/api/auth/verify-otp` | Vérifier OTP → tokens |
| POST | `/api/auth/refresh` | Renouveler access token |
| POST | `/api/auth/logout` | Déconnexion |
| GET  | `/api/auth/me` | Profil connecté |

### Courses
| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/rides` | Créer une course VTC |
| POST | `/api/rides/delivery` | Créer une livraison |
| POST | `/api/rides/estimate` | Estimer le prix |
| GET  | `/api/rides/available?lat=&lng=` | Courses dispo (chauffeur) |
| POST | `/api/rides/:id/accept` | Accepter (REST) |
| POST | `/api/rides/:id/verify-pin` | Valider PIN de départ |
| PATCH | `/api/rides/:id/status` | Mettre à jour statut |
| POST | `/api/rides/panic` | Bouton panique |

### WebSocket events
| Event | Direction | Description |
|-------|-----------|-------------|
| `accept_ride` | Client→Server | Accepter une course |
| `driver_arrived` | Client→Server | Signaler arrivée |
| `start_trip` | Client→Server | Démarrer la course |
| `finish_trip` | Client→Server | Terminer la course |
| `driver:location` | Client→Server | Mise à jour GPS |
| `ride_accepted` | Server→Client | Course acceptée (passager) |
| `driver_arrived` | Server→Client | Chauffeur arrivé (passager) |
| `ride_completed` | Server→Client | Course terminée |
| `new_ride` | Server→Client | Nouvelle course (chauffeurs) |

## Documentation Swagger
Disponible en dev sur : `http://localhost:3000/api/docs`
