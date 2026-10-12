FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
COPY web/package.json web/package-lock.json* ./web/
RUN npm install && npm --prefix web install

COPY tsconfig.json ./
COPY src ./src
COPY web ./web

RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
