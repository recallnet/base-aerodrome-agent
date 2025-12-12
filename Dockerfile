# Aerodrome Trading Agent Docker Image
# Uses tsx for direct TypeScript execution (no compile step needed)

FROM node:20-alpine

# Install pnpm and required packages
RUN corepack enable && corepack prepare pnpm@latest --activate && \
    apk add --no-cache tini wget

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml drizzle.config.ts tsconfig.json ./

# Install all dependencies, skip prepare scripts
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy source code
COPY src ./src

# Copy scripts (for db:reset, etc.)
COPY scripts ./scripts

# Copy drizzle migrations
COPY drizzle ./drizzle

# Copy entrypoint script
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Create a non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Set production environment
ENV NODE_ENV=production

# Use tini for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Run entrypoint (migrations + start)
CMD ["./docker-entrypoint.sh"]
