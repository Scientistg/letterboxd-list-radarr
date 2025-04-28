# Etapa de build
FROM node:18-alpine AS builder

WORKDIR /home/node/app

# Copia apenas arquivos de dependência primeiro para aproveitar o cache
COPY package*.json ./

# Instala todas as dependências, incluindo devDependencies
RUN npm ci

# Copia o restante do código-fonte
COPY . .

# Compila o TypeScript para a pasta dist
RUN npm run build


# Etapa final (runtime)
FROM node:18-alpine

WORKDIR /home/node/app

# Copia apenas o necessário da etapa de build
COPY --from=builder /home/node/app/dist ./dist
COPY package*.json ./

# Instala somente dependências de produção
RUN npm ci --only=production

EXPOSE 5000
CMD ["npm", "run", "start"]