FROM node:22-alpine AS build
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build
RUN mkdir -p dist/assets && cp src/assets/aureum-logo.png dist/assets/aureum-logo.png && cp src/assets/aureum-mall-design.jpg dist/assets/aureum-mall-design.jpg

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
CMD ["node", "dist/index.js"]
