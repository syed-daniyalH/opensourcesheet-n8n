FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build
RUN mkdir -p dist/assets \
  && cp src/assets/aureum-logo.png src/assets/aureum-mall-design.jpg src/assets/login.js dist/assets/ \
  && cp -r src/assets/sheet dist/assets/sheet

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# Spreadsheets, users, sessions, and the audit log live in /data (mount a volume there).
RUN mkdir -p /data && chown node:node /data
ENV GATEWAY_STATE_DIR=/data
USER node
CMD ["node", "dist/admin-gateway.js"]
