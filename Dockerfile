# Stage 1: Builder
FROM node:20-bullseye AS builder

RUN apt-get update && apt-get install -y \
  python3 make g++ gcc \
  && ln -sf python3 /usr/bin/python \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /usr/src/app && chown -R node:node /usr/src/app
WORKDIR /usr/src/app
USER node

COPY --chown=node:node package*.json ./
COPY --chown=node:node prisma ./prisma

RUN npm ci --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000

COPY --chown=node:node . .

RUN npx prisma generate
RUN npm run build

# Stage 2: Runtime
FROM node:20-bullseye AS runtime

RUN apt-get update && apt-get install -y \
  wget gnupg ca-certificates curl \
  && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
  && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
  && apt-get update && apt-get install -y google-chrome-stable \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app
USER node

COPY --from=builder --chown=node:node /usr/src/app/dist        ./dist
COPY --from=builder --chown=node:node /usr/src/app/node_modules ./node_modules
COPY --from=builder --chown=node:node /usr/src/app/prisma      ./prisma
COPY --from=builder --chown=node:node /usr/src/app/package*.json ./

ENV NODE_ENV=production
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

EXPOSE 3003

CMD ["node", "dist/main.js"]
