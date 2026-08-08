FROM node:20.19.4-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY index.js ./
COPY src ./src

USER node
EXPOSE 8080
CMD ["npx", "functions-framework", "--target=manageInstancesOnBudget", "--signature-type=cloudevent", "--port=8080"]
