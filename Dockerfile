FROM node:20-alpine

# Dépendance native requise par certains packages
RUN apk add --no-cache libatomic

WORKDIR /app

# Copier les fichiers de dépendances
COPY package*.json ./
COPY prisma ./prisma/

# Installer les dépendances
RUN npm ci

# Générer le client Prisma
RUN npx prisma generate

# Copier le reste du code
COPY . .

# Builder le projet NestJS
RUN npm run build

EXPOSE 3000

CMD ["node", "dist/main"]
