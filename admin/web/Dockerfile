FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY web/package.json ./web/package.json
RUN npm install --workspace=web
COPY web ./web
RUN npm run build --workspace=web

FROM nginx:1.27-alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 8080
