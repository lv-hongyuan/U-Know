FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY api/package.json ./api/package.json
RUN npm install --workspace=api
COPY api ./api
RUN npm run build --workspace=api

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY api/package.json ./api/package.json
RUN npm install --omit=dev --workspace=api
COPY --from=build /app/api/dist ./api/dist
USER node
CMD ["node", "api/dist/index.js"]
