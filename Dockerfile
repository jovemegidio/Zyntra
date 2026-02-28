# =================================================================
# ALUFORCE ERP — Production Dockerfile
# Multi-stage build for minimal image size
# =================================================================

# ── Stage 1: Dependencies ────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install production dependencies only
RUN npm ci --production --ignore-scripts \
    && npm cache clean --force

# ── Stage 2: Production ─────────────────────────
FROM node:20-alpine AS production

# Security: run as non-root
RUN addgroup -g 1001 -S aluforce \
    && adduser -S aluforce -u 1001 -G aluforce

# Install runtime dependencies (for sharp, canvas, puppeteer)
RUN apk add --no-cache \
    dumb-init \
    fontconfig \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application code
COPY server.js package.json ecosystem.config.js ./
COPY routes/ ./routes/
COPY middleware/ ./middleware/
COPY services/ ./services/
COPY src/ ./src/
COPY api/ ./api/
COPY config/ ./config/
COPY modules/ ./modules/
COPY public/ ./public/
COPY _shared/ ./_shared/
COPY database/ ./database/
COPY scripts/ ./scripts/
COPY utils/ ./utils/
COPY security-middleware.js lgpd-crypto.js ./

# Create necessary directories
RUN mkdir -p logs uploads /var/www/uploads/RH \
    && chown -R aluforce:aluforce /app logs uploads /var/www/uploads

# Switch to non-root user
USER aluforce

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Use dumb-init to handle PID 1 properly
ENTRYPOINT ["dumb-init", "--"]

# Start with PM2 in production
CMD ["node", "node_modules/.bin/pm2-runtime", "ecosystem.config.js", "--env", "production"]
